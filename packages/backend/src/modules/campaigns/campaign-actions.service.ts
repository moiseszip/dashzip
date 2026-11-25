import { BadRequestException, ConflictException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { EncryptionService } from '../../shared/services/encryption.service';
import { SupabaseService } from '../../shared/services/supabase.service';
import { FinanceService } from '../finance/finance.service';
import { fromMinor, accountStatusName } from './campaign-attribution';
import { CampaignsService } from './campaigns.service';
import { MetaErrorCode, MetaGraphClient, MetaGraphError } from './meta-graph.client';

/**
 * Escrita na Meta (pausar, ativar, orçamento) e o vínculo das contas ao
 * painel. Contrato em docs/features/22-campaigns/campaigns.md.
 */

export type ActionLevel = 'campaign' | 'adset' | 'ad';
export type ActionType = 'pause' | 'activate' | 'set_daily_budget' | 'set_lifetime_budget';
export type ActionCode = MetaErrorCode | 'OBJECT_NOT_IN_DASHBOARD' | 'BUDGET_NOT_ON_THIS_LEVEL'
  | 'INVALID_VALUE' | 'UNSUPPORTED_CURRENCY' | 'SKIPPED';

export interface ActionItem {
  objectId: string;
  level: ActionLevel;
  action: ActionType;
  value?: number;
}

export interface ActionResult {
  objectId: string;
  ok: boolean;
  code?: ActionCode;
  message?: string;
  row?: {
    status: string | null;
    effectiveStatus: string | null;
    dailyBudget: number | null;
    lifetimeBudget: number | null;
    budgetLevel: 'campaign' | 'adset' | null;
  };
}

interface MetaObject {
  id: string;
  account_id?: string;
  status?: string;
  effective_status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  campaign?: { daily_budget?: string; lifetime_budget?: string };
}

interface PanelConnection {
  id: string;
  ad_account_id: string;
  account_currency: string | null;
  access_token: string;
}

/** Moedas com centavos (fator 100 na Meta). As outras não aceitam ação de orçamento. */
const CENT_CURRENCIES = new Set(['BRL', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'MXN']);
const FIELDS: Record<ActionLevel, string> = {
  campaign: 'id,account_id,status,effective_status,daily_budget,lifetime_budget',
  adset: 'id,account_id,status,effective_status,daily_budget,lifetime_budget,campaign{daily_budget,lifetime_budget}',
  ad: 'id,account_id,status,effective_status,campaign{daily_budget,lifetime_budget}',
};

class ActionFailure extends Error {
  constructor(readonly code: ActionCode, message: string) {
    super(message);
  }
}

const hasBudget = (value: string | undefined) => Number(value) > 0;

export function budgetLevelOf(level: ActionLevel, object: MetaObject): 'campaign' | 'adset' | null {
  if (level === 'campaign') return hasBudget(object.daily_budget) || hasBudget(object.lifetime_budget) ? 'campaign' : 'adset';
  const campaign = object.campaign;
  if (campaign && (hasBudget(campaign.daily_budget) || hasBudget(campaign.lifetime_budget))) return 'campaign';
  return 'adset';
}

export function rowOf(level: ActionLevel, object: MetaObject): NonNullable<ActionResult['row']> {
  const budgetLevel = budgetLevelOf(level, object);
  const owns = budgetLevel === level;
  return {
    status: object.status ?? null,
    effectiveStatus: object.effective_status ?? null,
    dailyBudget: owns ? fromMinor(object.daily_budget) : null,
    lifetimeBudget: owns ? fromMinor(object.lifetime_budget) : null,
    budgetLevel,
  };
}

/** Parâmetros da escrita na Meta. Exportada para teste. */
export function writeParams(item: ActionItem, object: MetaObject, currency: string): Record<string, string> {
  if (item.action === 'pause') return { status: 'PAUSED' };
  if (item.action === 'activate') return { status: 'ACTIVE' };
  if (item.level === 'ad') throw new ActionFailure('BUDGET_NOT_ON_THIS_LEVEL', 'Anúncio não tem orçamento.');
  if (budgetLevelOf(item.level, object) !== item.level) {
    throw new ActionFailure('BUDGET_NOT_ON_THIS_LEVEL', 'O orçamento deste objeto fica no outro nível (campanha × conjunto).');
  }
  const field = item.action === 'set_daily_budget' ? 'daily_budget' : 'lifetime_budget';
  if (!hasBudget(object[field])) {
    throw new ActionFailure('BUDGET_NOT_ON_THIS_LEVEL', item.action === 'set_daily_budget'
      ? 'Este objeto usa orçamento total, não diário.' : 'Este objeto usa orçamento diário, não total.');
  }
  if (!CENT_CURRENCIES.has(currency)) throw new ActionFailure('UNSUPPORTED_CURRENCY', `Orçamento em ${currency} não é suportado.`);
  const value = item.value;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 1_000_000) {
    throw new ActionFailure('INVALID_VALUE', 'Informe um orçamento entre 1 e 1.000.000 na moeda da conta.');
  }
  return { [field]: String(Math.round(value * 100)) };
}

