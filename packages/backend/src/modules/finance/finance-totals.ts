import { DEFAULT_TIMEZONE, dayInTimezone } from '../../shared/helpers/timezone';

export interface CheckoutRule {
  platform: string;
  percent: number;
  fixedBRL: number;
}

export type PaymentMethod = 'pix' | 'credit_card' | 'boleto' | 'other';
export const PAYMENT_METHODS: PaymentMethod[] = ['pix', 'credit_card', 'boleto', 'other'];

/** Imposto ou taxa extra sobre cada pedido aprovado (docs/features/23-fees-expenses). */
export interface ExtraFee {
  id: string;
  description: string;
  kind: 'tax' | 'fee';
  /** 'all' ou um meio de pagamento. */
  paymentMethod: 'all' | PaymentMethod;
  /** Plataformas de checkout; vazio = todas. */
  platforms: string[];
  /** Base do percentual: valor cheio do pedido ou o que sobra depois da taxa do checkout. */
  base: 'gross' | 'net';
  percent: number;
  fixedBRL: number;
}

/** Custo sobre o gasto em mídia (IOF e afins). */
export interface MediaTaxRule {
  id: string;
  description: string;
  percent: number;
  scope: 'all' | 'currency' | 'accounts';
  currency: string | null;
  accountIds: string[];
}

export interface ProductCost {
  id: string;
  productName: string;
  costBRL: number;
  group: string | null;
}

export interface FinanceSettings {
  salesTaxPercent: number | null;
  /** Coluna antiga; vale só quando não há mediaTaxRules (ver parseSettingsRow). */
  usdAdTaxPercent: number | null;
  checkoutRules: CheckoutRule[];
  extraFees: ExtraFee[];
  mediaTaxRules: MediaTaxRule[];
  productCosts: ProductCost[];
}

export const SETTINGS_COLUMNS = 'sales_tax_percent,usd_ad_tax_percent,checkout_rules,extra_fees,media_tax_rules,product_costs';

interface SettingsRow {
  sales_tax_percent?: number | string | null;
  usd_ad_tax_percent?: number | string | null;
  checkout_rules?: CheckoutRule[] | null;
  extra_fees?: ExtraFee[] | null;
  media_tax_rules?: MediaTaxRule[] | null;
  product_costs?: ProductCost[] | null;
}

/**
 * Linha de dashboard_finance_settings → configuração. Sem regras de mídia
 * cadastradas, o usd_ad_tax_percent antigo vira a regra "legacy-usd", que é o
 * que a migration 20261122170000 grava.
 */
export function parseSettingsRow(data: SettingsRow | null | undefined): FinanceSettings {
  const usd = data?.usd_ad_tax_percent == null ? null : Number(data.usd_ad_tax_percent);
  const rules = Array.isArray(data?.media_tax_rules) ? data!.media_tax_rules! : [];
  return {
    salesTaxPercent: data?.sales_tax_percent == null ? null : Number(data.sales_tax_percent),
    usdAdTaxPercent: usd,
    checkoutRules: data?.checkout_rules ?? [],
    extraFees: Array.isArray(data?.extra_fees) ? data!.extra_fees! : [],
    mediaTaxRules: rules.length || usd === null ? rules : [{
      id: 'legacy-usd', description: 'Custo sobre mídia em USD (IOF)', percent: usd,
      scope: 'currency', currency: 'USD', accountIds: [],
    }],
    productCosts: Array.isArray(data?.product_costs) ? data!.product_costs! : [],
  };
}

/** Percentual total sobre o gasto de uma conta, somando as regras que valem para ela. */
export function mediaTaxPercentFor(account: { accountId: string; currency: string }, rules: MediaTaxRule[]) {
  const id = account.accountId.replace(/^act_/, '');
  return rules.reduce((sum, rule) => {
    const applies = rule.scope === 'all'
      || (rule.scope === 'currency' && rule.currency?.toUpperCase() === account.currency.toUpperCase())
      || (rule.scope === 'accounts' && rule.accountIds.some((other) => other.replace(/^act_/, '') === id));
    return applies ? sum + rule.percent : sum;
  }, 0);
}

