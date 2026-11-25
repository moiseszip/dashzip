/**
 * A aba "Vendas": as linhas da tabela sales viram pedidos.
 *
 * Uma compra com order bump é gravada em várias linhas (uma por produto), todas
 * com o mesmo order_external_id. A aba mostra o pedido: soma o valor, lista os
 * produtos e junta o status do Purchase enviado ao Meta.
 */

import { normalizePaymentMethod } from '../finance/finance-totals';
import { DEFAULT_TIMEZONE, dayInTimezone, dayRangeUtc, dayStartUtc } from '../../shared/helpers/timezone';

export const SALES_PERIODS = ['today', '7', '30', '90'] as const;
export type SalesPeriod = (typeof SALES_PERIODS)[number];

export interface SaleRow {
  id: string;
  external_id: string | null;
  order_external_id: string | null;
  amount: number | string | null;
  currency: string | null;
  status: string | null;
  payment_method: string | null;
  product_name: string | null;
  is_order_bump: boolean | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  ad_id: string | null;
  session_id: string | null;
  match_method: string | null;
  checkout_integration_id: string | null;
  sold_at: string;
  /** Valor bruto e taxa informados pelo checkout: entram no faturamento líquido. */
  metadata?: { gross_amount?: number; payment_fee?: number; amount_is_net?: boolean } | null;
  /** 'wiapy': lida na hora da Wiapy, sem linha no banco (sem Purchase nem visita). */
  source?: 'webhook' | 'wiapy';
}

export interface PurchaseRow {
  sale_id: string | null;
  status: string;
  error: string | null;
}

export type PurchaseStatus = 'sent' | 'failed' | 'pending' | null;

export interface SaleOrder {
  id: string;
  orderId: string;
  /** As linhas do pedido (principal e bumps): o Purchase aponta para uma delas. */
  lineIds: string[];
  soldAt: string;
  status: string;
  amount: number;
  currency: string;
  paymentMethod: string | null;
  platform: string | null;
  products: { name: string; amount: number; isOrderBump: boolean }[];
  customer: { name: string | null; email: string | null; phone: string | null };
  utm: { source: string | null; medium: string | null; campaign: string | null; content: string | null; term: string | null };
  adId: string | null;
  /** A venda foi ligada a uma visita rastreada (sales.session_id). */
  matched: boolean;
  matchMethod: string | null;
  purchase: PurchaseStatus;
  purchaseError: string | null;
  /** 'wiapy': o pedido só existe na Wiapy (veio da leitura na hora, não do webhook). */
  source: 'webhook' | 'wiapy';
}

/** Pedidos de um meio de pagamento no período. */
export interface MethodSummary {
  /** Pedidos aprovados (sem estorno) e a soma deles. */
  approved: number;
  approvedAmount: number;
  /** Todos os pedidos gerados com esse meio, em qualquer status. */
  generated: number;
  /** Pagos ÷ gerados; pago inclui os que depois foram estornados. Nulo sem pedidos. */
  approvalRate: number | null;
}

export interface SalesSummary {
  orders: number;
  revenue: number;
  /** Faturamento depois das taxas do checkout (mesma conta do Resultado). Nulo sem cotação. */
  netRevenue: number | null;
  refunded: number;
  pending: number;
  pendingAmount: number;
  matched: number;
  purchaseSent: number;
  pix: MethodSummary;
  card: MethodSummary;
  currency: string;
}

/** Maior intervalo aceito no seletor de datas (o mesmo das outras telas). */
export const MAX_RANGE_DAYS = 92;

/**
 * Limites em UTC de um intervalo de dias do fuso do painel (fim exclusivo).
 * Devolve null se o intervalo é inválido ou maior que MAX_RANGE_DAYS.
 */
