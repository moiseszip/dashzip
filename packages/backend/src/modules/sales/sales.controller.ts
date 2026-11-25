import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseService } from '../../shared/services/supabase.service';
import { WorkspaceTimezoneService } from '../../shared/services/workspace-timezone.service';
import { dayInTimezone } from '../../shared/helpers/timezone';
import { DebugService } from '../debug/debug.service';
import { FinanceService } from '../finance/finance.service';
import { FinanceCheckout, FinanceSale, salesTotals, usdRateForDay } from '../finance/finance-totals';
import { MetaSpendService } from '../finance/meta-spend.service';
import {
  buildOrders,
  dayRangeBounds,
  periodStart,
  PurchaseRow,
  SaleOrder,
  SaleRow,
  SALES_PERIODS,
  SalesPeriod,
  SalesSummary,
  summarize,
} from './sales-list';
import { storedIds } from '../wiapy/wiapy-sales';
import { WiapySalesService } from '../wiapy/wiapy-sales.service';

/** Linhas lidas por consulta. Passando disso, a aba avisa que cortou. */
const MAX_ROWS = 2000;
/** sale_id por consulta do capi_events: a lista vai na URL do PostgREST. */
const IDS_PER_QUERY = 150;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

class SalesQueryDto {
  @IsUUID()
  workspace_id!: string;

  @IsOptional()
  @IsIn(SALES_PERIODS as unknown as string[])
  period?: SalesPeriod;

  /** Intervalo do seletor de datas, em dias do fuso do painel. Tem prioridade sobre `period`. */
  @IsOptional() @Matches(DAY)
  since?: string;

  @IsOptional() @Matches(DAY)
  until?: string;
}

class PurchaseQueryDto {
  @IsUUID()
  workspace_id!: string;

  /** Ids das linhas do pedido, separados por vírgula (até 20). */
  @Matches(/^[0-9a-f-]{36}(,[0-9a-f-]{36}){0,19}$/i)
  sale_ids!: string;
}

type Settings = Awaited<ReturnType<FinanceService['readSettings']>>;

