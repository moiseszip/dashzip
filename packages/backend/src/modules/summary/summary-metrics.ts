import { BRAZIL_STATES, countryCode, countryName, normalizeCountry, normalizeState } from './geo';
import { DEFAULT_TIMEZONE, dayInTimezone, hourInTimezone, weekdayInTimezone } from '../../shared/helpers/timezone';
import {
  dashboardFinance, ExchangeRate, FinanceCheckout, FinanceSale, FinanceSettings, normalizePaymentMethod, roundMoney, salesTotals,
} from '../finance/finance-totals';

/**
 * Números do Resumo (docs/features/24-summary/summary.md). Tudo puro: recebe
 * vendas, mídia e despesas já lidas e devolve cards e séries prontas.
 */

export type Unit = 'BRL' | 'int' | 'pct' | 'ratio';

export interface Card {
  key: string;
  label: string;
  value: number | null;
  unit: Unit;
  previous?: number | null;
}

export interface SeriesPoint {
  label: string;
  [metric: string]: string | number | null;
}

export interface SummarySale extends FinanceSale {
  customer_country?: string | null;
  customer_state?: string | null;
  customer_email?: string | null;
  customer_doc?: string | null;
  customer_phone?: string | null;
  utm_source?: string | null;
  utm_term?: string | null;
}

export interface SessionUtms {
  utm_source?: string | null;
  utm_term?: string | null;
}

export interface MediaInput {
  spend: number | null;
  mediaTax: number | null;
  impressions: number | null;
  clicks: number | null;
  landingPageViews: number | null;
  initiateCheckouts: number | null;
  /** Gasto em BRL por hora do dia (0–23), somado no período. null = indisponível. */
  spendByHour: number[] | null;
  /** Gasto em BRL por dia. */
  spendByDay: Map<string, number> | null;
}

export interface TrackingInput {
  sessions: number | null;
  checkoutClicks: number | null;
  matchedSales: number | null;
}

export interface SummaryInput {
  sales: SummarySale[];
  sessions: Map<string, SessionUtms>;
  checkouts: FinanceCheckout[];
  settings: FinanceSettings;
  exchangeRate: ExchangeRate;
  media: MediaInput;
  expensesBRL: number;
  tracking: TrackingInput;
  /** Fuso do painel: dia, hora e dia da semana de cada pedido. Padrão São Paulo. */
  timeZone?: string;
}

/**
 * Catálogo dos cards e gráficos, na ordem padrão. `category` agrupa o catálogo no
 * "Adicionar card"; qualquer item pode ir para qualquer seção do layout.
 */
