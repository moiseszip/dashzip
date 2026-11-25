import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { EncryptionService } from '../../shared/services/encryption.service';
import { SupabaseService } from '../../shared/services/supabase.service';
import { WorkspaceTimezoneService } from '../../shared/services/workspace-timezone.service';
import { dayRangeUtc } from '../../shared/helpers/timezone';
import { sumMetrics } from '../campaigns/campaign-attribution';
import { CampaignsService } from '../campaigns/campaigns.service';
import { MetaGraphClient } from '../campaigns/meta-graph.client';
import { expenseOccurrences, sumOccurrences } from '../finance/expenses';
import { FinanceService } from '../finance/finance.service';
import { FinanceCheckout, usdRateForDay } from '../finance/finance-totals';
import { MetaSpendService } from '../finance/meta-spend.service';
import {
  buildSummary, CARD_CATALOG, CATEGORIES, CHART_CATALOG, DEFAULT_LAYOUT, MediaInput, previousPeriod, SessionUtms, SummarySale,
} from './summary-metrics';
import { storedIds } from '../wiapy/wiapy-sales';
import { WiapySalesService } from '../wiapy/wiapy-sales.service';

export interface SummaryQuery {
  days?: number;
  since?: string;
  until?: string;
  accountIds?: string[];
  products?: string[];
  platforms?: string[];
  compare: boolean;
}

interface Connection { id: string; ad_account_id: string; account_name: string | null; account_currency: string | null; access_token: string }

const MAX_HOURLY_DAYS = 31;