/** A aba "Vendas": os pedidos que chegaram pelos webhooks dos checkouts. */
@Controller('sales')
@UseGuards(AuthGuard)
export class SalesController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly debug: DebugService,
    private readonly finance: FinanceService,
    private readonly metaSpend: MetaSpendService,
    private readonly timezones: WorkspaceTimezoneService,
    private readonly wiapySales: WiapySalesService,
  ) {}

  @Get()
  async list(
    @CurrentUser('id') userId: string,
    @Query() q: SalesQueryDto,
  ): Promise<{ summary: SalesSummary; orders: SaleOrder[]; truncated: boolean; source?: 'wiapy' | 'webhook'; warnings?: string[] }> {
    await this.debug.assertOwner(userId, q.workspace_id);
    const client = this.supabase.getClient();
    const timeZone = await this.timezones.get(q.workspace_id);

    let query = client
      .from('sales')
      .select(
        'id, external_id, order_external_id, amount, currency, status, payment_method, product_name, is_order_bump, customer_name, customer_email, customer_phone, utm_source, utm_medium, utm_campaign, utm_content, utm_term, ad_id, session_id, match_method, checkout_integration_id, sold_at, metadata',
      )
      .eq('workspace_id', q.workspace_id);
    // Dias do período (para a Wiapy) e o início exato (o período rápido conta N×24 h).
    let days: { since: string; until: string; from: string | null };
    if (q.since || q.until) {
      const bounds = q.since && q.until ? dayRangeBounds(q.since, q.until, timeZone) : null;
      if (!bounds) throw new BadRequestException('Escolha um intervalo válido de até 92 dias.');
      query = query.gte('sold_at', bounds.from).lt('sold_at', bounds.to);
      days = { since: q.since!, until: q.until!, from: null };
    } else {
      const start = periodStart(q.period ?? '7', Date.now(), timeZone);
      query = query.gte('sold_at', start);
      days = { since: dayInTimezone(new Date(start), timeZone), until: dayInTimezone(new Date(), timeZone), from: start };
    }

    const [sales, integrations, settings] = await Promise.all([
      query.order('sold_at', { ascending: false }).limit(MAX_ROWS),
      client.from('checkout_integrations').select('id, platform, use_commission_value').eq('workspace_id', q.workspace_id),
      // Sem as regras de taxa o faturamento líquido fica vazio, mas a lista continua.
      this.finance.readSettings(q.workspace_id).catch(() => null),
    ]);
    if (sales.error) throw new Error(sales.error.message);

    const live = await this.wiapySales.merge(q.workspace_id, days.since, days.until, timeZone, (sales.data ?? []) as SaleRow[], { origins: 'cached' });
    const rows = live.rows
      .filter((r) => !days.from || r.sold_at >= days.from)
      .sort((a, b) => (a.sold_at < b.sold_at ? 1 : a.sold_at > b.sold_at ? -1 : 0));
    const checkouts = (integrations.data ?? []) as FinanceCheckout[];
    const platforms = new Map<string, string>(checkouts.map((i) => [i.id, i.platform]));

    const ids = storedIds(rows.map((r) => r.id));
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += IDS_PER_QUERY) chunks.push(ids.slice(i, i + IDS_PER_QUERY));
    const results = await Promise.all(
      chunks.map((chunk) =>
        client
          .from('capi_events')
          .select('sale_id, status, error')
          .eq('workspace_id', q.workspace_id)
          .eq('event_name', 'Purchase')
          .in('sale_id', chunk),
      ),
    );
    // Sem o status do Purchase a lista ainda serve: o erro aqui não derruba a aba.
    const purchases = results.flatMap((r) => (r.data ?? []) as PurchaseRow[]);

    const orders = buildOrders(rows, purchases, platforms);
    const netRevenue = settings ? await this.netRevenue(rows, checkouts, settings, timeZone) : null;
    return {
      summary: summarize(orders, netRevenue),
      orders,
      truncated: (sales.data ?? []).length >= MAX_ROWS,
      // Opcionais: de onde veio o período e o aviso de Wiapy indisponível.
      source: live.source,
      warnings: live.warnings,
    };
  }

  /** Faturamento líquido com a mesma conta do Resultado: o pedido aprovado menos a taxa do checkout. */
  private async netRevenue(rows: SaleRow[], checkouts: FinanceCheckout[], settings: Settings, timeZone: string): Promise<number | null> {
    if (!rows.length) return 0;
    let quotes = new Map<string, number>();
    if (rows.some((r) => r.currency?.toUpperCase() === 'USD')) {
      const days = rows.map((r) => dayInTimezone(new Date(r.sold_at), timeZone)).sort();
      quotes = await this.metaSpend.ptax(days[0], days[days.length - 1]).catch(() => new Map<string, number>());
    }
    const exchangeRate = (currency: string, day: string) =>
      currency === 'BRL' ? 1 : currency === 'USD' ? usdRateForDay(quotes, day) : null;
    return salesTotals(rows as unknown as FinanceSale[], checkouts, settings, exchangeRate, timeZone).checkoutNetBRL;
  }

  /**
   * O Purchase do pedido como foi enviado ao Meta: o evento (dados pessoais em
   * SHA-256, IP e user agent em claro, como o Meta exige) e a resposta dele.
   */
  @Get('purchase')
  async purchase(@CurrentUser('id') userId: string, @Query() q: PurchaseQueryDto) {
    await this.debug.assertOwner(userId, q.workspace_id);
    const { data, error } = await this.supabase
      .getClient()
      .from('capi_events')
      .select('id, event_id, sale_id, status, attempts, payload, response, fbtrace_id, error, created_at, sent_at')
      .eq('workspace_id', q.workspace_id)
      .eq('event_name', 'Purchase')
      .in('sale_id', q.sale_ids.split(','))
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return { events: data ?? [] };
  }
}
