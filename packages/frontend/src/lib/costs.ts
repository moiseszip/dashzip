import { api } from '@/lib/api';

/**
 * Contrato de taxas, custo de produto e despesas (docs/features/23-fees-expenses/fees-expenses.md).
 * Percentuais vão de 0 a 100, como no Resultado (diferente de ctr/hook em Campanhas, que são fração).
 */

export type PaymentMethod = 'pix' | 'credit_card' | 'boleto' | 'other';
export type ExpenseCategory = 'ads' | 'tools' | 'team' | 'accounting' | 'other';

export interface ExtraFee {
  id: string;
  description: string;
  kind: 'tax' | 'fee';
  paymentMethod: 'all' | PaymentMethod;
  platforms: string[];
  base: 'gross' | 'net';
  percent: number;
  fixedBRL: number;
}

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

export interface CheckoutRule {
  platform: string;
  percent: number;
  fixedBRL: number;
}

export interface CostSettings {
  salesTaxPercent: number | null;
  usdAdTaxPercent: number | null;
  checkoutRules: CheckoutRule[];
  extraFees: ExtraFee[];
  mediaTaxRules: MediaTaxRule[];
  productCosts: ProductCost[];
  accounts: { id: string; accountId: string; name: string; currency: string; timezone: string | null; active: boolean }[];
  options: {
    paymentMethods: ('all' | PaymentMethod)[];
    platforms: string[];
    checkouts: { platform: string; active: boolean; needsFeeRule: boolean }[];
    products: string[];
    expenseCategories: ExpenseCategory[];
  };
}

export type CostSettingsInput = Pick<CostSettings, 'salesTaxPercent' | 'checkoutRules' | 'extraFees' | 'mediaTaxRules' | 'productCosts'>;

export interface Expense {
  id: string;
  description: string;
  category: ExpenseCategory;
  amountBRL: number;
  kind: 'single' | 'recurring';
  date: string | null;
  startDate: string | null;
  endDate: string | null;
  recurringDay: number | null;
}

export type ExpenseInput = Omit<Expense, 'id'>;

export interface ExpensesResponse {
  since: string;
  until: string;
  expenses: Expense[];
  occurrences: { expenseId: string; date: string; description: string; category: ExpenseCategory; amountBRL: number }[];
  totalBRL: number;
}

export const costsApi = {
  settings: (dashboardId: string) => api.get<CostSettings>(`/finance/${dashboardId}/settings`),
  saveSettings: (dashboardId: string, input: CostSettingsInput) => api.put<CostSettings>(`/finance/${dashboardId}/settings`, input),
  expenses: (dashboardId: string, since: string, until: string) =>
    api.get<ExpensesResponse>(`/finance/${dashboardId}/expenses?since=${since}&until=${until}`),
  createExpense: (dashboardId: string, input: ExpenseInput) => api.post<Expense>(`/finance/${dashboardId}/expenses`, input),
  updateExpense: (dashboardId: string, id: string, input: ExpenseInput) => api.patch<Expense>(`/finance/${dashboardId}/expenses/${id}`, input),
  deleteExpense: (dashboardId: string, id: string) => api.delete(`/finance/${dashboardId}/expenses/${id}`),
};

/** Ids dos itens da configuração são gerados na tela: [A-Za-z0-9_-]{1,40}. */
export function newId() {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '')
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return random.slice(0, 16);
}

export const PAYMENT_LABELS: Record<'all' | PaymentMethod, string> = {
  all: 'Todos os meios',
  pix: 'Pix',
  credit_card: 'Cartão de crédito',
  boleto: 'Boleto',
  other: 'Outros',
};

export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  ads: 'Anúncios e mídia',
  tools: 'Ferramentas',
  team: 'Equipe',
  accounting: 'Contabilidade e impostos',
  other: 'Outros',
};

export const LEGACY_USD_RULE_ID = 'legacy-usd';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const formatBRL = (value: number | null | undefined) => (value === null || value === undefined ? '—' : brl.format(value));

/** Dia em São Paulo. Para o "hoje" do painel use `dayInPanel` (lib/timezone). */
export function dayInSaoPaulo(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

export const displayDate = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');