export const CARD_CATALOG: { key: string; label: string; unit: Unit; category: string; hint: string }[] = [
  { key: 'grossRevenue', label: 'Faturamento bruto', unit: 'BRL', category: 'general', hint: 'Valor bruto dos pedidos aprovados, somado antes das taxas do checkout.' },
  { key: 'netRevenue', label: 'Faturamento líquido', unit: 'BRL', category: 'general', hint: 'Receita aprovada após as taxas do checkout. Usa o líquido informado ou subtrai as taxas conhecidas do bruto.' },
  { key: 'spend', label: 'Gasto com anúncios', unit: 'BRL', category: 'general', hint: 'Investimento das contas de anúncio selecionadas, convertido para reais.' },
  { key: 'profit', label: 'Lucro', unit: 'BRL', category: 'general', hint: 'Quanto sobra da operação. Faturamento líquido − CMV − imposto sobre vendas − anúncios − IOF.' },
  { key: 'roi', label: 'ROI', unit: 'ratio', category: 'general', hint: 'Retorno sobre anúncios e IOF antes do CMV. (Faturamento líquido − imposto sobre vendas) ÷ (anúncios + IOF).' },
  { key: 'roas', label: 'ROAS', unit: 'ratio', category: 'general', hint: 'Receita bruta por real investido em anúncios. Faturamento bruto ÷ gasto com anúncios.' },
  { key: 'margin', label: 'Margem', unit: 'pct', category: 'general', hint: 'Percentual do faturamento líquido que virou lucro. Lucro ÷ faturamento líquido × 100.' },
  { key: 'sales', label: 'Vendas', unit: 'int', category: 'sales', hint: 'Número de pedidos aprovados. Itens do mesmo pedido contam como uma venda.' },
  // Chave antiga (era o ticket médio por pedido); os layouts salvos seguem valendo.
  { key: 'avgTicket', label: 'ARPU', unit: 'BRL', category: 'sales', hint: 'Receita média por cliente. Faturamento bruto ÷ compradores únicos.' },
  { key: 'cpa', label: 'CPA', unit: 'BRL', category: 'general', hint: 'Gasto com anúncios por venda. Gasto com anúncios ÷ pedidos aprovados.' },
  { key: 'pendingSales', label: 'Vendas pendentes', unit: 'int', category: 'sales', hint: 'Número de pedidos que estão aguardando pagamento.' },
  { key: 'pendingRevenue', label: 'Faturamento pendente', unit: 'BRL', category: 'sales', hint: 'Soma do valor dos pedidos que estão aguardando pagamento.' },
  { key: 'pixConversion', label: 'Pix pago / gerado', unit: 'pct', category: 'sales', hint: 'Percentual dos Pix gerados que chegaram a ser pagos. Pedidos Pix pagos ÷ pedidos Pix no período × 100.' },
  { key: 'refundRate', label: 'Taxa de reembolso', unit: 'pct', category: 'sales', hint: 'Percentual de pedidos reembolsados entre aprovados, reembolsados e com chargeback.' },
  { key: 'refundedRevenue', label: 'Valor reembolsado', unit: 'BRL', category: 'sales', hint: 'Soma do valor dos pedidos reembolsados no período.' },
  { key: 'chargebackRate', label: 'Taxa de chargeback', unit: 'pct', category: 'sales', hint: 'Percentual de pedidos com chargeback entre aprovados, reembolsados e com chargeback.' },
  { key: 'fees', label: 'Taxas', unit: 'BRL', category: 'costs', hint: 'Soma das tarifas do checkout e das taxas extras configuradas para as vendas aprovadas.' },
  { key: 'taxes', label: 'Impostos', unit: 'BRL', category: 'costs', hint: 'Soma dos impostos sobre pedidos aprovados, de acordo com as regras configuradas.' },
  { key: 'mediaTax', label: 'Custo sobre mídia', unit: 'BRL', category: 'costs', hint: 'Soma de IOF e demais custos configurados sobre a mídia. Aplica cada regra ao gasto das contas correspondentes.' },
  { key: 'productCosts', label: 'Custo de produto', unit: 'BRL', category: 'costs', hint: 'CMV dos itens aprovados. Soma do custo cadastrado para cada item vendido.' },
  { key: 'expenses', label: 'Despesas', unit: 'BRL', category: 'costs', hint: 'Soma das ocorrências de despesas cadastradas para o período.' },
  { key: 'impressions', label: 'Impressões', unit: 'int', category: 'media', hint: 'Número de vezes que os anúncios foram exibidos, conforme a Meta.' },
  { key: 'clicks', label: 'Cliques no link', unit: 'int', category: 'media', hint: 'Cliques no link do anúncio registrados pela Meta.' },
  { key: 'ctr', label: 'CTR', unit: 'pct', category: 'media', hint: 'Percentual de impressões que viraram cliques no link. Cliques no link ÷ impressões × 100.' },
  { key: 'cpc', label: 'CPC', unit: 'BRL', category: 'media', hint: 'Custo por clique no link. Gasto com anúncios ÷ cliques no link.' },
  { key: 'cpm', label: 'CPM', unit: 'BRL', category: 'media', hint: 'Custo por mil impressões. Gasto com anúncios ÷ impressões × 1.000.' },
  { key: 'landingPageViews', label: 'Visualizações da página', unit: 'int', category: 'media', hint: 'Visualizações da página de destino registradas pela Meta.' },
  { key: 'initiateCheckouts', label: 'Inícios de checkout (Meta)', unit: 'int', category: 'media', hint: 'Eventos de início de checkout registrados pela Meta.' },
  { key: 'costPerCheckout', label: 'Custo por início de checkout', unit: 'BRL', category: 'media', hint: 'Custo por início de checkout. Gasto com anúncios ÷ inícios de checkout da Meta.' },
  { key: 'sessions', label: 'Sessões rastreadas', unit: 'int', category: 'tracking', hint: 'Número de sessões registradas pelo rastreio do painel no período.' },
  { key: 'checkoutClicks', label: 'Cliques no checkout', unit: 'int', category: 'tracking', hint: 'Número de sessões rastreadas com pelo menos um clique no checkout.' },
  { key: 'checkoutClickRate', label: 'Sessões com clique no checkout', unit: 'pct', category: 'tracking', hint: 'Percentual de sessões com clique. Sessões com clique no checkout ÷ sessões rastreadas × 100.' },
  { key: 'sessionConversion', label: 'Conversão da sessão', unit: 'pct', category: 'tracking', hint: 'Vendas aprovadas vinculadas a sessões por 100 sessões rastreadas. Vendas vinculadas ÷ sessões × 100.' },
];

