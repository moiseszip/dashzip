import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { CacheService } from '../../shared/services/cache.service';
import { EncryptionService } from '../../shared/services/encryption.service';
import { SupabaseService } from '../../shared/services/supabase.service';
import { WorkspaceTimezoneService } from '../../shared/services/workspace-timezone.service';
import { DEFAULT_TIMEZONE, dayInTimezone, dayRangeUtc, dayStartUtc } from '../../shared/helpers/timezone';
import {
  dashboardFinance, FinanceCheckout, FinanceSettings, mediaTaxPercentFor, roundMoney, shiftDay, usdRateForDay,
} from '../finance/finance-totals';
import { FinanceService } from '../finance/finance.service';
import { MetaSpendService } from '../finance/meta-spend.service';
import {
  accountStatusName, attribute, AttributableSale, buildMetrics, DeliveryMetrics, deliveryFromInsight,
  EMPTY_DELIVERY, fromMinor, Hierarchy, InsightRecord, Level, Metrics, PerformanceBasis, revenueOf, sumMetrics, UtmSource,
} from './campaign-attribution';
import { MetaGraphClient, MetaGraphError } from './meta-graph.client';
import { storedIds } from '../wiapy/wiapy-sales';
import { WiapySalesService } from '../wiapy/wiapy-sales.service';

/**
 * Tela de Campanhas: objetos da Meta (conta, campanha, conjunto, anúncio) com
 * as vendas do painel atribuídas pelo ID da UTM. Contrato em
 * docs/features/22-campaigns/campaigns.md.
 */

export interface ObjectsQuery {
  level: Level;
  days?: number;
  since?: string;
  until?: string;
  parentIds?: string[];
  status?: string[];
  q?: string;
  /**
   * Une as vendas da Wiapy lidas na hora (com a origem/UTMs de cada uma) às do
   * webhook. Só a tela de Campanhas pede: Regras e o Resultado (gasto) seguem
   * com o banco.
   */
  liveSales?: boolean;
}

export interface AccountInfo {
  id: string;
  connectionId: string;
  name: string;
  currency: string;
  accountStatus: string | null;
  cycleSpend: number | null;
  totalSpend: number | null;
  spendCap: number | null;
}

export interface ObjectMeta {
  id: string;
  level: Level;
  name: string;
  parentId: string | null;
  accountId: string;
  campaignId: string | null;
  adsetId: string | null;
  accountCurrency: string;
  status: string | null;
  effectiveStatus: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  budgetLevel: 'campaign' | 'adset' | null;
  /** Data de criação na Meta (ISO), null para contas e objetos fora da lista. */
  createdTime: string | null;
}

export type CampaignRow = ObjectMeta & Metrics;

export interface TestCell {
  spendNative: number | null;
  spend: number | null;
  mediaTax: number | null;
  grossRevenue: number | null;
  netRevenue: number | null;
  salesTax: number | null;
  profit: number | null;
  sales: number;
  impressions: number | null;
  clicks: number | null;
  landingPageViews: number | null;
  initiateCheckouts: number | null;
}

export type TestCampaignRow = ObjectMeta & { accountName: string; byDay: Record<string, TestCell> };

export interface ActivityEvent {
  event_type?: string;
  translated_event_type?: string;
  event_time?: string;
  object_id?: string;
  object_name?: string;
  object_type?: string;
  extra_data?: unknown;
  actor_name?: string;
}

export interface CampaignChange {
  campaignId: string;
  kind: 'activated' | 'paused' | 'budget';
  level: 'campaign' | 'adset' | 'ad';
  objectId: string;
  objectName: string | null;
  at: string;
  actor: string;
  /** Orçamento antes e depois, na moeda da conta (unidade cheia). */
  from?: number;
  to?: number;
}

