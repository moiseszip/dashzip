import { dashboardFinance, ExchangeRate, FinanceCheckout, FinanceSale, FinanceSettings, roundMoney, salesTotals } from '../finance/finance-totals';

/**
 * Atribuição das vendas do painel aos objetos da Meta e montagem das métricas
 * de cada linha da tela de Campanhas. Tudo aqui é puro (sem rede nem banco),
 * para ser testado com números fechados.
 *
 * Fonte do ID, nesta ordem (docs/features/22-campaigns/campaigns.md, RN-01):
 * as UTMs da sessão casada, as UTMs gravadas na venda e, por último, sales.ad_id.
 * Só utm_content (anúncio), utm_medium (conjunto) e utm_campaign (campanha)
 * contam: ferramentas como a UTMify reescrevem o utm_source, e o utm_term pode levar stl_<sessão>.
 */

export type Level = 'account' | 'campaign' | 'adset' | 'ad';

export interface UtmSource {
  utm_campaign?: string | null;
  utm_medium?: string | null;
  utm_content?: string | null;
  ad_id?: string | null;
}

export interface AttributableSale extends FinanceSale {
  utm_campaign: string | null;
  utm_medium: string | null;
  utm_content: string | null;
  ad_id: string | null;
}

export interface SaleKeys {
  adId: string | null;
  adsetId: string | null;
  campaignId: string | null;
}

/** Onde cada objeto conhecido mora. A conta vem sempre como act_<id>. */
export interface Hierarchy {
  ads: Map<string, { adsetId: string; campaignId: string; accountId: string }>;
  adsets: Map<string, { campaignId: string; accountId: string }>;
  campaigns: Map<string, { accountId: string }>;
}

const ID_PATTERN = /^\d{6,25}$/;

/**
 * O ID do objeto dentro de uma UTM no formato nome|id. Aceita também o valor só
 * com o ID. O trecho depois de "::" (click ID que a UTMify anexa) é ignorado.
 */
export function idFromUtm(value: string | null | undefined): string | null {
  if (!value) return null;
  let text = value.trim();
  try {
    text = decodeURIComponent(text);
  } catch {
    // valor com % solto: usa como veio
  }
  const head = text.split('::')[0].trim();
  const candidate = head.includes('|') ? head.slice(head.lastIndexOf('|') + 1).trim() : head;
  return ID_PATTERN.test(candidate) ? candidate : null;
}

/** Junta as fontes de UTM na ordem de prioridade, campo a campo. */
export function saleKeys(sources: (UtmSource | null | undefined)[]): SaleKeys {
  const pick = (read: (source: UtmSource) => string | null) => {
    for (const source of sources) {
      if (!source) continue;
      const id = read(source);
      if (id) return id;
    }
    return null;
  };
  return {
    adId: pick((s) => idFromUtm(s.utm_content) ?? idFromUtm(s.ad_id)),
    adsetId: pick((s) => idFromUtm(s.utm_medium)),
    campaignId: pick((s) => idFromUtm(s.utm_campaign)),
  };
}

/** Mesma chave de pedido do Resultado: bump e produto principal são um pedido só. */
export function orderKey(sale: FinanceSale) {
  return JSON.stringify([sale.checkout_integration_id, sale.order_external_id || sale.external_id || sale.id]);
}

export interface Placement {
  accountId: string;
  campaignId: string | null;
  adsetId: string | null;
  adId: string | null;
}

/**
 * Localiza o pedido na hierarquia. O anúncio manda: se ele é conhecido, o
 * conjunto e a campanha vêm dele, não das outras UTMs. Sem anúncio, vale o
 * conjunto; sem conjunto, a campanha.
 */
export function place(keys: SaleKeys, hierarchy: Hierarchy): Placement | null {
  if (keys.adId) {
    const ad = hierarchy.ads.get(keys.adId);
    if (ad) return { accountId: ad.accountId, campaignId: ad.campaignId, adsetId: ad.adsetId, adId: keys.adId };
  }
  if (keys.adsetId) {
    const adset = hierarchy.adsets.get(keys.adsetId);
    if (adset) return { accountId: adset.accountId, campaignId: adset.campaignId, adsetId: keys.adsetId, adId: null };
  }
  if (keys.campaignId) {
    const campaign = hierarchy.campaigns.get(keys.campaignId);
    if (campaign) return { accountId: campaign.accountId, campaignId: keys.campaignId, adsetId: null, adId: null };
  }
  return null;
}