export const CHART_CATALOG: { key: string; label: string; category: string; hint: string }[] = [
  { key: 'hourly', label: 'Faturamento, investimento e lucro acumulados por hora', category: 'general', hint: 'Soma acumulada do faturamento bruto e do gasto até cada hora. O lucro estimado distribui custos e impostos proporcionalmente no período.' },
  { key: 'daily', label: 'Faturamento, gasto e lucro por dia', category: 'general', hint: 'Faturamento bruto e gasto de cada dia. O lucro estimado distribui os custos e impostos conforme o faturamento e o gasto de cada dia.' },
  { key: 'funnelMeta', label: 'Funil de conversão da Meta', category: 'media', hint: 'Etapas da Meta e vendas do painel. A taxa de passagem divide o volume de cada etapa pelo da etapa anterior.' },
  { key: 'funnelTracking', label: 'Funil do rastreio', category: 'tracking', hint: 'Sessões, sessões com clique e vendas vinculadas. A taxa de passagem divide o volume de cada etapa pelo da etapa anterior.' },
  { key: 'byProduct', label: 'Vendas por produto', category: 'sales', hint: 'Soma do faturamento e contagem de itens aprovados, agrupados por produto.' },
  { key: 'byPaymentMethod', label: 'Vendas por meio de pagamento', category: 'sales', hint: 'Faturamento e quantidade de pedidos aprovados ou pendentes por meio de pagamento.' },
  { key: 'approvalRate', label: 'Taxa de aprovação', category: 'sales', hint: 'Pedidos pagos ÷ pedidos gerados de cada meio × 100. Pedidos reembolsados e com chargeback contam como pagos.' },
  { key: 'byDayOfWeek', label: 'Vendas por dia da semana', category: 'sales', hint: 'Soma dos pedidos aprovados e de seu faturamento, agrupados pelo dia da semana no fuso do painel.' },
  { key: 'byHour', label: 'Vendas por hora', category: 'sales', hint: 'Soma dos pedidos aprovados e de seu faturamento, agrupados pela hora no fuso do painel.' },
  { key: 'byCountry', label: 'Vendas por país', category: 'sales', hint: 'Pedidos aprovados e faturamento por país. A participação divide os pedidos do país pelo total.' },
  { key: 'byState', label: 'Vendas por estado (Brasil)', category: 'sales', hint: 'Pedidos aprovados e faturamento no Brasil por UF. A participação divide os pedidos da UF pelo total brasileiro.' },
  { key: 'byUtmSource', label: 'Vendas por utm_source', category: 'sales', hint: 'Pedidos aprovados e faturamento, agrupados pela origem utm_source da sessão ou da venda.' },
  { key: 'byUtmTerm', label: 'Vendas por utm_term (posicionamento)', category: 'sales', hint: 'Pedidos aprovados e faturamento, agrupados pelo posicionamento utm_term da sessão ou da venda.' },
];

/** Categorias do catálogo (o agrupamento do "Adicionar card"). */
export const CATEGORIES = [
  { key: 'general', title: 'Geral' },
  { key: 'sales', title: 'Vendas' },
  { key: 'costs', title: 'Impostos, taxas e despesas' },
  { key: 'media', title: 'Mídia' },
  { key: 'tracking', title: 'Rastreio' },
];

const ratio = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : a / b);
const money = (value: number | null) => (value === null ? null : roundMoney(value));
const PAYMENT_LABEL: Record<string, string> = { pix: 'Pix', credit_card: 'Cartão', boleto: 'Boleto', other: 'Outro', unknown: 'Não informado' };
const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/** Hora, dia da semana e dia do pedido no fuso do painel (padrão São Paulo). */
export const hourInSaoPaulo = (iso: string, timeZone = DEFAULT_TIMEZONE) => hourInTimezone(new Date(iso), timeZone);
export const weekdayInSaoPaulo = (iso: string, timeZone = DEFAULT_TIMEZONE) => weekdayInTimezone(new Date(iso), timeZone);
const dayOf = (iso: string, timeZone: string) => dayInTimezone(new Date(iso), timeZone);

/** utm_source sem o lead que a UTMify anexa (FBjLj<id> → FB). */
export function cleanSource(value: string | null | undefined) {
  if (!value?.trim()) return null;
  return value.split('jLj')[0].trim() || null;
}

/** utm_term de posicionamento; o marcador stl_ da sessão não é posicionamento. */
export function cleanTerm(value: string | null | undefined) {
  if (!value?.trim() || /^stl_/i.test(value.trim())) return null;
  return value.split('::')[0].trim() || null;
}

type Order = {
  key: string; lines: SummarySale[]; first: SummarySale;
  status: 'approved' | 'pending' | 'refused' | 'refunded' | 'chargeback' | 'other';
};

function groupOrders(sales: SummarySale[]): Order[] {
  const map = new Map<string, SummarySale[]>();
  for (const sale of sales) {
    const key = JSON.stringify([sale.checkout_integration_id, sale.order_external_id || sale.external_id || sale.id]);
    const lines = map.get(key);
    if (lines) lines.push(sale);
    else map.set(key, [sale]);
  }
  return [...map.entries()].map(([key, lines]) => {
    const first = lines.reduce((a, b) => (b.sold_at < a.sold_at ? b : a));
    const statuses = new Set(lines.map((line) => line.status));
    const status = statuses.has('chargeback') ? 'chargeback'
      : statuses.has('refunded') ? 'refunded'
        : statuses.has('approved') ? 'approved'
          : statuses.has('pending') ? 'pending'
            : statuses.has('refused') ? 'refused' : 'other';
    return { key, lines, first, status };
  });
}

/**
 * Meio de pagamento do card Taxa de aprovação. Separa débito de crédito, ao
 * contrário de `normalizePaymentMethod` (que junta os dois em credit_card porque
 * é a chave das regras de taxa do checkout e não pode mudar).
 */
export type ApprovalMethod = 'credit_card' | 'debit_card' | 'pix' | 'boleto';