const parseExtra = (extra: unknown): Record<string, unknown> => {
  if (typeof extra === 'string') {
    try {
      const parsed: unknown = JSON.parse(extra);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return extra && typeof extra === 'object' && !Array.isArray(extra) ? extra as Record<string, unknown> : {};
};

const fieldValue = (extra: Record<string, unknown>, field: 'old_value' | 'new_value'): unknown => {
  const value = extra[field];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const nested = value as Record<string, unknown>;
    return nested[field] ?? nested.value ?? nested.amount ?? value;
  }
  return value;
};

const statusChange = (value: unknown): 'activated' | 'paused' | null => {
  const text = String(value ?? '').trim().toLowerCase();
  if (/^(ativo|ativa|active|ligado|ligada|1)$/.test(text)) return 'activated';
  if (/^(inativo|inativa|inactive|pausado|pausada|paused|desligado|desligada|2|8|15)$/.test(text)) return 'paused';
  return null;
};

/**
 * Eventos do log de atividades → mudanças por campanha (porta do
 * painel-testes/src/lib/atividades.ts). Exportada para teste.
 */
export function parseActivities(
  events: ActivityEvent[], campaignIds: Set<string>, byAdset: Map<string, string>, byAd: Map<string, string>,
): CampaignChange[] {
  const result: CampaignChange[] = [];
  for (const event of events) {
    const type = event.event_type ?? '';
    const isBudget = /budget/i.test(type);
    const isStatus = /run_status/i.test(type);
    if (!isBudget && !isStatus) continue;
    const extra = parseExtra(event.extra_data);
    const objectId = String(event.object_id ?? '');
    const extraCampaign = String(extra.campaign_id ?? '');
    const campaignId = extraCampaign && campaignIds.has(extraCampaign) ? extraCampaign
      : campaignIds.has(objectId) ? objectId : byAdset.get(objectId) ?? byAd.get(objectId) ?? '';
    if (!campaignId) continue;
    const kind = isBudget ? 'budget' : statusChange(fieldValue(extra, 'new_value'));
    if (!kind || !event.event_time) continue;
    const at = new Date(event.event_time).toISOString();
    const lower = type.toLowerCase();
    const level = lower.startsWith('update_ad_run_status') || byAd.has(objectId) ? 'ad'
      : lower.startsWith('update_ad_set_') || byAdset.has(objectId) ? 'adset' : 'campaign';
    const actorName = (event.actor_name || 'Meta').trim();
    const change: CampaignChange = {
      campaignId, kind, level, objectId, objectName: event.object_name ?? null, at,
      actor: /system user/i.test(actorName) ? 'dash.zip' : actorName,
    };
    if (isBudget) {
      const from = Number(fieldValue(extra, 'old_value'));
      const to = Number(fieldValue(extra, 'new_value'));
      if (Number.isFinite(from)) change.from = roundMoney(from / 100);
      if (Number.isFinite(to)) change.to = roundMoney(to / 100);
    }
    result.push(change);
  }
  return result;
}

interface Connection {
  id: string;
  ad_account_id: string;
  account_name: string | null;
  account_currency: string | null;
  access_token: string;
}

interface ListedObject {
  id: string;
  name?: string;
  status?: string;
  effective_status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  campaign_id?: string;
  adset_id?: string;
  created_time?: string;
}

interface Insight extends InsightRecord {
  account_id?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  date_start?: string;
}

/** O que uma conta devolveu da Meta para um nível e período. Vai para o cache. */
interface AccountSnapshot {
  info: AccountInfo;
  objects: ObjectMeta[];
  delivery: [string, DeliveryMetrics][];
  /** Gasto por objeto e dia, só em conta fora de BRL. */
  daily: [string, [string, number][]][] | null;
  hierarchy: {
    ads: [string, { adsetId: string; campaignId: string }][];
    adsets: [string, { campaignId: string }][];
    campaigns: string[];
  };
}

interface AccountResult {
  connection: Connection;
  snapshot: AccountSnapshot | null;
  error: string | null;
}

const METRIC_FIELDS = 'spend,impressions,reach,frequency,inline_link_clicks,actions,video_play_actions,video_p75_watched_actions';
const ID_FIELDS: Record<Level, string> = {
  account: 'account_id',
  campaign: 'campaign_id,campaign_name',
  adset: 'adset_id,adset_name,campaign_id',
  ad: 'ad_id,ad_name,adset_id,campaign_id',
};
const LIVE_STATUSES = {
  campaigns: ['ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES'],
  adsets: ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'IN_PROCESS', 'WITH_ISSUES'],
  ads: ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'DISAPPROVED', 'PENDING_REVIEW',
    'PREAPPROVED', 'PENDING_BILLING_INFO', 'IN_PROCESS', 'WITH_ISSUES'],
};
const MAX_RANGE_DAYS = 92;
const CACHE_RECENT_MS = 5 * 60_000;
const CACHE_CLOSED_MS = 30 * 60_000;

const statusFilter = (values: string[]) => JSON.stringify([{ field: 'effective_status', operator: 'IN', value: values }]);
const canonical = (accountId: string) => `act_${accountId.replace(/^act_/, '')}`;