export function placementId(placement: Placement, level: Level): string | null {
  if (level === 'account') return placement.accountId;
  if (level === 'campaign') return placement.campaignId;
  if (level === 'adset') return placement.adsetId;
  return placement.adId;
}

export interface Attribution {
  /** Linhas de venda por ID de objeto do nível pedido. */
  byObject: Map<string, AttributableSale[]>;
  /** Pedidos sem objeto conhecido. */
  untracked: AttributableSale[];
}

/**
 * Atribui pedido a pedido. As linhas de um pedido seguem juntas, e a chave sai
 * da primeira linha (ou sessão) que tiver ID. Pedido que não casa com nada fica
 * em untracked.
 */
export function attribute(
  sales: AttributableSale[],
  sessionBySale: Map<string, UtmSource>,
  hierarchy: Hierarchy,
  level: Level,
): Attribution {
  const orders = new Map<string, AttributableSale[]>();
  for (const sale of sales) {
    const key = orderKey(sale);
    const lines = orders.get(key);
    if (lines) lines.push(sale);
    else orders.set(key, [sale]);
  }

  const byObject = new Map<string, AttributableSale[]>();
  const untracked: AttributableSale[] = [];
  for (const lines of orders.values()) {
    const ordered = [...lines].sort((a, b) => a.sold_at.localeCompare(b.sold_at));
    const sources: UtmSource[] = [
      ...ordered.map((line) => sessionBySale.get(line.id)).filter((s): s is UtmSource => !!s),
      ...ordered,
    ];
    const placement = place(saleKeys(sources), hierarchy);
    if (!placement) {
      untracked.push(...lines);
      continue;
    }
    const id = placementId(placement, level);
    if (!id) continue; // venda só no nível de cima: não aparece neste nível
    const bucket = byObject.get(id);
    if (bucket) bucket.push(...lines);
    else byObject.set(id, [...lines]);
  }
  return { byObject, untracked };
}

/** Métricas que a Meta informa para um objeto no período. */
export interface DeliveryMetrics {
  spendNative: number;
  impressions: number;
  reach: number | null;
  frequency: number | null;
  clicks: number;
  landingPageViews: number;
  initiateCheckouts: number;
  videoPlays: number;
  video3s: number;
  video75: number;
}

export type PerformanceBasis = 'dashboard' | 'rules';

export interface Metrics {
  spendNative: number | null;
  spend: number | null;
  mediaTax: number | null;
  impressions: number | null;
  reach: number | null;
  frequency: number | null;
  clicks: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  landingPageViews: number | null;
  initiateCheckouts: number | null;
  videoPlays: number | null;
  video3s: number | null;
  video75: number | null;
  hook: number | null;
  hold: number | null;
  sales: number | null;
  grossRevenue: number | null;
  netRevenue: number | null;
  salesTax: number | null;
  profit: number | null;
  roi: number | null;
  /** Lucro ÷ faturamento líquido (fração), como no Resultado. */
  margin: number | null;
  roas: number | null;
  cpa: number | null;
}

export interface Revenue {
  sales: number;
  grossRevenue: number | null;
  netRevenue: number | null;
  salesTax: number | null;
  productCost: number | null;
  afterDeductions: number | null;
}

export const EMPTY_DELIVERY: DeliveryMetrics = {
  spendNative: 0, impressions: 0, reach: 0, frequency: null, clicks: 0,
  landingPageViews: 0, initiateCheckouts: 0, videoPlays: 0, video3s: 0, video75: 0,
};