export const APPROVAL_METHODS: { key: ApprovalMethod; label: string }[] = [
  { key: 'credit_card', label: 'Cartão de crédito' },
  { key: 'debit_card', label: 'Cartão de débito' },
  { key: 'pix', label: 'Pix' },
  { key: 'boleto', label: 'Boleto' },
];

export function approvalMethod(raw: string | null | undefined): ApprovalMethod | null {
  if (!raw) return null;
  const text = raw.toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/pix/.test(text)) return 'pix';
  if (/(debit|debito)/.test(text)) return 'debit_card';
  if (/(credit|credito|card|cartao)/.test(text)) return 'credit_card';
  if (/(boleto|billet|bank_slip|ticket)/.test(text)) return 'boleto';
  return null;
}

/** Pedido que foi pago em algum momento (o estorno veio depois da aprovação). */
const WAS_APPROVED = new Set<Order['status']>(['approved', 'refunded', 'chargeback']);
/** Pedido gerado: pago, ainda pendente ou recusado. */
const GENERATED = new Set<Order['status']>(['approved', 'pending', 'refused', 'refunded', 'chargeback']);

/**
 * Taxa de aprovação por meio de pagamento: pedidos aprovados (contando os que
 * depois foram reembolsados ou tiveram chargeback) ÷ pedidos gerados do meio no
 * período. Sempre os quatro meios, na ordem fixa; `rate` null sem pedido do meio.
 */
export function approvalRates(orders: { lines: { payment_method?: string | null }[]; status: Order['status'] }[]): SeriesPoint[] {
  const counts = new Map<ApprovalMethod, { approved: number; generated: number }>();
  for (const order of orders) {
    if (!GENERATED.has(order.status)) continue;
    const method = approvalMethod(order.lines.find((l) => l.payment_method)?.payment_method);
    if (!method) continue;
    const entry = counts.get(method) ?? { approved: 0, generated: 0 };
    entry.generated += 1;
    if (WAS_APPROVED.has(order.status)) entry.approved += 1;
    counts.set(method, entry);
  }
  return APPROVAL_METHODS.map(({ key, label }) => {
    const entry = counts.get(key) ?? { approved: 0, generated: 0 };
    return { label, method: key, approved: entry.approved, generated: entry.generated, rate: ratio(entry.approved, entry.generated) };
  });
}

/**
 * Compradores únicos dos pedidos: e-mail em minúsculas; sem e-mail, documento ou
 * telefone (só dígitos); sem nada, o pedido conta como um comprador.
 */
function uniqueBuyers(orders: Order[]) {
  const buyers = new Set<string>();
  for (const order of orders) {
    const pick = (read: (sale: SummarySale) => string | null | undefined) =>
      order.lines.map(read).map((v) => v?.trim()).find((v) => !!v) ?? null;
    const email = pick((l) => l.customer_email)?.toLowerCase();
    const doc = pick((l) => l.customer_doc)?.replace(/\D/g, '');
    const phone = pick((l) => l.customer_phone)?.replace(/\D/g, '');
    buyers.add(email ? `e:${email}` : doc ? `d:${doc}` : phone ? `p:${phone}` : `o:${order.key}`);
  }
  return buyers.size;
}

function orderAmountBRL(order: Order, rate: ExchangeRate, timeZone: string): number | null {
  let sum = 0;
  for (const line of order.lines) {
    const currency = line.currency?.toUpperCase().match(/^[A-Z]{3}$/)?.[0] ?? 'BRL';
    const value = rate(currency, dayOf(order.first.sold_at, timeZone));
    if (value === null) return null;
    sum += Number(line.metadata?.gross_amount ?? line.amount) * value;
  }
  return sum;
}

/**
 * Etapas de um funil: valor, % sobre a primeira etapa e taxa sobre a anterior.
 * Etapa sem dado (null) não tem percentual.
 */
export function funnelSteps(steps: { label: string; value: number | null; [extra: string]: string | number | null }[]): SeriesPoint[] {
  const first = steps[0]?.value ?? null;
  return steps.map((step, i) => {
    const previous = i > 0 ? steps[i - 1].value : null;
    return {
      ...step,
      pctOfFirst: step.value === null ? null : i === 0 ? (first ? 1 : null) : ratio(step.value, first),
      stepRate: i === 0 ? null : ratio(step.value, previous),
    };
  });
}

/**
 * Vendas aprovadas por país (ISO-2) e por UF. Cada pedido conta uma vez, pelo
 * primeiro país/estado reconhecido nas linhas; sem país e com UF válida conta como Brasil. `share` é a fração das vendas;
 * o ponto com `code` vazio é o "sem país" / "sem estado".
 */