@Injectable()
export class CampaignsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly encryption: EncryptionService,
    private readonly cache: CacheService,
    private readonly graph: MetaGraphClient,
    private readonly metaSpend: MetaSpendService,
    private readonly finance: FinanceService,
    private readonly timezones: WorkspaceTimezoneService,
    private readonly wiapySales: WiapySalesService,
  ) {}

  /**
   * Período em dias do fuso do painel. `days` tem prioridade sobre since/until.
   * Sem fuso (quem ainda não lê o do painel), "hoje" é São Paulo, mas o limite
   * de futuro aceita o dia mais adiantado do planeta: a tela pode estar num
   * fuso à frente de São Paulo e mandar o "hoje" dela.
   */
  resolvePeriod(query: Pick<ObjectsQuery, 'days' | 'since' | 'until'>, timeZone?: string) {
    const now = new Date();
    const today = dayInTimezone(now, timeZone ?? DEFAULT_TIMEZONE);
    const latest = timeZone ? today : dayInTimezone(now, 'Pacific/Kiritimati');
    if (query.days) return { since: shiftDay(today, 1 - query.days), until: today };
    if (!query.since || !query.until) return { since: shiftDay(today, -6), until: today };
    if (query.since > query.until) throw new BadRequestException('O início do período é depois do fim.');
    if (query.until > latest) throw new BadRequestException('O período não pode terminar no futuro.');
    const span = (Date.parse(query.until) - Date.parse(query.since)) / 86_400_000 + 1;
    if (span > MAX_RANGE_DAYS) throw new BadRequestException(`O período pode ter no máximo ${MAX_RANGE_DAYS} dias.`);
    return { since: query.since, until: query.until };
  }

  async objects(workspaceId: string, query: ObjectsQuery, basis: PerformanceBasis = 'dashboard') {
    const timeZone = await this.timezones.get(workspaceId);
    const { since, until } = this.resolvePeriod(query, timeZone);
    const level = query.level;
    const warnings: string[] = [];
    const db = this.supabase.getClient();

    const [connections, settings, checkouts, merged] = await Promise.all([
      db.from('facebook_connections').select('id,ad_account_id,account_name,account_currency,access_token')
        .eq('workspace_id', workspaceId).eq('is_active', true).order('created_at'),
      this.finance.readSettings(workspaceId),
      db.from('checkout_integrations').select('id,platform,use_commission_value').eq('workspace_id', workspaceId),
      this.readSales(workspaceId, since, until, timeZone).then((stored) => (query.liveSales
        ? this.wiapySales.merge(workspaceId, since, until, timeZone, stored, { statuses: ['approved', 'refunded', 'chargeback'], origins: 'fetch' })
        : { rows: stored, warnings: [] as string[] })),
    ]);
    if (connections.error || checkouts.error) throw new InternalServerErrorException('Não foi possível carregar as contas do painel.');
    const sales = merged.rows;
    warnings.push(...merged.warnings);

    const accounts = (connections.data ?? []) as Connection[];
    const [sessions, results] = await Promise.all([
      this.readSessions(storedIds(sales.map((sale) => sale.id))),
      Promise.all(accounts.map((connection) => this.loadAccount(connection, level, since, until, timeZone))),
    ]);
    for (const result of results) {
      if (result.error) warnings.push(`${result.connection.account_name || result.connection.ad_account_id}: ${result.error}`);
    }

    const needsUSD = accounts.some((a) => a.account_currency === 'USD')
      || sales.some((sale) => sale.currency?.toUpperCase() === 'USD');
    let quotes = new Map<string, number>();
    // A PTAX vem sempre: além de converter o gasto em dólar, ela alimenta o seletor de moeda da tela.
    try {
      quotes = await this.metaSpend.ptax(since, until);
    } catch {
      if (needsUSD) warnings.push('PTAX indisponível: gasto e faturamento em dólar ficam sem conversão.');
    }
    const exchangeRate = (currency: string, day: string) => {
      if (currency === 'BRL') return 1;
      return currency === 'USD' ? usdRateForDay(quotes, day) : null;
    };

    const hierarchy = this.mergeHierarchy(results);
    const attribution = attribute(sales, sessions, hierarchy, level);

    const rows: CampaignRow[] = [];
    for (const result of results) {
      const snapshot = result.snapshot;
      if (!snapshot) {
        if (level === 'account') rows.push(this.failedAccountRow(result.connection, attribution.byObject, checkouts.data ?? [], settings, exchangeRate, basis));
        continue;
      }
      const delivery = new Map(snapshot.delivery);
      const daily = snapshot.daily ? new Map(snapshot.daily) : null;
      const currency = snapshot.info.currency;
      const mediaTaxPercent = mediaTaxPercentFor({ accountId: snapshot.info.id, currency }, settings.mediaTaxRules);
      for (const object of snapshot.objects) {
        const objectDelivery = delivery.get(object.id) ?? EMPTY_DELIVERY;
        const lines = attribution.byObject.get(object.id);
        const hasDelivery = objectDelivery.impressions > 0 || objectDelivery.spendNative > 0;
        if (level !== 'account' && object.status !== 'ACTIVE' && !hasDelivery && !lines?.length) continue;

        let spend: number | null = currency === 'BRL' ? objectDelivery.spendNative : 0;
        if (currency !== 'BRL') {
          for (const [day, value] of daily?.get(object.id) ?? []) {
            if (value === 0) continue;
            const rate = exchangeRate(currency, day);
            if (rate === null) { spend = null; break; }
            spend! += value * rate;
          }
          if (spend !== null && !daily && objectDelivery.spendNative > 0) spend = null;
        }
        const mediaTax = spend === null ? null : spend * mediaTaxPercent / 100;
        const revenue = revenueOf(lines, (checkouts.data ?? []) as FinanceCheckout[], settings, exchangeRate);
        rows.push({ ...object, ...buildMetrics(objectDelivery, spend, mediaTax, revenue, basis) });
      }
    }

    const filtered = this.filterRows(rows, query);
    const untracked = revenueOf(attribution.untracked, (checkouts.data ?? []) as FinanceCheckout[], settings, exchangeRate);
    return {
      level, since, until, currency: 'BRL' as const,
      usdBrl: usdBrlFor(quotes, since, until),
      rows: filtered,
      totals: sumMetrics(filtered, basis),
      untrackedSales: { count: untracked.sales, grossRevenue: untracked.grossRevenue === null ? null : roundMoney(untracked.grossRevenue) },
      accounts: results.map((r) => r.snapshot?.info ?? this.basicInfo(r.connection)),
      warnings,
    };
  }

  /**
   * Acompanhamento de testes: campanha × dia (docs/features/26-tests). Mesmas
   * fontes de objects(): Insights por dia, PTAX do dia, regras de custo sobre
   * mídia e vendas do painel atribuídas pela UTM, separadas pelo dia do pedido.
   */
  async campaignDays(workspaceId: string, query: Pick<ObjectsQuery, 'days' | 'since' | 'until'>) {
    const timeZone = await this.timezones.get(workspaceId);
    const { since, until } = this.resolvePeriod(query, timeZone);
    const warnings: string[] = [];
    const db = this.supabase.getClient();
    const [connections, settings, checkouts, merged] = await Promise.all([
      db.from('facebook_connections').select('id,ad_account_id,account_name,account_currency,access_token')
        .eq('workspace_id', workspaceId).eq('is_active', true).order('created_at'),
      this.finance.readSettings(workspaceId),
      db.from('checkout_integrations').select('id,platform,use_commission_value').eq('workspace_id', workspaceId),
      // Como em Campanhas: com a Wiapy conectada, o período vem dela (na hora)
      // unido ao webhook. Só o banco deixava de fora as vendas que o webhook não gravou.
      this.readSales(workspaceId, since, until, timeZone).then((stored) =>
        this.wiapySales.merge(workspaceId, since, until, timeZone, stored, { statuses: ['approved', 'refunded', 'chargeback'], origins: 'fetch' })),
    ]);
    if (connections.error || checkouts.error) throw new InternalServerErrorException('Não foi possível carregar as contas do painel.');
    const accounts = (connections.data ?? []) as Connection[];
    const checkoutList = (checkouts.data ?? []) as FinanceCheckout[];
    const sales = merged.rows;
    warnings.push(...merged.warnings);

    const [sessions, results] = await Promise.all([
      this.readSessions(storedIds(sales.map((sale) => sale.id))),
      Promise.all(accounts.map((connection) => this.loadAccount(connection, 'campaign', since, until, timeZone))),
    ]);
    const daily = await Promise.all(results.map(async (result) => {
      if (!result.snapshot) {
        warnings.push(`${result.connection.account_name || result.connection.ad_account_id}: ${result.error}`);
        return null;
      }
      try {
        return await this.loadCampaignDays(result.connection, since, until, timeZone);
      } catch (error) {
        warnings.push(`${result.connection.account_name || result.connection.ad_account_id}: ${error instanceof MetaGraphError ? error.message : 'falha ao consultar a Meta.'}`);
        return null;
      }
    }));

    let quotes = new Map<string, number>();
    if (accounts.some((a) => a.account_currency === 'USD') || sales.some((sale) => sale.currency?.toUpperCase() === 'USD')) {
      try {
        quotes = await this.metaSpend.ptax(since, until);
      } catch {
        warnings.push('PTAX indisponível: gasto e faturamento em dólar ficam sem conversão.');
      }
    }
    const exchangeRate = (currency: string, day: string) => (currency === 'BRL' ? 1 : currency === 'USD' ? usdRateForDay(quotes, day) : null);

    const attribution = attribute(sales, sessions, this.mergeHierarchy(results), 'campaign');
    const byDay = (lines: AttributableSale[]) => {
      const orders = new Map<string, AttributableSale[]>();
      for (const line of lines) {
        const key = JSON.stringify([line.checkout_integration_id, line.order_external_id || line.external_id || line.id]);
        orders.set(key, [...(orders.get(key) ?? []), line]);
      }
      const days = new Map<string, AttributableSale[]>();
      for (const group of orders.values()) {
        const first = group.reduce((a, b) => (b.sold_at < a.sold_at ? b : a));
        // O dia do pedido segue o fuso do painel; o da Meta (date_start) já vem no fuso da conta.
        const day = dayInTimezone(new Date(first.sold_at), timeZone);
        days.set(day, [...(days.get(day) ?? []), ...group]);
      }
      return days;
    };

    const days: string[] = [];
    for (let day = since; day <= until; day = shiftDay(day, 1)) days.push(day);

    const rows: TestCampaignRow[] = [];
    results.forEach((result, index) => {
      const snapshot = result.snapshot;
      const delivery = daily[index];
      if (!snapshot) return;
      const currency = snapshot.info.currency;
      const taxPercent = mediaTaxPercentFor({ accountId: snapshot.info.id, currency }, settings.mediaTaxRules);
      for (const object of snapshot.objects) {
        const objectDays = delivery?.get(object.id) ?? new Map<string, DeliveryMetrics>();
        const salesDays = byDay(attribution.byObject.get(object.id) ?? []);
        if (object.status !== 'ACTIVE' && objectDays.size === 0 && salesDays.size === 0) continue;
        const cells: Record<string, TestCell> = {};
        const cellDays = delivery ? new Set([...objectDays.keys(), ...salesDays.keys()]) : days;
        for (const day of cellDays) {
          const d = delivery ? objectDays.get(day) ?? EMPTY_DELIVERY : null;
          const rate = exchangeRate(currency, day);
          const spend = d === null ? null : d.spendNative === 0 ? 0 : rate === null ? null : d.spendNative * rate;
          const mediaTax = spend === null ? null : spend * taxPercent / 100;
          const revenue = revenueOf(salesDays.get(day), checkoutList, settings, exchangeRate);
          const ads = spend === null ? null : roundMoney(spend);
          const iof = mediaTax === null ? null : roundMoney(mediaTax);
          const { profit } = dashboardFinance(revenue.netRevenue, revenue.salesTax, revenue.productCost, ads, iof);
          cells[day] = {
            spendNative: d ? roundMoney(d.spendNative) : null,
            spend: ads,
            mediaTax: iof,
            grossRevenue: revenue.grossRevenue === null ? null : roundMoney(revenue.grossRevenue),
            netRevenue: revenue.netRevenue === null ? null : roundMoney(revenue.netRevenue),
            salesTax: revenue.salesTax === null ? null : roundMoney(revenue.salesTax),
            profit: profit === null ? null : roundMoney(profit),
            sales: revenue.sales,
            impressions: d ? d.impressions : null,
            clicks: d ? d.clicks : null,
            landingPageViews: d ? d.landingPageViews : null,
            initiateCheckouts: d ? d.initiateCheckouts : null,
          };
        }
        rows.push({ ...object, accountName: snapshot.info.name, byDay: cells });
      }
    });

    const untrackedByDay: Record<string, number> = {};
    for (const [day, lines] of byDay(attribution.untracked)) {
      untrackedByDay[day] = revenueOf(lines, checkoutList, settings, exchangeRate).sales;
    }
    return {
      since, until, days, currency: 'BRL' as const, rows,
      untrackedSales: { count: Object.values(untrackedByDay).reduce((a, b) => a + b, 0), byDay: untrackedByDay },
      accounts: results.map((r) => r.snapshot?.info ?? this.basicInfo(r.connection)),
      warnings,
    };
  }

  /** Insights por campanha e dia, com as métricas da célula. Cache de 5 min (30 min se o período já fechou). */
  private async loadCampaignDays(connection: Connection, since: string, until: string, timeZone: string) {
    const key = `campaigns:${connection.id}:campaign-days:${since}:${until}`;
    const cached = this.cache.get<[string, [string, DeliveryMetrics][]][]>(key);
    const build = (entries: [string, [string, DeliveryMetrics][]][]) => new Map(entries.map(([id, list]) => [id, new Map(list)]));
    if (cached) return build(cached);
    const token = this.encryption.decryptIfNeeded(connection.access_token);
    const accountId = canonical(connection.ad_account_id);
    const rows = await this.graph.getAll<Insight>(`${accountId}/insights`, token, {
      level: 'campaign', fields: `campaign_id,date_start,${METRIC_FIELDS}`,
      time_range: JSON.stringify({ since, until }), time_increment: '1',
    }, 60);
    const map = new Map<string, [string, DeliveryMetrics][]>();
    for (const row of rows) {
      if (!row.campaign_id || !row.date_start) continue;
      map.set(row.campaign_id, [...(map.get(row.campaign_id) ?? []), [row.date_start, deliveryFromInsight(row)]]);
    }
    const entries = [...map];
    this.cache.set(key, entries, until >= dayInTimezone(new Date(), timeZone) ? CACHE_RECENT_MS : CACHE_CLOSED_MS);
    return build(entries);
  }

  /**
   * Última mudança de status e orçamento por campanha, do log de atividades da
   * Meta (14 dias, cache de 10 min). Ação do System User aparece como "dash.zip".
   */
  async recentChanges(workspaceId: string) {
    const db = this.supabase.getClient();
    const { data, error } = await db.from('facebook_connections').select('id,ad_account_id,account_name,account_currency,access_token')
      .eq('workspace_id', workspaceId).eq('is_active', true);
    if (error) throw new InternalServerErrorException('Não foi possível carregar as contas do painel.');
    const timeZone = await this.timezones.get(workspaceId);
    const today = dayInTimezone(new Date(), timeZone);
    const since = shiftDay(today, -13);
    const warnings: string[] = [];
    const changes: Record<string, CampaignChange[]> = {};
    await Promise.all(((data ?? []) as Connection[]).map(async (connection) => {
      const name = connection.account_name || connection.ad_account_id;
      const result = await this.loadAccount(connection, 'campaign', since, today, timeZone);
      if (!result.snapshot) { warnings.push(`${name}: ${result.error}`); return; }
      const key = `campaigns:${connection.id}:activities:${Math.floor(Date.now() / 600_000)}`;
      let events = this.cache.get<ActivityEvent[]>(key);
      if (!events) {
        try {
          events = await this.graph.getAll<ActivityEvent>(`${canonical(connection.ad_account_id)}/activities`, this.encryption.decryptIfNeeded(connection.access_token), {
            fields: 'event_type,translated_event_type,event_time,object_id,object_name,object_type,extra_data,actor_name',
            since: String(Math.floor(dayStartUtc(since, timeZone).getTime() / 1000)),
          }, 10);
          events = events.filter((event) => /budget|run_status/i.test(event.event_type ?? ''));
          this.cache.set(key, events, 10 * 60_000);
        } catch (err) {
          warnings.push(`${name}: ${err instanceof MetaGraphError ? err.message : 'falha ao ler o log de atividades.'}`);
          return;
        }
      }
      const hierarchy = result.snapshot.hierarchy;
      const campaignIds = new Set([...hierarchy.campaigns, ...result.snapshot.objects.map((o) => o.id)]);
      const byAdset = new Map(hierarchy.adsets.map(([id, v]) => [id, v.campaignId]));
      const byAd = new Map(hierarchy.ads.map(([id, v]) => [id, v.campaignId]));
      for (const change of parseActivities(events, campaignIds, byAdset, byAd)) {
        (changes[change.campaignId] ??= []).push(change);
      }
    }));
    for (const list of Object.values(changes)) list.sort((a, b) => b.at.localeCompare(a.at));
    return { since, until: today, changes, warnings };
  }

  /** Limpa o cache das contas depois de uma ação, para a tela ler o estado novo. */
  invalidate(connectionId: string) {
    this.cache.invalidateByPrefix(`campaigns:${connectionId}:`);
  }

  private filterRows(rows: CampaignRow[], query: ObjectsQuery) {
    const parents = query.parentIds?.length ? new Set(query.parentIds) : null;
    const statuses = query.status?.length ? new Set(query.status) : null;
    const text = query.q?.trim().toLowerCase();
    return rows.filter((row) => {
      if (parents && ![row.accountId, row.campaignId, row.adsetId, row.accountId.slice(4)].some((id) => id && parents.has(id))) return false;
      if (statuses && !(row.status && statuses.has(row.status))) return false;
      if (text && !row.name.toLowerCase().includes(text)) return false;
      return true;
    });
  }

  private failedAccountRow(
    connection: Connection, byObject: Map<string, AttributableSale[]>, checkouts: FinanceCheckout[],
    settings: FinanceSettings, exchangeRate: (currency: string, day: string) => number | null, basis: PerformanceBasis,
  ): CampaignRow {
    const id = canonical(connection.ad_account_id);
    const revenue = revenueOf(byObject.get(id), checkouts, settings, exchangeRate);
    return {
      id, level: 'account', name: connection.account_name || id, parentId: null, accountId: id,
      campaignId: null, adsetId: null, accountCurrency: connection.account_currency || '—',
      status: null, effectiveStatus: null, dailyBudget: null, lifetimeBudget: null, budgetLevel: null, createdTime: null,
      ...buildMetrics(null, null, null, revenue, basis),
    };
  }

  private basicInfo(connection: Connection): AccountInfo {
    return {
      id: canonical(connection.ad_account_id), connectionId: connection.id,
      name: connection.account_name || connection.ad_account_id, currency: connection.account_currency || '—',
      accountStatus: null, cycleSpend: null, totalSpend: null, spendCap: null,
    };
  }

  private mergeHierarchy(results: AccountResult[]): Hierarchy {
    const hierarchy: Hierarchy = { ads: new Map(), adsets: new Map(), campaigns: new Map() };
    for (const { snapshot } of results) {
      if (!snapshot) continue;
      const accountId = snapshot.info.id;
      for (const id of snapshot.hierarchy.campaigns) hierarchy.campaigns.set(id, { accountId });
      for (const [id, value] of snapshot.hierarchy.adsets) hierarchy.adsets.set(id, { ...value, accountId });
      for (const [id, value] of snapshot.hierarchy.ads) hierarchy.ads.set(id, { ...value, accountId });
    }
    return hierarchy;
  }

  private async loadAccount(connection: Connection, level: Level, since: string, until: string, timeZone: string): Promise<AccountResult> {
    const today = dayInTimezone(new Date(), timeZone);
    const key = `campaigns:${connection.id}:${level}:${since}:${until}`;
    const cached = this.cache.get<AccountSnapshot>(key);
    if (cached) return { connection, snapshot: cached, error: null };
    try {
      const snapshot = await this.fetchAccount(connection, level, since, until);
      this.cache.set(key, snapshot, until >= today ? CACHE_RECENT_MS : CACHE_CLOSED_MS);
      return { connection, snapshot, error: null };
    } catch (error) {
      const message = error instanceof MetaGraphError ? error.message : 'falha ao consultar a Meta.';
      return { connection, snapshot: null, error: message };
    }
  }

  private async fetchAccount(connection: Connection, level: Level, since: string, until: string): Promise<AccountSnapshot> {
    const token = this.encryption.decryptIfNeeded(connection.access_token);
    const accountId = canonical(connection.ad_account_id);
    const timeRange = JSON.stringify({ since, until });

    const accountCall = this.graph.get<{
      name: string; currency: string; account_status?: number; amount_spent?: string; balance?: string; spend_cap?: string;
    }>(accountId, token, { fields: 'name,currency,account_status,amount_spent,balance,spend_cap' });
    const campaignsCall = this.graph.getAll<ListedObject>(`${accountId}/campaigns`, token, {
      fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,created_time', filtering: statusFilter(LIVE_STATUSES.campaigns),
    });
    const adsetsCall = this.graph.getAll<ListedObject>(`${accountId}/adsets`, token, {
      fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,campaign_id,created_time', filtering: statusFilter(LIVE_STATUSES.adsets),
    });
    const adsCall = level === 'ad'
      ? this.graph.getAll<ListedObject>(`${accountId}/ads`, token, {
        fields: 'id,name,status,effective_status,adset_id,campaign_id,created_time', filtering: statusFilter(LIVE_STATUSES.ads),
      })
      : Promise.resolve([] as ListedObject[]);
    const insightsCall = this.graph.getAll<Insight>(`${accountId}/insights`, token, {
      level, fields: `${ID_FIELDS[level]},${METRIC_FIELDS}`, time_range: timeRange,
    });
    // Mapa anúncio → conjunto → campanha de quem entregou no período (para atribuir a venda pelo anúncio).
    const adMapCall = level === 'ad'
      ? Promise.resolve(null)
      : this.graph.getAll<Insight>(`${accountId}/insights`, token, {
        level: 'ad', fields: 'ad_id,adset_id,campaign_id,campaign_name,adset_name', time_range: timeRange,
      });

    const [account, campaigns, adsets, ads, insights, adMap] = await Promise.all([
      accountCall, campaignsCall, adsetsCall, adsCall, insightsCall, adMapCall,
    ]);
    const currency = account.currency;
    const daily = currency === 'BRL' ? null : await this.dailySpend(accountId, token, level, timeRange);

    const info: AccountInfo = {
      id: accountId, connectionId: connection.id, name: account.name || accountId, currency,
      accountStatus: accountStatusName(account.account_status ?? null),
      cycleSpend: fromMinor(account.balance), totalSpend: fromMinor(account.amount_spent),
      spendCap: account.spend_cap && Number(account.spend_cap) > 0 ? fromMinor(account.spend_cap) : null,
    };

    const campaignBudget = new Map(campaigns.map((c) => [c.id, !!(Number(c.daily_budget) || Number(c.lifetime_budget))]));
    const adsetById = new Map(adsets.map((a) => [a.id, a]));
    const budgetLevelFor = (campaignId: string | null) =>
      campaignId === null ? null : campaignBudget.get(campaignId) ? 'campaign' as const : 'adset' as const;

    const hierarchy: AccountSnapshot['hierarchy'] = { ads: [], adsets: [], campaigns: [] };
    const seenCampaigns = new Set<string>();
    const seenAdsets = new Map<string, string>();
    const seenAds = new Map<string, { adsetId: string; campaignId: string }>();
    for (const c of campaigns) seenCampaigns.add(c.id);
    for (const a of adsets) if (a.campaign_id) seenAdsets.set(a.id, a.campaign_id);
    for (const ad of ads) if (ad.adset_id && ad.campaign_id) seenAds.set(ad.id, { adsetId: ad.adset_id, campaignId: ad.campaign_id });
    for (const row of [...insights, ...(adMap ?? [])]) {
      if (row.campaign_id) seenCampaigns.add(row.campaign_id);
      if (row.adset_id && row.campaign_id) seenAdsets.set(row.adset_id, row.campaign_id);
      if (row.ad_id && row.adset_id && row.campaign_id) seenAds.set(row.ad_id, { adsetId: row.adset_id, campaignId: row.campaign_id });
    }
    hierarchy.campaigns = [...seenCampaigns];
    hierarchy.adsets = [...seenAdsets].map(([id, campaignId]) => [id, { campaignId }]);
    hierarchy.ads = [...seenAds];

    const delivery: [string, DeliveryMetrics][] = [];
    const insightId = (row: Insight) =>
      level === 'account' ? accountId : level === 'campaign' ? row.campaign_id : level === 'adset' ? row.adset_id : row.ad_id;
    for (const row of insights) {
      const id = insightId(row);
      if (id) delivery.push([id, deliveryFromInsight(row)]);
    }

    const objects: ObjectMeta[] = [];
    const base = { accountId, accountCurrency: currency };
    if (level === 'account') {
      objects.push({
        ...base, id: accountId, level, name: info.name, parentId: null, campaignId: null, adsetId: null,
        status: info.accountStatus, effectiveStatus: info.accountStatus,
        dailyBudget: null, lifetimeBudget: null, budgetLevel: null, createdTime: null,
      });
    } else {
      const listed: ListedObject[] = level === 'campaign' ? campaigns : level === 'adset' ? adsets : ads;
      const byId = new Map<string, ObjectMeta>();
      for (const item of listed) {
        const campaignId = level === 'campaign' ? item.id : item.campaign_id ?? null;
        const adsetId = level === 'ad' ? item.adset_id ?? null : level === 'adset' ? item.id : null;
        const budgetLevel = budgetLevelFor(campaignId);
        const ownsBudget = level === 'campaign' ? budgetLevel === 'campaign' : level === 'adset' ? budgetLevel === 'adset' : false;
        byId.set(item.id, {
          ...base, id: item.id, level, name: item.name || item.id,
          parentId: level === 'campaign' ? accountId : level === 'adset' ? campaignId : adsetId,
          campaignId, adsetId,
          status: item.status ?? null, effectiveStatus: item.effective_status ?? null,
          dailyBudget: ownsBudget ? fromMinor(item.daily_budget) : null,
          lifetimeBudget: ownsBudget ? fromMinor(item.lifetime_budget) : null,
          budgetLevel,
          createdTime: item.created_time ?? null,
        });
      }
      // Objetos que entregaram no período mas não estão na lista (arquivados ou excluídos).
      for (const row of insights) {
        const id = insightId(row);
        if (!id || byId.has(id)) continue;
        const campaignId = row.campaign_id ?? null;
        const adsetId = level === 'ad' ? row.adset_id ?? null : level === 'adset' ? id : null;
        const name = level === 'campaign' ? row.campaign_name : level === 'adset' ? row.adset_name : row.ad_name;
        byId.set(id, {
          ...base, id, level, name: name || id,
          parentId: level === 'campaign' ? accountId : level === 'adset' ? campaignId : adsetId,
          campaignId, adsetId, status: null, effectiveStatus: null,
          dailyBudget: null, lifetimeBudget: null, budgetLevel: budgetLevelFor(campaignId), createdTime: null,
        });
      }
      // Conjunto sem campanha conhecida ainda aparece com o nível de orçamento certo.
      for (const meta of byId.values()) {
        if (level === 'ad' && meta.adsetId && !meta.campaignId) meta.campaignId = adsetById.get(meta.adsetId)?.campaign_id ?? null;
      }
      objects.push(...byId.values());
    }

    return { info, objects, delivery, daily, hierarchy };
  }

  /** Gasto por objeto e dia, para converter pela PTAX do dia. */
  private async dailySpend(accountId: string, token: string, level: Level, timeRange: string) {
    const idField = level === 'account' ? 'account_id' : `${level}_id`;
    const rows = await this.graph.getAll<Insight>(`${accountId}/insights`, token, {
      level, fields: `${idField},spend,date_start`, time_range: timeRange, time_increment: '1',
    }, 40);
    const byObject = new Map<string, [string, number][]>();
    for (const row of rows) {
      const id = level === 'account' ? accountId : (row as Record<string, string | undefined>)[idField];
      const spend = Number(row.spend);
      if (!id || !row.date_start || !Number.isFinite(spend)) continue;
      const list = byObject.get(id) ?? [];
      list.push([row.date_start, spend]);
      byObject.set(id, list);
    }
    return [...byObject];
  }

  private async readSales(workspaceId: string, since: string, until: string, timeZone: string): Promise<AttributableSale[]> {
    const db = this.supabase.getClient();
    const { from, to } = dayRangeUtc(since, until, timeZone);
    const sales: AttributableSale[] = [];
    const size = 500;
    const maxRows = 25_000;
    for (let offset = 0; offset <= maxRows; offset += size) {
      const { data, error } = await db.from('sales')
        .select('id,external_id,order_external_id,checkout_integration_id,amount,currency,status,sold_at,metadata,payment_method,product_name,utm_campaign,utm_medium,utm_content,ad_id')
        .eq('workspace_id', workspaceId)
        // Pedido não pago (Pix gerado, cartão recusado) não é venda da campanha.
        .in('status', ['approved', 'refunded', 'chargeback'])
        .gte('sold_at', from).lt('sold_at', to)
        .order('sold_at', { ascending: true }).order('id', { ascending: true })
        .range(offset, offset + size - 1);
      if (error) throw new InternalServerErrorException('Não foi possível ler as vendas.');
      sales.push(...((data ?? []) as AttributableSale[]));
      if (sales.length > maxRows) break;
      if ((data ?? []).length < size) return sales;
    }
    throw new InternalServerErrorException('Há vendas demais neste período. Selecione um intervalo menor.');
  }

  /**
   * UTMs da chegada de cada venda casada. A busca é por sale_id, sem filtrar o
   * painel: sessões antigas podem ter ficado em painéis legados redirecionados.
   */
  private async readSessions(saleIds: string[]): Promise<Map<string, UtmSource>> {
    const result = new Map<string, UtmSource>();
    const db = this.supabase.getClient();
    for (let index = 0; index < saleIds.length; index += 200) {
      const chunk = saleIds.slice(index, index + 200);
      const { data, error } = await db.from('tracking_sessions')
        .select('sale_id,utm_campaign,utm_medium,utm_content,ad_id').in('sale_id', chunk);
      if (error) throw new InternalServerErrorException('Não foi possível ler as sessões das vendas.');
      for (const row of data ?? []) if (row.sale_id) result.set(row.sale_id, row);
    }
    return result;
  }
}

/**
 * Câmbio para o seletor de moeda da tela: a média da PTAX nos dias do período (para converter
 * métricas já somadas em BRL) e a do último dia (para orçamentos, que valem daqui pra frente).
 */
export function usdBrlFor(quotes: Map<string, number>, since: string, until: string) {
  const rates: number[] = [];
  for (let day = since; day <= until; day = shiftDay(day, 1)) {
    const rate = usdRateForDay(quotes, day);
    if (rate !== null) rates.push(rate);
  }
  const latest = usdRateForDay(quotes, until);
  return {
    period: rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10000) / 10000 : latest,
    latest,
  };
}
