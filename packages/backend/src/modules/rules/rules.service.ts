import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { WorkspaceTimezoneService } from '../../shared/services/workspace-timezone.service';
import { dayInTimezone } from '../../shared/helpers/timezone';
import { ActionItem, CampaignActionsService } from '../campaigns/campaign-actions.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import {
  ACTIONS, evaluate, FREQUENCIES, inScope, isDue, OPERATORS, plan, PlannedAction, RULE_METRICS, RuleDefinition, RuleRow,
  ruleWarnings, windowRange, WINDOWS,
} from './rules-engine';

/** Regras automáticas (docs/features/25-rules/rules.md). */

interface RuleRecord {
  id: string;
  workspace_id: string;
  name: string;
  enabled: boolean;
  definition: RuleDefinition;
  last_run_at: string | null;
  runs_day: string | null;
  runs_today: number;
  created_at: string;
  updated_at: string;
}

export interface RuleInput extends RuleDefinition {
  name: string;
  enabled: boolean;
}

export interface RunAction {
  objectId: string;
  name: string;
  accountId: string;
  action: PlannedAction['action'];
  before: string | number | null;
  after: string | number | null;
  ok: boolean;
  code?: string;
  message?: string;
}

const CRON_BUDGET_MS = 45_000;
const MAX_ACTIONS_PER_RUN = 40;

@Injectable()
export class RulesService {
  private readonly logger = new Logger(RulesService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly campaigns: CampaignsService,
    private readonly actions: CampaignActionsService,
    private readonly timezones: WorkspaceTimezoneService,
  ) {}

  catalog() {
    return {
      metrics: Object.entries(RULE_METRICS).map(([key, value]) => ({ key, ...value })),
      operators: OPERATORS, windows: WINDOWS, actions: ACTIONS, frequencies: FREQUENCIES,
    };
  }

  async list(workspaceId: string) {
    const db = this.supabase.getClient();
    const { data, error } = await db.from('dashboard_rules').select('*').eq('workspace_id', workspaceId).order('created_at');
    if (error) throw new InternalServerErrorException('Não foi possível ler as regras.');
    const rules = (data ?? []) as RuleRecord[];
    const timeZone = await this.timezones.get(workspaceId);
    const lastRuns = new Map<string, unknown>();
    await Promise.all(rules.map(async (rule) => {
      const run = await db.from('dashboard_rule_runs').select('id,trigger,ran_at,evaluated,matched,succeeded,failed,error')
        .eq('rule_id', rule.id).order('ran_at', { ascending: false }).limit(1).maybeSingle();
      if (run.data) lastRuns.set(rule.id, run.data);
    }));
    return { rules: rules.map((rule) => ({ ...this.toApi(rule, timeZone), lastRun: lastRuns.get(rule.id) ?? null })), catalog: this.catalog() };
  }

  async create(workspaceId: string, input: RuleInput) {
    const { name, enabled, ...definition } = input;
    const { data, error } = await this.supabase.getClient().from('dashboard_rules')
      .insert({ workspace_id: workspaceId, name: name.trim(), enabled, definition }).select('*').single();
    if (error || !data) throw new InternalServerErrorException('Não foi possível salvar a regra.');
    return { rule: this.toApi(data as RuleRecord, await this.timezones.get(workspaceId)), warnings: await this.warnings(workspaceId, definition) };
  }

  async update(workspaceId: string, id: string, input: RuleInput) {
    const { name, enabled, ...definition } = input;
    const { data, error } = await this.supabase.getClient().from('dashboard_rules')
      .update({ name: name.trim(), enabled, definition, updated_at: new Date().toISOString() })
      .eq('id', id).eq('workspace_id', workspaceId).select('*').maybeSingle();
    if (error) throw new InternalServerErrorException('Não foi possível salvar a regra.');
    if (!data) throw new NotFoundException('Regra não encontrada.');
    return { rule: this.toApi(data as RuleRecord, await this.timezones.get(workspaceId)), warnings: await this.warnings(workspaceId, definition) };
  }