/** Meio de pagamento normalizado a partir do texto livre de cada plataforma. */
export function normalizePaymentMethod(raw: string | null | undefined): PaymentMethod | null {
  if (!raw) return null;
  const text = raw.toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/pix/.test(text)) return 'pix';
  if (/(credit|credito|card|cartao)/.test(text)) return 'credit_card';
  if (/(boleto|billet|bank_slip|ticket)/.test(text)) return 'boleto';
  if (text === 'unknown') return null;
  return 'other';
}

export interface FinanceSale {
  id: string;
  external_id: string | null;
  order_external_id: string | null;
  checkout_integration_id: string | null;
  amount: number | string;
  currency: string | null;
  status: string | null;
  sold_at: string;
  payment_method?: string | null;
  product_name?: string | null;
  metadata: {
    gross_amount?: number;
    payment_fee?: number;
    amount_is_net?: boolean;
  } | null;
}

export interface FinanceCheckout {
  id: string;
  platform: string;
  use_commission_value: boolean;
}

export interface CampaignDay {
  campaignId: string;
  campaignName: string;
  day: string;
  spend: number;
}

export interface AdAccountSummary {
  id: string;
  accountId: string;
  name: string;
  currency: string;
  timezone: string | null;
  active: boolean;
}

export interface AccountActivity {
  account: AdAccountSummary;
  days: CampaignDay[] | null;
}

const DAY_MS = 86_400_000;

/** Dia em São Paulo. Para o fuso do painel use `dayInTimezone` (shared/helpers/timezone). */
export function dayInSaoPaulo(date: Date) {
  return dayInTimezone(date, DEFAULT_TIMEZONE);
}