export function geoBreakdown(orders: { lines: SummarySale[]; amount: number }[]) {
  type Bucket = { sales: number; revenue: number };
  const add = (map: Map<string, Bucket>, key: string, amount: number) => {
    const entry = map.get(key) ?? { sales: 0, revenue: 0 };
    entry.sales += 1;
    entry.revenue += amount;
    map.set(key, entry);
  };
  const countries = new Map<string, Bucket>();
  const states = new Map<string, Bucket>();
  let brazilian = 0;
  for (const { lines, amount } of orders) {
    const state = lines.map((l) => normalizeState(l.customer_state)).find(Boolean) ?? null;
    // Sem país mas com UF válida: venda brasileira (checkouts que só mandam o estado).
    const country = lines.map((l) => normalizeCountry(l.customer_country)).find(Boolean) ?? (state ? 'BR' : null);
    add(countries, country ?? '', amount);
    if (country === 'BR') {
      brazilian += 1;
      add(states, state ?? '', amount);
    }
  }
  const rows = (map: Map<string, Bucket>, total: number, describe: (code: string) => { label: string } & Record<string, string>): SeriesPoint[] =>
    [...map.entries()]
      .sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : b[1].sales - a[1].sales || b[1].revenue - a[1].revenue))
      .map(([code, v]) => ({ ...describe(code), code, sales: v.sales, revenue: roundMoney(v.revenue), share: ratio(v.sales, total) }));
  return {
    byCountry: rows(countries, orders.length, (code) => {
      const iso = code ? countryCode(code) : null;
      return { label: code ? countryName(code) : 'Sem país', iso3: iso?.iso3 ?? '', numeric: iso?.numeric ?? '' };
    }),
    byState: rows(states, brazilian, (code) => ({ label: code ? BRAZIL_STATES[code] : 'Sem estado' })),
  };
}

export interface SummaryNumbers {
  cards: Card[];
  charts: Record<string, SeriesPoint[]>;
}