  async setEnabled(workspaceId: string, id: string, enabled: boolean) {
    const { data, error } = await this.supabase.getClient().from('dashboard_rules')
      .update({ enabled, updated_at: new Date().toISOString() }).eq('id', id).eq('workspace_id', workspaceId).select('*').maybeSingle();
    if (error) throw new InternalServerErrorException('Não foi possível salvar a regra.');
    if (!data) throw new NotFoundException('Regra não encontrada.');
    return { rule: this.toApi(data as RuleRecord, await this.timezones.get(workspaceId)) };
  }

  async remove(workspaceId: string, id: string) {
    const { data, error } = await this.supabase.getClient().from('dashboard_rules')
      .delete().eq('id', id).eq('workspace_id', workspaceId).select('id').maybeSingle();
    if (error) throw new InternalServerErrorException('Não foi possível apagar a regra.');
    if (!data) throw new NotFoundException('Regra não encontrada.');
    return { success: true };
  }

  async runs(workspaceId: string, ruleId: string | undefined, limit: number, before: string | undefined) {
    let query = this.supabase.getClient().from('dashboard_rule_runs').select('*')
      .eq('workspace_id', workspaceId).order('ran_at', { ascending: false }).limit(limit + 1);
    if (ruleId) query = query.eq('rule_id', ruleId);
    if (before) query = query.lt('ran_at', before);
    const { data, error } = await query;
    if (error) throw new InternalServerErrorException('Não foi possível ler o histórico.');
    const rows = data ?? [];
    const page = rows.slice(0, limit);
    return { runs: page, nextBefore: rows.length > limit ? page[page.length - 1].ran_at : null };
  }

  /** O que a regra faria agora, sem agir. */
  async simulate(workspaceId: string, definition: RuleDefinition) {
    const evaluation = await this.evaluateRule(workspaceId, definition);
    return { ...evaluation, warnings: [...evaluation.warnings, ...(await this.warnings(workspaceId, definition))] };
  }

  async runNow(workspaceId: string, id: string) {
    const rule = await this.find(workspaceId, id);
    return this.execute(rule, 'manual');
  }

  /** Tique do pg_cron: roda as regras que estão na hora, até o limite de tempo. */
  async tick(now = new Date()) {
    const started = Date.now();
    const { data, error } = await this.supabase.getClient().from('dashboard_rules').select('*').eq('enabled', true).order('last_run_at', { ascending: true, nullsFirst: true });
    if (error) throw new InternalServerErrorException('Não foi possível ler as regras.');
    const rules = (data ?? []) as RuleRecord[];
    const zones = new Map<string, string>();
    for (const id of new Set(rules.map((rule) => rule.workspace_id))) zones.set(id, await this.timezones.get(id));
    const due = rules.filter((rule) => isDue(rule.definition, {
      enabled: rule.enabled, lastRunAt: rule.last_run_at, runsDay: rule.runs_day, runsToday: rule.runs_today,
    }, now, zones.get(rule.workspace_id)));
    const done: string[] = [];
    for (const rule of due) {
      if (Date.now() - started > CRON_BUDGET_MS) break;
      try {
        await this.execute(rule, 'schedule');
        done.push(rule.id);
      } catch (err) {
        this.logger.error(`Regra ${rule.id} falhou: ${err instanceof Error ? err.message : err}`);
      }
    }
    return { due: due.length, ran: done.length };
  }