export function dayRangeBounds(since: string, until: string, timeZone: string = DEFAULT_TIMEZONE): { from: string; to: string } | null {
  if (since > until) return null;
  const span = (Date.parse(`${until}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86_400_000 + 1;
  if (!Number.isFinite(span) || span > MAX_RANGE_DAYS) return null;
  return dayRangeUtc(since, until, timeZone);
}

/** Início do período rápido: "hoje" começa à meia-noite do fuso do painel; os demais são N×24 h para trás. */
export function periodStart(period: SalesPeriod, now = Date.now(), timeZone: string = DEFAULT_TIMEZONE): string {
  if (period === 'today') return dayStartUtc(dayInTimezone(new Date(now), timeZone), timeZone).toISOString();
  return new Date(now - Number(period) * 86_400_000).toISOString();
}

function money(v: number | string | null): number {
  const n = typeof v === 'string' ? Number(v) : v ?? 0;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** Envio do pedido: enviado ganha de falhou, que ganha de pendente. */
function bestPurchase(rows: PurchaseRow[]): { status: PurchaseStatus; error: string | null } {
  for (const status of ['sent', 'failed', 'pending'] as const) {
    const row = rows.find((r) => r.status === status);
    if (row) return { status, error: status === 'failed' ? row.error : null };
  }
  return { status: null, error: null };
}

/** Estorno e chargeback valem para o pedido inteiro. */
function orderStatus(lines: SaleRow[]): string {
  for (const s of ['chargeback', 'refunded', 'approved', 'pending', 'refused']) {
    if (lines.some((l) => l.status === s)) return s;
  }
  return lines[0]?.status ?? 'approved';
}

export function buildOrders(
  rows: SaleRow[],
  purchases: PurchaseRow[],
  platforms: Map<string, string>,
): SaleOrder[] {
  const groups = new Map<string, SaleRow[]>();
  for (const row of rows) {
    const key = row.order_external_id || row.external_id || row.id;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const bySale = new Map<string, PurchaseRow[]>();
  for (const p of purchases) {
    if (!p.sale_id) continue;
    const list = bySale.get(p.sale_id);
    if (list) list.push(p);
    else bySale.set(p.sale_id, [p]);
  }

  const orders: SaleOrder[] = [];
  for (const [orderId, lines] of groups) {
    // Principal primeiro, depois os order bumps.
    lines.sort((a, b) => Number(!!a.is_order_bump) - Number(!!b.is_order_bump));
    const main = lines[0];
    const matchedLine = lines.find((l) => l.session_id);
    const purchase = bestPurchase(lines.flatMap((l) => bySale.get(l.id) ?? []));
    orders.push({
      id: main.id,
      orderId,
      lineIds: lines.map((l) => l.id),
      soldAt: lines.reduce((min, l) => (l.sold_at < min ? l.sold_at : min), main.sold_at),
      status: orderStatus(lines),
      amount: money(lines.reduce((sum, l) => sum + money(l.amount), 0)),
      currency: main.currency || 'BRL',
      paymentMethod: main.payment_method,
      platform: main.checkout_integration_id ? platforms.get(main.checkout_integration_id) ?? null : null,
      products: lines.map((l) => ({
        name: l.product_name || 'Sem produto',
        amount: money(l.amount),
        isOrderBump: !!l.is_order_bump,
      })),
      customer: { name: main.customer_name, email: main.customer_email, phone: main.customer_phone },
      utm: {
        source: main.utm_source,
        medium: main.utm_medium,
        campaign: main.utm_campaign,
        content: main.utm_content,
        term: main.utm_term,
      },
      adId: lines.find((l) => l.ad_id)?.ad_id ?? null,
      matched: !!matchedLine,
      matchMethod: matchedLine?.match_method ?? null,
      purchase: purchase.status,
      purchaseError: purchase.error,
      source: lines.every((l) => l.source === 'wiapy') ? 'wiapy' : 'webhook',
    });
  }

  return orders.sort((a, b) => (a.soldAt < b.soldAt ? 1 : a.soldAt > b.soldAt ? -1 : 0));
}

const PAID = new Set(['approved', 'refunded', 'chargeback']);

function methodSummary(orders: SaleOrder[], method: 'pix' | 'credit_card'): MethodSummary {
  const list = orders.filter((o) => normalizePaymentMethod(o.paymentMethod) === method);
  const approved = list.filter((o) => o.status === 'approved');
  return {
    approved: approved.length,
    approvedAmount: money(approved.reduce((sum, o) => sum + o.amount, 0)),
    generated: list.length,
    approvalRate: list.length ? list.filter((o) => PAID.has(o.status)).length / list.length : null,
  };
}

export function summarize(orders: SaleOrder[], netRevenue: number | null = null): SalesSummary {
  const approved = orders.filter((o) => o.status === 'approved');
  const pending = orders.filter((o) => o.status === 'pending');
  return {
    orders: approved.length,
    revenue: money(approved.reduce((sum, o) => sum + o.amount, 0)),
    netRevenue,
    refunded: orders.filter((o) => o.status === 'refunded' || o.status === 'chargeback').length,
    pending: pending.length,
    pendingAmount: money(pending.reduce((sum, o) => sum + o.amount, 0)),
    matched: approved.filter((o) => o.matched).length,
    purchaseSent: approved.filter((o) => o.purchase === 'sent').length,
    pix: methodSummary(orders, 'pix'),
    card: methodSummary(orders, 'credit_card'),
    currency: approved[0]?.currency ?? orders[0]?.currency ?? 'BRL',
  };
}