export function shiftDay(day: string, days: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Métricas de desempenho do Dash.zip. Taxas de checkout já entram no líquido. */
export function dashboardFinance(
  net: number | null, salesTax: number | null, productCost: number | null,
  ads: number | null, iof: number | null,
) {
  const afterTax = net === null || salesTax === null ? null : net - salesTax;
  const beforeMedia = afterTax === null || productCost === null ? null : afterTax - productCost;
  const mediaCost = ads === null || iof === null ? null : ads + iof;
  const profit = beforeMedia === null || mediaCost === null ? null : beforeMedia - mediaCost;
  return {
    beforeMedia,
    profit,
    roi: afterTax === null || !mediaCost ? null : afterTax / mediaCost,
    margin: profit === null || !net ? null : profit / net,
  };
}

export type ExchangeRate = (currency: string, day: string) => number | null;

export function usdRateForDay(quotes: Map<string, number>, day: string): number | null {
  for (let offset = 0; offset >= -7; offset--) {
    const rate = quotes.get(shiftDay(day, offset));
    if (rate != null && Number.isFinite(rate) && rate > 0) return rate;
  }
  return null;
}

function isKnownFee(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function salesTotals(
  sales: FinanceSale[],
  checkouts: FinanceCheckout[],
  settings: FinanceSettings,
  exchangeRate: ExchangeRate,
  /** Fuso do painel: decide o dia do pedido para a cotação. */
  timeZone: string = DEFAULT_TIMEZONE,
) {
  const integrations = new Map(checkouts.map((checkout) => [checkout.id, checkout]));
  const rules = new Map(settings.checkoutRules.map((rule) => [rule.platform, rule]));
  const productKey = (name: string | null | undefined) => (name ?? '').trim().toLowerCase();
  const productCosts = new Map((settings.productCosts ?? []).map((cost) => [productKey(cost.productName), cost.costBRL]));
  const extraFees = settings.extraFees ?? [];
  const orders = new Map<string, FinanceSale[]>();
  for (const sale of sales) {
    const key = JSON.stringify([sale.checkout_integration_id, sale.order_external_id || sale.external_id || sale.id]);
    const lines = orders.get(key);
    if (lines) lines.push(sale);
    else orders.set(key, [sale]);
  }

  let approvedOrders = 0;
  let recordedBRL = 0;
  let recordedGrossBRL = 0;
  let feesBRL = 0;
  let taxesBRL = 0;
  let checkoutNetBRL = 0;
  let extraFeesBRL = 0;
  let missingGrossDeduction = false;
  let missingGrossTax = false;
  let productCostsBRL = 0;
  let unknownGross = 0;
  let unpricedOrders = 0;
  let feesWithoutRule = 0;
  const revenueByCurrency: Record<string, number> = {};

  for (const lines of orders.values()) {
    if (lines.some((line) => line.status === 'refunded' || line.status === 'chargeback')) continue;
    const approved = lines.filter((line) => line.status === 'approved');
    if (!approved.length) continue;
    approvedOrders++;

    const firstLine = approved.reduce((first, line) => line.sold_at < first.sold_at ? line : first);
    const day = dayInTimezone(new Date(firstLine.sold_at), timeZone);
    const checkout = firstLine.checkout_integration_id ? integrations.get(firstLine.checkout_integration_id) : undefined;
    const rule = checkout ? rules.get(checkout.platform) : undefined;
    const amounts = approved.map((line) => {
      const currency = line.currency?.toUpperCase().match(/^[A-Z]{3}$/)?.[0] ?? 'BRL';
      const amount = Number(line.amount);
      const isNet = line.metadata?.amount_is_net ?? checkout?.use_commission_value ?? false;
      const reportedGross = line.metadata?.gross_amount;
      const fee = line.metadata?.payment_fee;
      return { currency, amount, isNet, reportedGross, fee, rate: exchangeRate(currency, day) };
    });
    for (const line of amounts) revenueByCurrency[line.currency] = (revenueByCurrency[line.currency] ?? 0) + line.amount;
    if (amounts.some((line) => line.rate === null)) {
      unpricedOrders++;
      continue;
    }

    const hasReportedFee = amounts.some((line) => !line.isNet && isKnownFee(line.fee));
    let needsFixedFee = false;
    let missingFee = false;
    let missingGross = false;
    let orderFees = 0;
    let orderNetDifference = 0;
    let orderRecorded = 0;
    let orderGross = 0;
    for (const line of amounts) {
      const rate = line.rate!;
      const amount = line.amount * rate;
      orderRecorded += amount;
      if (line.isNet) {
        if (typeof line.reportedGross === 'number' && line.reportedGross >= line.amount) {
          orderGross += line.reportedGross * rate;
          orderNetDifference += line.reportedGross * rate - amount;
        } else {
          missingGross = true;
        }
      } else {
        orderGross += amount;
        if (isKnownFee(line.fee)) {
          orderFees += line.fee * rate;
        } else if (!hasReportedFee && rule) {
          orderFees += amount * rule.percent / 100;
          needsFixedFee = true;
        } else if (!hasReportedFee) {
          missingFee = true;
        }
      }
    }
    if (missingGross) unknownGross++;
    if (missingFee) feesWithoutRule++;
    if (needsFixedFee) orderFees += rule!.fixedBRL;
    orderFees = roundMoney(orderFees);
    const orderCheckoutNet = roundMoney(orderRecorded - orderFees);

    // Impostos e taxas extras: uma vez por pedido, pelo meio de pagamento e
    // pela plataforma do pedido. Base "net" = o que sobra depois da taxa do checkout.
    const method = normalizePaymentMethod(approved.find((line) => line.payment_method)?.payment_method);
    const platform = checkout?.platform ?? null;
    let orderExtraTax = 0;
    let orderExtraFee = 0;
    for (const fee of extraFees) {
      if (fee.paymentMethod !== 'all' && fee.paymentMethod !== method) continue;
      if (fee.platforms?.length && (!platform || !fee.platforms.includes(platform))) continue;
      if (fee.base === 'gross' && missingGross && fee.percent > 0) {
        missingGrossDeduction = true;
        if (fee.kind === 'tax') missingGrossTax = true;
        continue;
      }
      const base = fee.base === 'gross' ? orderGross : orderCheckoutNet;
      const value = roundMoney(Math.max(0, base) * fee.percent / 100 + fee.fixedBRL);
      if (fee.kind === 'tax') orderExtraTax += value;
      else orderExtraFee += value;
    }
    let orderProductCost = 0;
    for (const line of approved) orderProductCost += productCosts.get(productKey(line.product_name)) ?? 0;

    const salesTax = roundMoney(Math.max(0, orderCheckoutNet) * (settings.salesTaxPercent ?? 0) / 100);
    recordedBRL += orderRecorded;
    recordedGrossBRL += orderGross;
    feesBRL += roundMoney(orderFees + orderNetDifference + orderExtraFee);
    checkoutNetBRL += orderCheckoutNet;
    extraFeesBRL += orderExtraFee;
    taxesBRL += salesTax + orderExtraTax;
    productCostsBRL += orderProductCost;
  }

  return {
    approvedOrders,
    revenueByCurrency: Object.entries(revenueByCurrency).map(([currency, amount]) => ({ currency, amount: roundMoney(amount) })),
    recordedBRL: unpricedOrders ? null : roundMoney(recordedBRL),
    grossBRL: unpricedOrders || unknownGross ? null : roundMoney(recordedGrossBRL),
    feesBRL: unpricedOrders || unknownGross ? null : roundMoney(feesBRL),
    checkoutNetBRL: unpricedOrders ? null : roundMoney(checkoutNetBRL),
    taxesBRL: unpricedOrders || missingGrossTax ? null : roundMoney(taxesBRL),
    productCostsBRL: unpricedOrders ? null : roundMoney(productCostsBRL),
    afterDeductionsBRL: unpricedOrders || missingGrossDeduction
      ? null : roundMoney(checkoutNetBRL - extraFeesBRL - taxesBRL - productCostsBRL),
    unknownGross, unpricedOrders, feesWithoutRule,
  };
}

export function mediaTotals(activities: AccountActivity[], exchangeRate: ExchangeRate, mediaRules: MediaTaxRule[]) {
  const accounts = activities.map(({ account, days }) => {
    if (!days) return { ...account, nativeSpend: null, spendBRL: null, taxBRL: null, campaigns: [] };
    const campaigns = new Map<string, { id: string; name: string; spend: number }>();
    let nativeSpend = 0;
    let spendBRL = 0;
    let hasConversion = true;
    for (const row of days) {
      const campaign = campaigns.get(row.campaignId) ?? { id: row.campaignId, name: row.campaignName, spend: 0 };
      campaign.spend += row.spend;
      campaigns.set(campaign.id, campaign);
      nativeSpend += row.spend;
      if (row.spend === 0) continue;
      const rate = exchangeRate(account.currency, row.day);
      if (rate === null) hasConversion = false;
      else spendBRL += row.spend * rate;
    }
    return {
      ...account,
      nativeSpend: roundMoney(nativeSpend),
      spendBRL: hasConversion ? roundMoney(spendBRL) : null,
      taxBRL: hasConversion ? roundMoney(spendBRL * mediaTaxPercentFor(account, mediaRules) / 100) : null,
      campaigns: [...campaigns.values()].map((c) => ({ ...c, spend: roundMoney(c.spend) }))
        .sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name)),
    };
  });
  const complete = accounts.length > 0 && accounts.every((account) => account.spendBRL !== null);

  return {
    accounts,
    spendBRL: complete ? roundMoney(accounts.reduce((sum, a) => sum + (a.spendBRL ?? 0), 0)) : null,
    taxBRL: complete ? roundMoney(accounts.reduce((sum, a) => sum + (a.taxBRL ?? 0), 0)) : null,
  };
}