  private async execute(rule: RuleRecord, trigger: 'schedule' | 'manual') {
    const db = this.supabase.getClient();
    const timeZone = await this.timezones.get(rule.workspace_id);
    const today = dayInTimezone(new Date(), timeZone);
    let evaluation: Awaited<ReturnType<RulesService['evaluateRule']>> | null = null;
    let runError: string | null = null;
    const performed: RunAction[] = [];
    try {
      evaluation = await this.evaluateRule(rule.workspace_id, rule.definition);
      const todo = evaluation.matches.filter((match) => match.action && !match.action.skipped).slice(0, MAX_ACTIONS_PER_RUN);
      if (todo.length) {
        const items: ActionItem[] = todo.map((match) => ({
          objectId: match.objectId, level: rule.definition.level,
          action: match.action!.action, ...(match.action!.value !== undefined ? { value: match.action!.value } : {}),
        }));
        const result = await this.actions.run(rule.workspace_id, items, false);
        result.results.forEach((item, index) => {
          const match = todo[index];
          performed.push({
            objectId: match.objectId, name: match.name, accountId: match.accountId, action: match.action!.action,
            before: match.action!.before, after: match.action!.after, ok: item.ok, code: item.code, message: item.message,
          });
        });
      }
    } catch (err) {
      runError = err instanceof Error ? err.message : 'Falha ao executar a regra.';
    }

    const runsToday = rule.runs_day === today ? rule.runs_today + 1 : 1;
    const [run] = await Promise.all([
      db.from('dashboard_rule_runs').insert({
        rule_id: rule.id, workspace_id: rule.workspace_id, trigger,
        since: evaluation?.since ?? null, until: evaluation?.until ?? null,
        evaluated: evaluation?.evaluated ?? 0, matched: evaluation?.matches.length ?? 0,
        succeeded: performed.filter((a) => a.ok).length, failed: performed.filter((a) => !a.ok).length,
        actions: performed, error: runError,
      }).select('*').single(),
      db.from('dashboard_rules').update({ last_run_at: new Date().toISOString(), runs_day: today, runs_today: runsToday }).eq('id', rule.id),
    ]);
    if (run.error) throw new InternalServerErrorException('A regra rodou, mas o histórico não foi gravado.');
    return run.data;
  }

  private async evaluateRule(workspaceId: string, definition: RuleDefinition) {
    const timeZone = await this.timezones.get(workspaceId);
    const { since, until } = windowRange(definition.window, dayInTimezone(new Date(), timeZone));
    const objects = await this.campaigns.objects(workspaceId, { level: definition.level, since, until }, 'rules');
    const rows = objects.rows.filter((row) => inScope(row as unknown as RuleRow, definition));
    const matches = [];
    for (const row of rows) {
      const result = evaluate(row as unknown as RuleRow, definition.conditions);
      if (!result.matched) continue;
      matches.push({
        objectId: row.id, name: row.name, accountId: row.accountId, level: row.level, status: row.status,
        accountCurrency: row.accountCurrency, conditions: result.checks,
        action: plan(row as unknown as RuleRow, definition.action),
      });
    }
    return { since, until, evaluated: rows.length, matches, warnings: objects.warnings };
  }

  /** Avisos, com o CPA dos últimos 7 dias das contas da regra. */
  private async warnings(workspaceId: string, definition: RuleDefinition) {
    let cpa: number | null = null;
    try {
      const objects = await this.campaigns.objects(workspaceId, { level: 'account', days: 7 });
      const rows = objects.rows.filter((row) => !definition.accountIds.length
        || definition.accountIds.some((id) => id.replace(/^act_/, '') === row.accountId.replace(/^act_/, '')));
      const spend = rows.reduce((sum, row) => sum + (row.spend ?? 0), 0);
      const sales = rows.reduce((sum, row) => sum + (row.sales ?? 0), 0);
      cpa = sales > 0 ? spend / sales : null;
    } catch {
      cpa = null;
    }
    return ruleWarnings(definition, cpa);
  }

  private async find(workspaceId: string, id: string) {
    const { data, error } = await this.supabase.getClient().from('dashboard_rules').select('*')
      .eq('id', id).eq('workspace_id', workspaceId).maybeSingle();
    if (error) throw new InternalServerErrorException('Não foi possível ler a regra.');
    if (!data) throw new NotFoundException('Regra não encontrada.');
    return data as RuleRecord;
  }

  private toApi(rule: RuleRecord, timeZone: string) {
    return {
      id: rule.id, name: rule.name, enabled: rule.enabled, ...rule.definition,
      lastRunAt: rule.last_run_at, runsToday: rule.runs_day === dayInTimezone(new Date(), timeZone) ? rule.runs_today : 0,
      createdAt: rule.created_at, updatedAt: rule.updated_at,
    };
  }
}