@Injectable()
export class SummaryService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly encryption: EncryptionService,
    private readonly campaigns: CampaignsService,
    private readonly finance: FinanceService,
    private readonly metaSpend: MetaSpendService,
    private readonly graph: MetaGraphClient,
    private readonly timezones: WorkspaceTimezoneService,
    private readonly wiapySales: WiapySalesService,
  ) {}

  async summary(workspaceId: string, query: SummaryQuery) {
    const timeZone = await this.timezones.get(workspaceId);
    const { since, until } = this.campaigns.resolvePeriod(query, timeZone);
    const current = await this.compute(workspaceId, since, until, query, true, timeZone);
    let previous: Awaited<ReturnType<SummaryService['compute']>> | null = null;
    if (query.compare) {
      const prev = previousPeriod(since, until);
      previous = await this.compute(workspaceId, prev.since, prev.until, query, false, timeZone).catch(() => null);
    }
    const previousByKey = new Map(previous?.numbers.cards.map((card) => [card.key, card.value]) ?? []);
    return {
      since, until,
      previousPeriod: query.compare ? previousPeriod(since, until) : null,
      currency: 'BRL' as const,
      cards: current.numbers.cards.map((card) => (query.compare ? { ...card, previous: previousByKey.get(card.key) ?? null } : card)),
      charts: current.numbers.charts,
      catalog: { categories: CATEGORIES, cards: CARD_CATALOG, charts: CHART_CATALOG },
      filters: current.filters,
      warnings: current.warnings,
      /** Opcional (o app iOS ignora): 'wiapy' quando o período veio da Wiapy na hora, 'webhook' quando só do banco. */
      salesSource: current.salesSource,
    };
  }

  defaultLayout() {
    return DEFAULT_LAYOUT;
  }

  private async compute(workspaceId: string, since: string, until: string, query: SummaryQuery, withCharts: boolean, timeZone: string) {
    const db = this.supabase.getClient();
    const warnings: string[] = [];
    const [settings, checkoutsResult, live, expenses, connectionsResult] = await Promise.all([
      this.finance.readSettings(workspaceId),
      db.from('checkout_integrations').select('id,platform,use_commission_value').eq('workspace_id', workspaceId),
      // Com a Wiapy conectada, o período vem dela (na hora) unido ao webhook.
      this.readSales(workspaceId, since, until, timeZone).then((stored) => this.wiapySales.merge(workspaceId, since, until, timeZone, stored, { origins: 'cached' })),
      this.finance.readExpenses(workspaceId),
      db.from('facebook_connections').select('id,ad_account_id,account_name,account_currency,access_token')
        .eq('workspace_id', workspaceId).eq('is_active', true),
    ]);
    if (checkoutsResult.error || connectionsResult.error) throw new InternalServerErrorException('Não foi possível carregar o painel.');
    const salesAll = live.rows;
    warnings.push(...live.warnings);
    const checkouts = (checkoutsResult.data ?? []) as FinanceCheckout[];
    const platformOf = new Map(checkouts.map((c) => [c.id, c.platform]));

    // Filtros de produto e plataforma valem para o pedido inteiro (o bump acompanha o principal).
    const orderKey = (s: SummarySale) => JSON.stringify([s.checkout_integration_id, s.order_external_id || s.external_id || s.id]);
    const products = query.products?.length ? new Set(query.products.map((p) => p.trim().toLowerCase())) : null;
    const platforms = query.platforms?.length ? new Set(query.platforms) : null;
    const keep = new Set<string>();
    for (const sale of salesAll) {
      const productOk = !products || products.has((sale.product_name ?? '').trim().toLowerCase());
      const platformOk = !platforms || platforms.has(platformOf.get(sale.checkout_integration_id ?? '') ?? '');
      if (productOk && platformOk) keep.add(orderKey(sale));
    }
    const sales = salesAll.filter((sale) => keep.has(orderKey(sale)));

    let quotes = new Map<string, number>();
    const linkedAccounts = (connectionsResult.data ?? []) as Connection[];
    const connections = linkedAccounts
      .filter((c) => !query.accountIds?.length || query.accountIds.some((id) => id.replace(/^act_/, '') === c.ad_account_id.replace(/^act_/, '')));
    if (connections.some((c) => c.account_currency === 'USD') || sales.some((s) => s.currency?.toUpperCase() === 'USD')) {
      quotes = await this.metaSpend.ptax(since, until).catch(() => {
        warnings.push('PTAX indisponível: valores em dólar ficam sem conversão.');
        return new Map<string, number>();
      });
    }
    const exchangeRate = (currency: string, day: string) => (currency === 'BRL' ? 1 : currency === 'USD' ? usdRateForDay(quotes, day) : null);

    const [media, sessions, tracking] = await Promise.all([
      this.media(workspaceId, since, until, query.accountIds, connections, exchangeRate, warnings, withCharts),
      withCharts ? this.readSessions(storedIds(sales.map((s) => s.id))) : Promise.resolve(new Map<string, SessionUtms>()),
      this.tracking(workspaceId, since, until, sales, timeZone),
    ]);
    const expensesBRL = sumOccurrences(expenseOccurrences(expenses, since, until));
    const numbers = buildSummary({ sales, sessions, checkouts, settings, exchangeRate, media, expensesBRL, tracking, timeZone });
    if (!withCharts) numbers.charts = {};

    const filters = {
      accounts: linkedAccounts.map((c) => ({
        id: `act_${c.ad_account_id.replace(/^act_/, '')}`,
        name: c.account_name?.trim() || null,
        currency: c.account_currency,
      })),
      products: [...new Set(salesAll.map((s) => s.product_name?.trim()).filter((p): p is string => !!p))].sort((a, b) => a.localeCompare(b)),
      platforms: [...new Set(checkouts.map((c) => c.platform))].sort(),
    };
    return { numbers, warnings, filters, salesSource: live.source };
  }

  /** Mídia do período: totais da tela de Campanhas (nível conta) + gasto por dia e por hora. */
  private async media(
    workspaceId: string, since: string, until: string, accountIds: string[] | undefined, connections: Connection[],
    rate: (currency: string, day: string) => number | null, warnings: string[], withSeries: boolean,
  ): Promise<MediaInput> {
    const objects = await this.campaigns.objects(workspaceId, { level: 'account', since, until });
    warnings.push(...objects.warnings);
    const wanted = accountIds?.length ? new Set(accountIds.map((id) => `act_${id.replace(/^act_/, '')}`)) : null;
    const rows = wanted ? objects.rows.filter((row) => wanted.has(row.accountId)) : objects.rows;
    const totals = sumMetrics(rows);
    const result: MediaInput = {
      spend: rows.length ? totals.spend : 0,
      mediaTax: rows.length ? totals.mediaTax : 0,
      impressions: rows.length ? totals.impressions : 0,
      clicks: rows.length ? totals.clicks : 0,
      landingPageViews: rows.length ? totals.landingPageViews : 0,
      initiateCheckouts: rows.length ? totals.initiateCheckouts : 0,
      spendByHour: null,
      spendByDay: null,
    };
    if (!withSeries) return result;

    // Gasto por dia (cache do Resultado) e por hora (só em períodos de até 31 dias).
    const byDay = new Map<string, number>();
    const byHour = new Array(24).fill(0);
    let dayOk = true;
    let hourOk = Date.parse(until) - Date.parse(since) <= (MAX_HOURLY_DAYS - 1) * 86_400_000;
    await Promise.all(connections.map(async (connection) => {
      const currency = connection.account_currency ?? 'BRL';
      const accountId = `act_${connection.ad_account_id.replace(/^act_/, '')}`;
      const row = rows.find((r) => r.accountId === accountId);
      try {
        const days = await this.metaSpend.campaignDays(connection.id, accountId, connection.access_token, since, until);
        for (const day of days) {
          const value = rate(currency, day.day);
          if (value === null) { dayOk = false; continue; }
          byDay.set(day.day, (byDay.get(day.day) ?? 0) + day.spend * value);
        }
      } catch {
        dayOk = false;
      }
      if (!hourOk) return;
      try {
        const token = this.encryption.decryptIfNeeded(connection.access_token);
        const hours = await this.graph.getAll<{ spend?: string; hourly_stats_aggregated_by_advertiser_time_zone?: string }>(
          `${accountId}/insights`, token, {
            level: 'account', fields: 'spend', time_range: JSON.stringify({ since, until }),
            breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone',
          }, 5);
        // Converte pela taxa média do período desta conta (gasto BRL ÷ gasto na moeda da conta).
        const average = row && row.spend !== null && row.spendNative ? row.spend / row.spendNative : currency === 'BRL' ? 1 : null;
        if (average === null) { hourOk = false; return; }
        for (const item of hours) {
          const hour = Number(item.hourly_stats_aggregated_by_advertiser_time_zone?.slice(0, 2));
          const spend = Number(item.spend);
          if (Number.isInteger(hour) && hour >= 0 && hour < 24 && Number.isFinite(spend)) byHour[hour] += spend * average;
        }
      } catch {
        hourOk = false;
      }
    }));
    result.spendByDay = dayOk ? byDay : null;
    result.spendByHour = hourOk && connections.length ? byHour : connections.length ? null : new Array(24).fill(0);
    if (!dayOk) warnings.push('Gasto por dia indisponível para alguma conta.');
    return result;
  }

  /** Sessões do rastreio first-party. Inclui os containers legados que redirecionam para este painel. */
  private async tracking(workspaceId: string, since: string, until: string, sales: SummarySale[], timeZone: string) {
    const db = this.supabase.getClient();
    const legacy = await db.from('workspaces').select('id').eq('redirect_workspace_id', workspaceId);
    const ids = [workspaceId, ...((legacy.data ?? []).map((row) => row.id as string))];
    const { from, to } = dayRangeUtc(since, until, timeZone);
    const [sessions, clicks] = await Promise.all([
      db.from('tracking_sessions').select('id', { count: 'exact', head: true }).in('workspace_id', ids).gte('started_at', from).lt('started_at', to),
      db.from('tracking_sessions').select('id', { count: 'exact', head: true }).in('workspace_id', ids).gte('started_at', from).lt('started_at', to)
        .eq('had_checkout_click', true),
    ]);
    const matched = new Set<string>();
    for (const sale of sales) {
      if (sale.status === 'approved' && (sale as SummarySale & { session_id?: string | null }).session_id) {
        matched.add(JSON.stringify([sale.checkout_integration_id, sale.order_external_id || sale.external_id || sale.id]));
      }
    }
    return {
      sessions: sessions.error ? null : sessions.count ?? 0,
      checkoutClicks: clicks.error ? null : clicks.count ?? 0,
      matchedSales: matched.size,
    };
  }

  private async readSales(workspaceId: string, since: string, until: string, timeZone: string): Promise<SummarySale[]> {
    const db = this.supabase.getClient();
    const range = dayRangeUtc(since, until, timeZone);
    const sales: SummarySale[] = [];
    const size = 500;
    for (let offset = 0; offset <= 25_000; offset += size) {
      const { data, error } = await db.from('sales')
        .select('id,external_id,order_external_id,checkout_integration_id,amount,currency,status,sold_at,metadata,payment_method,product_name,customer_country,customer_state,customer_email,customer_doc,customer_phone,utm_source,utm_term,session_id')
        .eq('workspace_id', workspaceId)
        .gte('sold_at', range.from).lt('sold_at', range.to)
        .order('sold_at', { ascending: true }).order('id', { ascending: true })
        .range(offset, offset + size - 1);
      if (error) throw new InternalServerErrorException('Não foi possível ler as vendas.');
      sales.push(...((data ?? []) as SummarySale[]));
      if ((data ?? []).length < size) return sales;
    }
    throw new InternalServerErrorException('Há vendas demais neste período. Selecione um intervalo menor.');
  }

  private async readSessions(saleIds: string[]) {
    const result = new Map<string, SessionUtms>();
    const db = this.supabase.getClient();
    for (let index = 0; index < saleIds.length; index += 200) {
      const { data, error } = await db.from('tracking_sessions').select('sale_id,utm_source,utm_term').in('sale_id', saleIds.slice(index, index + 200));
      if (error) throw new InternalServerErrorException('Não foi possível ler as sessões das vendas.');
      for (const row of data ?? []) if (row.sale_id) result.set(row.sale_id, row);
    }
    return result;
  }
}