export function buildSummary(input: SummaryInput): SummaryNumbers {
  const { sales, settings, checkouts, exchangeRate: rate, media, tracking } = input;
  const timeZone = input.timeZone ?? DEFAULT_TIMEZONE;
  const orders = groupOrders(sales);
  const approvedOrders = orders.filter((order) => order.status === 'approved');
  const totals = salesTotals(sales, checkouts, settings, rate, timeZone);

  const amountOf = (order: Order) => orderAmountBRL(order, rate, timeZone);
  const sumAmounts = (list: Order[]) => list.reduce<number | null>((sum, order) => {
    const value = amountOf(order);
    return sum === null || value === null ? null : sum + value;
  }, 0);

  const pending = orders.filter((order) => order.status === 'pending');
  const refunded = orders.filter((order) => order.status === 'refunded');
  const chargeback = orders.filter((order) => order.status === 'chargeback');
  const decided = approvedOrders.length + refunded.length + chargeback.length;
  const pix = orders.filter((order) => normalizePaymentMethod(order.lines.find((l) => l.payment_method)?.payment_method) === 'pix');
  const pixPaid = pix.filter((order) => WAS_APPROVED.has(order.status)).length;

  const gross = totals.grossBRL;
  const net = totals.checkoutNetBRL;
  const spend = media.spend;
  const mediaTax = media.mediaTax;
  const { beforeMedia, profit, roi, margin } = dashboardFinance(net, totals.taxesBRL, totals.productCostsBRL, spend, mediaTax);
  const salesCount = totals.approvedOrders;

  const values: Record<string, number | null> = {
    grossRevenue: money(gross),
    netRevenue: money(net),
    spend: money(spend),
    profit: money(profit),
    roi,
    roas: ratio(gross, spend),
    margin,
    sales: salesCount,
    avgTicket: money(ratio(gross, uniqueBuyers(approvedOrders))),
    cpa: money(ratio(spend, salesCount)),
    pendingSales: pending.length,
    pendingRevenue: money(sumAmounts(pending)),
    pixConversion: ratio(pixPaid, pix.length),
    refundRate: ratio(refunded.length, decided),
    refundedRevenue: money(sumAmounts(refunded)),
    chargebackRate: ratio(chargeback.length, decided),
    fees: money(totals.feesBRL),
    taxes: money(totals.taxesBRL),
    mediaTax: money(mediaTax),
    productCosts: money(totals.productCostsBRL),
    expenses: money(input.expensesBRL),
    impressions: media.impressions,
    clicks: media.clicks,
    ctr: ratio(media.clicks, media.impressions),
    cpc: money(ratio(spend, media.clicks)),
    cpm: money(ratio(spend === null ? null : spend * 1000, media.impressions)),
    landingPageViews: media.landingPageViews,
    initiateCheckouts: media.initiateCheckouts,
    costPerCheckout: money(ratio(spend, media.initiateCheckouts)),
    sessions: tracking.sessions,
    checkoutClicks: tracking.checkoutClicks,
    checkoutClickRate: ratio(tracking.checkoutClicks, tracking.sessions),
    sessionConversion: ratio(tracking.matchedSales, tracking.sessions),
  };
  const cards = CARD_CATALOG.map(({ key, label, unit }) => ({ key, label, unit, value: values[key] ?? null }));

  // Faturamento por pedido aprovado, para as séries (bruto em BRL).
  const approvedWithAmount = approvedOrders.map((order) => ({ order, amount: amountOf(order) ?? 0 }));
  const count = <T extends string | number>(pick: (order: Order) => T | null, labelOf: (key: T) => string, sort: 'value' | 'key' = 'value') => {
    const map = new Map<T, { sales: number; revenue: number }>();
    for (const { order, amount } of approvedWithAmount) {
      const key = pick(order);
      if (key === null) continue;
      const entry = map.get(key) ?? { sales: 0, revenue: 0 };
      entry.sales += 1;
      entry.revenue += amount;
      map.set(key, entry);
    }
    const rows = [...map.entries()];
    rows.sort(sort === 'key' ? (a, b) => (a[0] < b[0] ? -1 : 1) : (a, b) => b[1].revenue - a[1].revenue);
    return rows.map(([key, value]) => ({ label: labelOf(key), sales: value.sales, revenue: roundMoney(value.revenue) }));
  };
  const geo = geoBreakdown(approvedWithAmount.map(({ order, amount }) => ({ lines: order.lines, amount })));
  const generated = approvedOrders.length + pending.length + refunded.length + chargeback.length;
  const sessionOf = (order: Order) => order.lines.map((line) => input.sessions.get(line.id)).find(Boolean);

  // Por hora (acumulado) e por dia.
  const revenueByHour = new Array(24).fill(0);
  const salesByHour = new Array(24).fill(0);
  const revenueByDay = new Map<string, { revenue: number; sales: number }>();
  for (const { order, amount } of approvedWithAmount) {
    const hour = hourInSaoPaulo(order.first.sold_at, timeZone);
    revenueByHour[hour] += amount;
    salesByHour[hour] += 1;
    const day = dayOf(order.first.sold_at, timeZone);
    const entry = revenueByDay.get(day) ?? { revenue: 0, sales: 0 };
    entry.revenue += amount;
    entry.sales += 1;
    revenueByDay.set(day, entry);
  }
  const beforeMediaShare = beforeMedia === 0 ? 0 : ratio(beforeMedia, gross);
  const iofShare = mediaTax === 0 ? 0 : ratio(mediaTax, spend);
  let revenueCum = 0;
  let spendCum = 0;
  const hourly: SeriesPoint[] = revenueByHour.map((revenue, hour) => {
    revenueCum += revenue;
    const hourSpend = media.spendByHour ? media.spendByHour[hour] : null;
    if (hourSpend !== null) spendCum += hourSpend;
    return {
      label: `${String(hour).padStart(2, '0')}h`,
      revenue: roundMoney(revenue),
      spend: hourSpend === null ? null : roundMoney(hourSpend),
      revenueCum: roundMoney(revenueCum),
      spendCum: media.spendByHour ? roundMoney(spendCum) : null,
      profitCum: media.spendByHour && beforeMediaShare !== null && iofShare !== null ? roundMoney(revenueCum * beforeMediaShare - spendCum * (1 + iofShare)) : null,
    };
  });
  const days = new Set([...revenueByDay.keys(), ...(media.spendByDay?.keys() ?? [])]);
  const daily: SeriesPoint[] = [...days].sort().map((day) => {
    const revenue = revenueByDay.get(day)?.revenue ?? 0;
    const daySpend = media.spendByDay ? media.spendByDay.get(day) ?? 0 : null;
    return {
      label: day, revenue: roundMoney(revenue), sales: revenueByDay.get(day)?.sales ?? 0,
      spend: daySpend === null ? null : roundMoney(daySpend),
      profit: daySpend === null || beforeMediaShare === null || iofShare === null ? null : roundMoney(revenue * beforeMediaShare - daySpend * (1 + iofShare)),
    };
  });

  const charts: Record<string, SeriesPoint[]> = {
    hourly,
    daily,
    funnelMeta: funnelSteps([
      { label: 'Cliques', value: media.clicks },
      { label: 'Visualizações da página', value: media.landingPageViews },
      { label: 'Inícios de checkout', value: media.initiateCheckouts },
      // Toda venda aprovada passou por pendente (Pix ou boleto gerado): a etapa soma as
      // ainda pendentes e as que já foram pagas, para o funil não subir.
      { label: 'Vendas pendentes', value: generated, pendingNow: pending.length },
      { label: 'Vendas aprovadas', value: salesCount },
    ]),
    funnelTracking: funnelSteps([
      { label: 'Sessões', value: tracking.sessions },
      { label: 'Cliques no checkout', value: tracking.checkoutClicks },
      { label: 'Vendas casadas com a sessão', value: tracking.matchedSales },
    ]),
    byProduct: (() => {
      const map = new Map<string, { sales: number; revenue: number }>();
      for (const { order } of approvedWithAmount) {
        for (const line of order.lines.filter((l) => l.status === 'approved')) {
          const key = line.product_name?.trim() || 'Sem nome';
          const entry = map.get(key) ?? { sales: 0, revenue: 0 };
          const value = rate(line.currency?.toUpperCase() ?? 'BRL', dayOf(order.first.sold_at, timeZone)) ?? 0;
          entry.sales += 1;
          entry.revenue += Number(line.metadata?.gross_amount ?? line.amount) * value;
          map.set(key, entry);
        }
      }
      return [...map.entries()].sort((a, b) => b[1].revenue - a[1].revenue)
        .map(([label, v]) => ({ label, sales: v.sales, revenue: roundMoney(v.revenue) }));
    })(),
    byPaymentMethod: (() => {
      const map = new Map<string, { approved: number; pending: number; revenue: number }>();
      for (const order of orders) {
        if (order.status !== 'approved' && order.status !== 'pending') continue;
        const key = normalizePaymentMethod(order.lines.find((l) => l.payment_method)?.payment_method) ?? 'unknown';
        const entry = map.get(key) ?? { approved: 0, pending: 0, revenue: 0 };
        if (order.status === 'approved') {
          entry.approved += 1;
          entry.revenue += amountOf(order) ?? 0;
        } else entry.pending += 1;
        map.set(key, entry);
      }
      return [...map.entries()].sort((a, b) => b[1].revenue - a[1].revenue)
        .map(([key, v]) => ({ label: PAYMENT_LABEL[key] ?? key, approved: v.approved, pending: v.pending, revenue: roundMoney(v.revenue) }));
    })(),
    approvalRate: approvalRates(orders),
    // Os 7 dias sempre, de domingo a sábado: dia sem venda aparece zerado.
    byDayOfWeek: (() => {
      const days = WEEKDAYS.map((label) => ({ label, sales: 0, revenue: 0 }));
      for (const { order, amount } of approvedWithAmount) {
        const day = days[weekdayInSaoPaulo(order.first.sold_at, timeZone)];
        day.sales += 1;
        day.revenue += amount;
      }
      return days.map((day) => ({ ...day, revenue: roundMoney(day.revenue) }));
    })(),
    byHour: salesByHour.map((value, hour) => ({ label: `${String(hour).padStart(2, '0')}h`, sales: value, revenue: roundMoney(revenueByHour[hour]) })),
    byCountry: geo.byCountry,
    byState: geo.byState,
    byUtmSource: count((order) => cleanSource(sessionOf(order)?.utm_source) ?? cleanSource(order.lines.find((l) => l.utm_source)?.utm_source) ?? '(sem origem)', (key) => key),
    byUtmTerm: count((order) => cleanTerm(sessionOf(order)?.utm_term) ?? cleanTerm(order.lines.find((l) => l.utm_term)?.utm_term) ?? '(sem posicionamento)', (key) => key),
  };
  return { cards, charts };
}