export function revenueOf(
  lines: AttributableSale[] | undefined,
  checkouts: FinanceCheckout[],
  settings: FinanceSettings,
  exchangeRate: ExchangeRate,
): Revenue {
  if (!lines?.length) return { sales: 0, grossRevenue: 0, netRevenue: 0, salesTax: 0, productCost: 0, afterDeductions: 0 };
  const totals = salesTotals(lines, checkouts, settings, exchangeRate);
  return {
    sales: totals.approvedOrders, grossRevenue: totals.grossBRL, netRevenue: totals.checkoutNetBRL,
    salesTax: totals.taxesBRL, productCost: totals.productCostsBRL, afterDeductions: totals.afterDeductionsBRL,
  };
}

const ratio = (numerator: number | null, denominator: number | null, scale = 1) =>
  numerator === null || denominator === null || denominator === 0 ? null : (numerator / denominator) * scale;

const money = (value: number | null) => (value === null ? null : roundMoney(value));

/**
 * Junta entrega e venda numa linha. `delivery` null = a conta falhou na Meta:
 * as métricas de mídia ficam null (indisponível), não zero. `spend` e
 * `mediaTax` já vêm em BRL (null sem câmbio).
 */
export function buildMetrics(
  delivery: DeliveryMetrics | null,
  spend: number | null,
  mediaTax: number | null,
  revenue: Revenue,
  basis: PerformanceBasis = 'dashboard',
): Metrics {
  const d = delivery;
  const spendBRL = d ? spend : null;
  const tax = d ? mediaTax : null;
  const rules = basis === 'rules';
  const netRevenue = rules ? revenue.afterDeductions : revenue.netRevenue;
  const finance = dashboardFinance(revenue.netRevenue, revenue.salesTax, revenue.productCost, money(spendBRL), money(tax));
  const profit = rules
    ? netRevenue === null || spendBRL === null || tax === null ? null : netRevenue - spendBRL - tax
    : finance.profit;
  return {
    spendNative: d ? roundMoney(d.spendNative) : null,
    spend: money(spendBRL),
    mediaTax: money(tax),
    impressions: d ? d.impressions : null,
    reach: d ? d.reach : null,
    frequency: d ? d.frequency : null,
    clicks: d ? d.clicks : null,
    ctr: d ? ratio(d.clicks, d.impressions) : null,
    cpc: money(ratio(spendBRL, d ? d.clicks : null)),
    cpm: money(ratio(spendBRL, d ? d.impressions : null, 1000)),
    landingPageViews: d ? d.landingPageViews : null,
    initiateCheckouts: d ? d.initiateCheckouts : null,
    videoPlays: d ? d.videoPlays : null,
    video3s: d ? d.video3s : null,
    video75: d ? d.video75 : null,
    hook: d ? ratio(d.video3s, d.impressions) : null,
    hold: d ? ratio(d.video75, d.impressions) : null,
    sales: revenue.sales,
    grossRevenue: money(revenue.grossRevenue),
    netRevenue: money(netRevenue),
    salesTax: money(revenue.salesTax),
    profit: money(profit),
    roi: rules ? ratio(netRevenue === null || tax === null ? null : netRevenue - tax, spendBRL) : finance.roi,
    margin: rules ? ratio(profit, revenue.grossRevenue) : finance.margin,
    roas: ratio(revenue.grossRevenue, spendBRL),
    cpa: money(revenue.sales > 0 ? ratio(spendBRL, revenue.sales) : null),
  };
}

const ADDITIVE = [
  'spend', 'mediaTax', 'impressions', 'clicks', 'landingPageViews', 'initiateCheckouts',
  'videoPlays', 'video3s', 'video75', 'sales', 'grossRevenue', 'netRevenue', 'salesTax', 'profit',
] as const;

/**
 * Totais da tabela: soma das linhas devolvidas, com as razões recalculadas.
 * Se uma linha tem a métrica indisponível, o total dela também fica null.
 * Alcance e frequência não somam entre objetos, então ficam null.
 */