@Injectable()
export class CampaignActionsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly encryption: EncryptionService,
    private readonly graph: MetaGraphClient,
    private readonly campaigns: CampaignsService,
    private readonly finance: FinanceService,
  ) {}

  async run(workspaceId: string, items: ActionItem[], validateOnly: boolean) {
    const connections = await this.panelConnections(workspaceId);
    const tokens = [...new Set(connections.map((c) => this.encryption.decryptIfNeeded(c.access_token)))];
    const results: ActionResult[] = [];
    let stopped = false;
    for (const item of items) {
      if (stopped) {
        results.push({ objectId: item.objectId, ok: false, code: 'SKIPPED', message: 'Interrompido pelo limite da Meta.' });
        continue;
      }
      try {
        results.push(await this.runOne(item, connections, tokens, validateOnly));
      } catch (error) {
        const failure = this.failure(error);
        if (failure.code === 'RATE_LIMITED') stopped = true;
        results.push({ objectId: item.objectId, ok: false, code: failure.code, message: failure.message });
      }
    }
    return { validateOnly, results };
  }

  private async runOne(item: ActionItem, connections: PanelConnection[], tokens: string[], validateOnly: boolean): Promise<ActionResult> {
    const { object, token } = await this.readObject(item, tokens);
    const connection = connections.find((c) => c.ad_account_id.replace(/^act_/, '') === object.account_id);
    if (!connection) throw new ActionFailure('OBJECT_NOT_IN_DASHBOARD', 'Este objeto é de uma conta que não está no painel.');

    const accountToken = this.encryption.decryptIfNeeded(connection.access_token) || token;
    const params = writeParams(item, object, connection.account_currency ?? '');
    await this.graph.post(item.objectId, accountToken, validateOnly
      ? { ...params, execution_options: '["validate_only"]' } : params);
    if (!validateOnly) this.campaigns.invalidate(connection.id);
    const updated = await this.graph.get<MetaObject>(item.objectId, accountToken, { fields: FIELDS[item.level] });
    return { objectId: item.objectId, ok: true, row: rowOf(item.level, updated) };
  }

  /** Lê o objeto com o primeiro token do painel que o enxerga. */
  private async readObject(item: ActionItem, tokens: string[]) {
    let lastError: unknown = null;
    for (const token of tokens) {
      try {
        const object = await this.graph.get<MetaObject>(item.objectId, token, { fields: FIELDS[item.level] });
        if (object.account_id) return { object, token };
      } catch (error) {
        lastError = error;
        if (error instanceof MetaGraphError && ['RATE_LIMITED', 'META_UNAVAILABLE'].includes(error.code)) throw error;
      }
    }
    if (lastError instanceof MetaGraphError && lastError.code === 'TOKEN_INVALID') throw lastError;
    throw new ActionFailure('OBJECT_NOT_IN_DASHBOARD', 'Nenhuma conta do painel enxerga este objeto.');
  }

  private failure(error: unknown): { code: ActionCode; message: string } {
    if (error instanceof ActionFailure) return { code: error.code, message: error.message };
    if (error instanceof MetaGraphError) return { code: error.code, message: error.message };
    return { code: 'META_UNAVAILABLE', message: 'Falha inesperada ao falar com a Meta.' };
  }

  private async panelConnections(workspaceId: string): Promise<PanelConnection[]> {
    const { data, error } = await this.supabase.getClient().from('facebook_connections')
      .select('id,ad_account_id,account_currency,access_token').eq('workspace_id', workspaceId).eq('is_active', true);
    if (error) throw new InternalServerErrorException('Não foi possível carregar as contas do painel.');
    return (data ?? []) as PanelConnection[];
  }

  // ---- Contas do painel -------------------------------------------------

  /**
   * Contas que os tokens enxergam. Sem `accessToken`, usa os tokens que o
   * usuário já salvou (System User). Com `accessToken`, lista só as dele, sem
   * gravar nada: a gravação acontece no PUT /accounts.
   */
  async availableAccounts(userId: string, workspaceId: string, accessToken?: string) {
    const { rows, tokens } = await this.userConnections(userId);
    const sources = accessToken ? [accessToken] : tokens;
    if (!sources.length) return { needsToken: true, accounts: [], warnings: [] as string[] };

    const warnings: string[] = [];
    const seen = new Map<string, { id: string; name: string; currency: string; timezone: string | null; accountStatus: string | null }>();
    for (const token of sources) {
      try {
        const list = await this.graph.getAll<{ account_id: string; name?: string; currency?: string; timezone_name?: string; account_status?: number }>(
          'me/adaccounts', token, { fields: 'account_id,name,currency,timezone_name,account_status' }, 10);
        for (const account of list) {
          const id = `act_${account.account_id}`;
          if (!seen.has(id)) {
            seen.set(id, {
              id, name: account.name || id, currency: account.currency || '—',
              timezone: account.timezone_name ?? null, accountStatus: accountStatusName(account.account_status ?? null),
            });
          }
        }
      } catch (error) {
        if (accessToken) {
          throw new BadRequestException(error instanceof MetaGraphError ? error.message : 'A Meta recusou este token.');
        }
        warnings.push(error instanceof MetaGraphError ? error.message : 'Um dos tokens salvos falhou na Meta.');
      }
    }

    const active = rows.filter((row) => row.is_active);
    const accounts = [...seen.values()].map((account) => {
      const owner = active.find((row) => `act_${row.ad_account_id.replace(/^act_/, '')}` === account.id);
      return {
        ...account,
        linked: owner?.workspace_id === workspaceId,
        linkedDashboardId: owner && owner.workspace_id !== workspaceId ? owner.workspace_id : null,
      };
    }).sort((a, b) => Number(b.linked) - Number(a.linked) || a.name.localeCompare(b.name));
    return { needsToken: false, accounts, warnings };
  }

  /** Grava a lista final de contas do painel: verifica as novas e desativa as que saíram. */
  async setAccounts(userId: string, workspaceId: string, accountIds: string[], accessToken?: string) {
    const wanted = [...new Set(accountIds.map((id) => `act_${id.replace(/^act_/, '')}`))];
    const { rows, tokens } = await this.userConnections(userId);
    const sources = accessToken ? [accessToken, ...tokens] : tokens;

    const visibleBy = new Map<string, string>();
    for (const token of sources) {
      try {
        const list = await this.graph.getAll<{ account_id: string }>('me/adaccounts', token, { fields: 'account_id' }, 10);
        for (const { account_id } of list) if (!visibleBy.has(`act_${account_id}`)) visibleBy.set(`act_${account_id}`, token);
      } catch {
        // token sem acesso: as contas dele caem em NOT_VISIBLE_TO_TOKEN
      }
    }

    const linkedHere = rows.filter((row) => row.is_active && row.workspace_id === workspaceId);
    const results: { accountId: string; ok: boolean; code?: string; message?: string }[] = [];
    for (const accountId of wanted) {
      if (linkedHere.some((row) => `act_${row.ad_account_id.replace(/^act_/, '')}` === accountId)) {
        results.push({ accountId, ok: true });
        continue;
      }
      const token = visibleBy.get(accountId);
      if (!token) {
        results.push({ accountId, ok: false, code: 'NOT_VISIBLE_TO_TOKEN', message: 'Nenhum token salvo enxerga esta conta.' });
        continue;
      }
      try {
        await this.finance.connect(userId, workspaceId, accountId, token);
        results.push({ accountId, ok: true });
      } catch (error) {
        if (error instanceof ConflictException) {
          results.push({ accountId, ok: false, code: 'ACCOUNT_IN_OTHER_DASHBOARD', message: 'A conta já pertence a outro painel.' });
        } else {
          results.push({ accountId, ok: false, code: 'META_REJECTED', message: error instanceof Error ? error.message : 'A Meta recusou a conta.' });
        }
      }
    }
    for (const row of linkedHere) {
      const id = `act_${row.ad_account_id.replace(/^act_/, '')}`;
      if (wanted.includes(id)) continue;
      await this.finance.deactivate(userId, workspaceId, row.id);
      this.campaigns.invalidate(row.id);
      results.push({ accountId: id, ok: true, message: 'Desvinculada do painel.' });
    }
    const settings = await this.finance.settings(workspaceId);
    return { results, accounts: settings.accounts };
  }

  private async userConnections(userId: string) {
    const { data, error } = await this.supabase.getClient().from('facebook_connections')
      .select('id,workspace_id,ad_account_id,access_token,is_active,is_valid').eq('user_id', userId);
    if (error) throw new InternalServerErrorException('Não foi possível ler as contas salvas.');
    const rows = (data ?? []) as { id: string; workspace_id: string; ad_account_id: string; access_token: string; is_active: boolean; is_valid: boolean | null }[];
    const tokens = [...new Set(rows.filter((row) => row.is_valid !== false && row.access_token)
      .map((row) => this.encryption.decryptIfNeeded(row.access_token)))];
    return { rows, tokens };
  }
}