/** Período anterior de mesmo tamanho, terminando na véspera de `since`. */
export function previousPeriod(since: string, until: string) {
  const day = 86_400_000;
  const span = Math.round((Date.parse(until) - Date.parse(since)) / day) + 1;
  const prevUntil = new Date(Date.parse(since) - day).toISOString().slice(0, 10);
  const prevSince = new Date(Date.parse(prevUntil) - (span - 1) * day).toISOString().slice(0, 10);
  return { since: prevSince, until: prevUntil };
}

// ---- Layout ---------------------------------------------------------------

/**
 * Layout v2: grade de 12 colunas por seção, linhas de altura fixa. Cada item tem
 * posição (x, y) e tamanho (w, h) em passos da grade; qualquer card ou gráfico pode
 * ficar em qualquer seção. O v1 (ordem + tamanho sm/md/lg) ainda é lido e vira v2.
 */
export const GRID_COLS = 12;
export const MAX_ITEM_ROWS = 30;
export const MAX_GRID_ROWS = 600;

export interface LayoutItem { key: string; x: number; y: number; w: number; h: number }
export interface LayoutSection { key: string; title: string; collapsed: boolean; items: LayoutItem[] }
export interface SummaryLayout { version: 2; sections: LayoutSection[] }

export type LegacySize = 'sm' | 'md' | 'lg';
export interface SummaryLayoutV1 {
  version: 1;
  sections: { key: string; title: string; collapsed: boolean; items: { key: string; size: LegacySize }[] }[];
}

const CHART_KEYS = new Set(CHART_CATALOG.map((c) => c.key));
const KNOWN_KEYS = new Set([...CARD_CATALOG.map((c) => c.key), ...CHART_CATALOG.map((c) => c.key)]);

/** Tamanho na grade equivalente ao tamanho antigo (o v1 usava 6 colunas no desktop). */
export function sizeFromLegacy(key: string, size: LegacySize): { w: number; h: number } {
  if (CHART_KEYS.has(key)) {
    const h = key === 'byCountry' || key === 'byState' ? 9 : 7;
    return { w: size === 'lg' ? 12 : size === 'md' ? 6 : 4, h };
  }
  return { w: size === 'lg' ? 12 : size === 'md' ? 4 : 2, h: 2 };
}

/** Coloca os itens em fila, da esquerda para a direita, quebrando a linha quando não cabem. */
export function flowItems(items: { key: string; w: number; h: number }[]): LayoutItem[] {
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  return items.map(({ key, w, h }) => {
    const width = Math.min(Math.max(w, 1), GRID_COLS);
    if (x + width > GRID_COLS) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    const item = { key, x, y, w: width, h };
    x += width;
    rowHeight = Math.max(rowHeight, h);
    return item;
  });
}

