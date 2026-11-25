import { dayInTimezone, shiftDay } from '../../shared/helpers/timezone';

/**
 * Vendas da Wiapy lidas na hora (my_sales_list / my_sales_get) no formato das
 * linhas da tabela sales, e a união com as vendas do webhook. Tudo puro, para
 * testar com números fechados. Nada disto é gravado: ver
 * docs/features/07-integrations/wiapy.md.
 */

/** Item de my_sales_list, como a Wiapy devolve. */
export interface WiapyListSale {
  id: string;
  /** Criação da venda (UTC). */
  date: string;
  /** Última movimentação: é por ela que o período da Wiapy filtra. */
  last_update?: string | null;
  status: string;
  payment_method?: string | null;
  received?: number | null;
  sale_amount?: number | null;
  fee?: number | null;
  product?: { id?: string | null; title?: string | null } | null;
  orderbumps?: { id?: string | null; title?: string | null }[] | null;
  customer?: { name?: string | null; email?: string | null; phone?: string | null; document?: string | null } | null;
}

export interface WiapyListPage {
  sales: WiapyListSale[];
  pages: number;
}

/** Origem de uma venda (my_sales_get.origin). */
export interface WiapyOrigin {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  state: string | null;
  country: string | null;
}

/** Linha no formato de `sales`, com todas as colunas que Resultado, Vendas e Campanhas leem. */
export interface LiveSaleRow {
  id: string;
  external_id: string | null;
  order_external_id: string | null;
  checkout_integration_id: string | null;
  amount: number | string;
  currency: string | null;
  status: string | null;
  sold_at: string;
  payment_method: string | null;
  product_name: string | null;
  is_order_bump: boolean | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_doc: string | null;
  customer_country: string | null;
  customer_state: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  ad_id: string | null;
  session_id: string | null;
  match_method: string | null;
  metadata: Record<string, unknown> | null;
  /** De onde veio a linha: o webhook (gravada) ou a Wiapy (lida agora). */
  source?: 'webhook' | 'wiapy';
}

/** Prefixo dos ids das linhas lidas da Wiapy: não são uuid, e não existem no banco. */
export const WIAPY_ROW_PREFIX = 'wiapy-';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Só os ids gravados no banco: as consultas por sale_id quebram com outro formato. */
export function storedIds(ids: string[]): string[] {
  return ids.filter((id) => UUID.test(id));
}

const STATUS: Record<string, string> = {
  paid: 'approved',
  approved: 'approved',
  unpaid: 'pending',
  pending: 'pending',
  waiting_payment: 'pending',
  refunded: 'refunded',
  chargedback: 'chargeback',
  chargeback: 'chargeback',
};

/** Status da Wiapy → status de `sales`. O que não é pago, pendente ou estorno (recusado, expirado, cancelado) é recusado. */
export function mapStatus(status: string | null | undefined): string {
  return STATUS[(status ?? '').toLowerCase()] ?? 'refused';
}

const PAYMENT: Record<string, string> = { pix: 'pix', credit_card: 'credit_card', card: 'credit_card', boleto: 'boleto', bank_slip: 'boleto' };