export function sumMetrics(rows: (Metrics & { accountCurrency?: string })[], basis: PerformanceBasis = 'dashboard'): Metrics {
  const total = {} as Record<(typeof ADDITIVE)[number], number | null>;
  for (const key of ADDITIVE) {
    let sum: number | null = 0;
    for (const row of rows) {
      const value = row[key];
      if (value === null) { sum = null; break; }
      sum += value;
    }
    total[key] = sum;
  }
  const currencies = new Set(rows.map((row) => row.accountCurrency));
  let spendNative: number | null = null;
  if (currencies.size === 1 && rows.every((row) => row.spendNative !== null)) {
    spendNative = roundMoney(rows.reduce((sum, row) => sum + (row.spendNative ?? 0), 0));
  }
  const s = total.spend;
  const rules = basis === 'rules';
  const { roi } = dashboardFinance(total.netRevenue, total.salesTax, null, s, total.mediaTax);
  return {
    spendNative,
    spend: money(s),
    mediaTax: money(total.mediaTax),
    impressions: total.impressions,
    reach: null,
    frequency: null,
    clicks: total.clicks,
    ctr: ratio(total.clicks, total.impressions),
    cpc: money(ratio(s, total.clicks)),
    cpm: money(ratio(s, total.impressions, 1000)),
    landingPageViews: total.landingPageViews,
    initiateCheckouts: total.initiateCheckouts,
    videoPlays: total.videoPlays,
    video3s: total.video3s,
    video75: total.video75,
    hook: ratio(total.video3s, total.impressions),
    hold: ratio(total.video75, total.impressions),
    sales: total.sales,
    grossRevenue: money(total.grossRevenue),
    netRevenue: money(total.netRevenue),
    salesTax: money(total.salesTax),
    profit: money(total.profit),
    roi: rules ? ratio(total.netRevenue === null || total.mediaTax === null ? null : total.netRevenue - total.mediaTax, s) : roi,
    margin: ratio(total.profit, rules ? total.grossRevenue : total.netRevenue),
    roas: ratio(total.grossRevenue, s),
    cpa: money(total.sales ? ratio(s, total.sales) : null),
  };
}

/** Ações da Meta que viram as métricas da linha. */
interface InsightAction { action_type: string; value: string }

const IC_TYPES = ['offsite_conversion.fb_pixel_initiate_checkout', 'omni_initiated_checkout', 'initiate_checkout'];

function actionValue(actions: InsightAction[] | undefined, types: string[]): number {
  if (!Array.isArray(actions)) return 0;
  for (const type of types) {
    const found = actions.find((action) => action.action_type === type);
    if (found) {
      const value = Number(found.value);
      return Number.isFinite(value) ? value : 0;
    }
  }
  return 0;
}

export interface InsightRecord {
  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  inline_link_clicks?: string;
  actions?: InsightAction[];
  video_play_actions?: InsightAction[];
  video_p75_watched_actions?: InsightAction[];
}

const num = (value: string | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function deliveryFromInsight(record: InsightRecord): DeliveryMetrics {
  return {
    spendNative: num(record.spend),
    impressions: num(record.impressions),
    reach: record.reach === undefined ? null : num(record.reach),
    frequency: record.frequency === undefined ? null : num(record.frequency),
    clicks: num(record.inline_link_clicks),
    landingPageViews: actionValue(record.actions, ['landing_page_view', 'omni_landing_page_view']),
    initiateCheckouts: actionValue(record.actions, IC_TYPES),
    videoPlays: actionValue(record.video_play_actions, ['video_view']),
    video3s: actionValue(record.actions, ['video_view']),
    video75: actionValue(record.video_p75_watched_actions, ['video_view']),
  };
}

/** Valores da Meta em centavos (string) para unidade cheia. */
export function fromMinor(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? roundMoney(parsed / 100) : null;
}

const ACCOUNT_STATUS: Record<number, string> = {
  1: 'ACTIVE', 2: 'DISABLED', 3: 'UNSETTLED', 7: 'PENDING_RISK_REVIEW', 8: 'PENDING_SETTLEMENT',
  9: 'IN_GRACE_PERIOD', 100: 'PENDING_CLOSURE', 101: 'CLOSED', 201: 'ANY_ACTIVE', 202: 'ANY_CLOSED',
};

export function accountStatusName(code: number | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  return ACCOUNT_STATUS[code] ?? `UNKNOWN_${code}`;
}