/** v1 → v2, mantendo a ordem, as seções e o tamanho equivalente. */
export function migrateLayout(layout: SummaryLayoutV1): SummaryLayout {
  return {
    version: 2,
    sections: layout.sections.map((section) => ({
      key: section.key,
      title: section.title,
      collapsed: section.collapsed,
      items: flowItems(section.items.map((item) => ({ key: item.key, ...sizeFromLegacy(item.key, item.size) }))),
    })),
  };
}

/** Qualquer layout válido (v1 ou v2) no formato v2. */
export function toLayoutV2(layout: SummaryLayout | SummaryLayoutV1): SummaryLayout {
  return layout.version === 1 ? migrateLayout(layout) : layout;
}

const DEFAULT_SECTIONS: { key: string; title: string; collapsed: boolean; items: [string, LegacySize][] }[] = [
  {
    key: 'general', title: 'Geral', collapsed: false,
    items: ['grossRevenue', 'netRevenue', 'spend', 'profit', 'roi', 'roas', 'margin', 'sales', 'avgTicket', 'cpa',
      'pendingSales', 'pendingRevenue', 'pixConversion', 'refundRate', 'refundedRevenue', 'chargebackRate'].map((k) => [k, 'sm']),
  },
  { key: 'costs', title: 'Impostos, taxas e despesas', collapsed: false, items: CARD_CATALOG.filter((c) => c.category === 'costs').map((c) => [c.key, 'sm']) },
  { key: 'media', title: 'Mídia', collapsed: false, items: CARD_CATALOG.filter((c) => c.category === 'media').map((c) => [c.key, 'sm']) },
  { key: 'tracking', title: 'Rastreio', collapsed: true, items: CARD_CATALOG.filter((c) => c.category === 'tracking').map((c) => [c.key, 'sm']) },
  {
    key: 'charts', title: 'Gráficos', collapsed: false,
    items: CHART_CATALOG.map((c) => [c.key, c.key === 'hourly' || c.key === 'daily' ? 'lg' : 'md']),
  },
];

export const DEFAULT_LAYOUT: SummaryLayout = migrateLayout({
  version: 1,
  sections: DEFAULT_SECTIONS.map((s) => ({ ...s, items: s.items.map(([key, size]) => ({ key, size })) })),
});

const int = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/**
 * Valida o layout vindo da tela (também o importado de arquivo). Aceita o v2 e o v1
 * (layouts antigos); quem salva grava sempre o v2 (`toLayoutV2`). Devolve a mensagem
 * do erro ou null.
 */
export function layoutError(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'Layout inválido.';
  const layout = value as { version?: unknown; sections?: unknown };
  if (layout.version !== 1 && layout.version !== 2) return 'Versão de layout desconhecida.';
  if (!Array.isArray(layout.sections) || layout.sections.length === 0 || layout.sections.length > 12) return 'O layout precisa ter de 1 a 12 seções.';
  const seen = new Set<string>();
  const sectionKeys = new Set<string>();
  for (const section of layout.sections as Record<string, unknown>[]) {
    if (!section || typeof section.key !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(section.key)) return 'Seção com chave inválida.';
    if (sectionKeys.has(section.key)) return `Seção repetida: ${section.key}.`;
    sectionKeys.add(section.key);
    if (typeof section.title !== 'string' || section.title.length > 60) return 'Seção com título inválido.';
    if (typeof section.collapsed !== 'boolean') return 'Seção sem o campo collapsed.';
    if (!Array.isArray(section.items) || section.items.length > 60) return 'Seção com itens demais.';
    const cells = new Set<number>();
    for (const item of section.items as Record<string, unknown>[]) {
      if (!item || typeof item.key !== 'string' || !KNOWN_KEYS.has(item.key)) return `Item desconhecido: ${String(item?.key)}.`;
      if (seen.has(item.key)) return `Item repetido: ${item.key}.`;
      seen.add(item.key);
      if (layout.version === 1) {
        if (!['sm', 'md', 'lg'].includes(item.size as string)) return `Tamanho inválido em ${item.key}.`;
        continue;
      }
      if (!int(item.w, 1, GRID_COLS) || !int(item.h, 1, MAX_ITEM_ROWS)) return `Tamanho inválido em ${item.key}.`;
      if (!int(item.x, 0, GRID_COLS - 1) || !int(item.y, 0, MAX_GRID_ROWS)) return `Posição inválida em ${item.key}.`;
      const { x, y, w, h } = item as unknown as LayoutItem;
      if (x + w > GRID_COLS) return `${item.key} passa da largura da grade.`;
      for (let row = y; row < y + h; row++) {
        for (let col = x; col < x + w; col++) {
          const cell = row * GRID_COLS + col;
          if (cells.has(cell)) return `Itens sobrepostos na seção ${section.title || section.key}.`;
          cells.add(cell);
        }
      }
      const extra = Object.keys(item).filter((k) => !['key', 'x', 'y', 'w', 'h'].includes(k));
      if (extra.length) return `Campo desconhecido em ${item.key}: ${extra[0]}.`;
    }
  }
  return null;
}