function money(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : (value as number);
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** Item de my_sales_list → linha de `sales`. Ordem de produto: o principal; os bumps vão no nome. */
export function toSaleRow(sale: WiapyListSale, checkoutIntegrationId: string | null, origin?: WiapyOrigin | null): LiveSaleRow {
  const amount = money(sale.sale_amount) ?? 0;
  const fee = money(sale.fee);
  const bumps = (sale.orderbumps ?? []).map((b) => text(b?.title)).filter((t): t is string => !!t);
  return {
    id: `${WIAPY_ROW_PREFIX}${sale.id}`,
    external_id: sale.id,
    order_external_id: null,
    checkout_integration_id: checkoutIntegrationId,
    amount,
    currency: 'BRL',
    status: mapStatus(sale.status),
    sold_at: new Date(sale.date).toISOString(),
    payment_method: PAYMENT[(sale.payment_method ?? '').toLowerCase()] ?? text(sale.payment_method),
    product_name: text(sale.product?.title),
    is_order_bump: false,
    customer_name: text(sale.customer?.name),
    customer_email: text(sale.customer?.email)?.toLowerCase() ?? null,
    customer_phone: text(sale.customer?.phone),
    customer_doc: text(sale.customer?.document),
    customer_country: origin?.country ?? null,
    customer_state: origin?.state ?? null,
    utm_source: origin?.utm_source ?? null,
    utm_medium: origin?.utm_medium ?? null,
    utm_campaign: origin?.utm_campaign ?? null,
    utm_content: origin?.utm_content ?? null,
    utm_term: origin?.utm_term ?? null,
    ad_id: null,
    session_id: null,
    match_method: null,
    metadata: {
      source: 'wiapy',
      // Mesma conta do webhook (checkout-specs: payment.amount e payment.fee): bruto menos a taxa Wiapy.
      gross_amount: amount,
      ...(fee !== null ? { payment_fee: fee } : {}),
      amount_is_net: false,
      received: money(sale.received),
      product_id: text(sale.product?.id),
      ...(bumps.length ? { order_bumps: bumps } : {}),
    },
    source: 'wiapy',
  };
}

/** my_sales_get.origin → as UTMs. */
export function parseOrigin(detail: unknown): WiapyOrigin {
  const origin = (detail as { origin?: Record<string, unknown> } | null)?.origin ?? {};
  return {
    utm_source: text(origin.utm_source),
    utm_medium: text(origin.utm_medium),
    utm_campaign: text(origin.utm_campaign),
    utm_content: text(origin.utm_content),
    utm_term: text(origin.utm_term),
    state: text(origin.state),
    country: text(origin.country),
  };
}

/** Resposta de my_sales_list → página. Aceita `result.sales` ou `sales` na raiz. */
export function parseListPage(payload: unknown): WiapyListPage {
  const root = (payload ?? {}) as { result?: { sales?: unknown }; sales?: unknown; pagination?: { pages?: unknown } };
  const raw = Array.isArray(root.result?.sales) ? root.result!.sales : Array.isArray(root.sales) ? root.sales : null;
  if (!raw) throw new Error('Lista de vendas da Wiapy em formato inesperado.');
  const sales = (raw as WiapyListSale[]).filter((s) => s && typeof s.id === 'string' && typeof s.date === 'string' && !Number.isNaN(Date.parse(s.date)));
  const pages = Number(root.pagination?.pages);
  return { sales, pages: Number.isFinite(pages) && pages > 0 ? Math.floor(pages) : 1 };
}

/**
 * Janela pedida à Wiapy. O período dela filtra pela última movimentação, e a
 * movimentação vem sempre depois da criação: começando no dia anterior a
 * `since` (folga de fuso) e indo até 31 dias depois de `until` (ou hoje), toda
 * venda criada no período aparece, salvo a que só mexeu mais de um mês depois
 * (estorno tardio) — e essa já não conta como faturamento.
 */
export const LATE_MOVEMENT_DAYS = 31;

export function listWindow(since: string, until: string, today: string): { dateStart: string; dateEnd: string } {
  const end = shiftDay(until, LATE_MOVEMENT_DAYS);
  return { dateStart: shiftDay(since, -1), dateEnd: end < today ? end : today };
}

/** Só as vendas criadas no período, no fuso do painel. */
export function inPeriod(sale: { date: string }, since: string, until: string, timeZone: string): boolean {
  const day = dayInTimezone(new Date(sale.date), timeZone);
  return day >= since && day <= until;
}

const STATUS_RANK: Record<string, number> = { refused: 0, pending: 1, approved: 2, refunded: 3, chargeback: 3 };
const FILLABLE = [
  'payment_method', 'product_name', 'customer_name', 'customer_email', 'customer_phone', 'customer_doc', 'customer_country',
  'customer_state', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
] as const;

/**
 * Une as linhas do banco (webhook) com as lidas da Wiapy, sem contar duas vezes.
 * A chave é o id da venda na Wiapy (external_id do webhook). A linha do webhook
 * manda — sessão, UTM, anúncio e produto continuam os dela —; a da Wiapy só
 * completa campos vazios e avança o status quando a venda andou (pendente →
 * paga, paga → estornada), porque o webhook pode não ter recebido o último evento.
 */
export function mergeSales<T extends { id: string; external_id: string | null; order_external_id?: string | null; status: string | null }>(
  stored: T[],
  live: LiveSaleRow[],
): T[] {
  const byExternal = new Map<string, LiveSaleRow>();
  for (const row of live) if (row.external_id) byExternal.set(row.external_id, row);
  const used = new Set<string>();
  const merged: T[] = stored.map((row) => {
    const match = (row.external_id && byExternal.get(row.external_id)) || (row.order_external_id && byExternal.get(row.order_external_id)) || null;
    if (!match) return row;
    used.add(match.external_id!);
    const filled: Record<string, unknown> = { ...row };
    for (const field of FILLABLE) {
      if ((filled[field] === null || filled[field] === undefined || filled[field] === '') && match[field]) filled[field] = match[field];
    }
    const metadata = (row as { metadata?: Record<string, unknown> | null }).metadata;
    const fee = (match.metadata as { payment_fee?: number } | null)?.payment_fee;
    if ('metadata' in row && fee !== undefined && (metadata?.payment_fee === undefined || metadata?.payment_fee === null)) {
      filled.metadata = { ...(metadata ?? {}), payment_fee: fee };
    }
    if ((STATUS_RANK[match.status ?? ''] ?? -1) > (STATUS_RANK[row.status ?? ''] ?? -1)) filled.status = match.status;
    return filled as T;
  });
  for (const row of live) {
    if (!row.external_id || used.has(row.external_id)) continue;
    merged.push(row as unknown as T);
  }
  return merged;
}
