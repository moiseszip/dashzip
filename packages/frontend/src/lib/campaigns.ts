import { api } from '@/lib/api';
import { getActiveTimezone } from '@/lib/timezone';

/**
 * Contrato da API de Campanhas (backend em packages/backend/src/modules/campaigns,
 * documentado em docs/features/22-campaigns/campaigns.md). Valores em BRL já vêm
 * convertidos pelo servidor (PTAX + IOF, como em /finance). Orçamentos
 * vêm na moeda da conta, em unidades (50 = 50,00), não em centavos. Toda métrica é
 * number | null: null quer dizer indisponível, que é diferente de zero.
 */

export type Level = 'account' | 'campaign' | 'adset' | 'ad';

export type MetricKey =
  | 'spend' | 'mediaTax' | 'impressions' | 'reach' | 'frequency' | 'clicks' | 'ctr' | 'cpc' | 'cpm'
  | 'landingPageViews' | 'initiateCheckouts' | 'videoPlays' | 'video3s' | 'video75' | 'hook' | 'hold'
  | 'sales' | 'grossRevenue' | 'netRevenue' | 'salesTax' | 'profit' | 'roi' | 'margin' | 'roas' | 'cpa';

/** Colunas da tabela: as métricas e a data de criação. */
export type ColumnKey = MetricKey | 'createdTime';

/** ctr, hook, hold e margin vêm como fração (0 a 1). spend não inclui o IOF (mediaTax). */
export type Metrics = Record<MetricKey, number | null> & { spendNative: number | null };

export interface ObjectRow extends Metrics {
  id: string;
  name: string;
  level: Level;
  accountId: string;
  campaignId: string | null;
  adsetId: string | null;
  parentId: string | null;
  status: string | null;
  effectiveStatus: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  budgetLevel: 'campaign' | 'adset' | null;
  accountCurrency: string;
  /** Data de criação na Meta (ISO); null em contas e objetos arquivados fora da lista. */
  createdTime: string | null;
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

export interface ObjectsResponse {
  level: Level;
  since: string;
  until: string;
  currency: 'BRL';
  /** PTAX: média do período (métricas) e do último dia (orçamentos), para o seletor de moeda. */
  usdBrl?: { period: number | null; latest: number | null };
  rows: ObjectRow[];
  totals: Partial<Metrics>;
  untrackedSales: { count: number; grossRevenue: number | null };
  accounts: AccountInfo[];
  warnings: string[];
}

export interface AvailableAccount {
  id: string;
  name: string;
  currency: string;
  timezone: string | null;
  accountStatus: string | null;
  linked: boolean;
  linkedDashboardId: string | null;
}

export interface AvailableAccountsResponse {
  needsToken: boolean;
  accounts: AvailableAccount[];
  warnings: string[];
}

export interface SaveAccountsResponse {
  results: { accountId: string; ok: boolean; code?: string; message?: string }[];
}

export type ActionName = 'pause' | 'activate' | 'set_daily_budget' | 'set_lifetime_budget';

export interface ActionItem {
  objectId: string;
  level: Exclude<Level, 'account'>;
  action: ActionName;
  value?: number;
}

export type RowPatch = Partial<Pick<ObjectRow, 'status' | 'effectiveStatus' | 'dailyBudget' | 'lifetimeBudget' | 'budgetLevel'>>;

export interface ActionResult {
  objectId: string;
  ok: boolean;
  code?: string;
  message?: string;
  row?: RowPatch;
}

/** Intervalo do seletor de datas (dias de São Paulo, até 92 dias). */
export interface DateRange { since: string; until: string }

export type SavedColumns = Partial<Record<Level, { columns: string[]; sort?: { key: string; dir: 'asc' | 'desc' } | null }>>;

export const campaignsApi = {
  columns: (dashboardId: string) => api.get<{ columns: SavedColumns }>(`/preferences/${dashboardId}/campaign-columns`),
  saveColumns: (dashboardId: string, columns: SavedColumns) =>
    api.put<{ columns: SavedColumns }>(`/preferences/${dashboardId}/campaign-columns`, { columns }),
  objects: (dashboardId: string, level: Level, range: DateRange) =>
    api.get<ObjectsResponse>(`/campaigns/${dashboardId}/objects?level=${level}&since=${range.since}&until=${range.until}`),
  availableAccounts: (dashboardId: string) =>
    api.get<AvailableAccountsResponse>(`/campaigns/${dashboardId}/available-accounts`),
  // Lista as contas de um token novo sem gravar nada; a gravação é no PUT /accounts.
  accountsForToken: (dashboardId: string, accessToken: string) =>
    api.post<AvailableAccountsResponse>(`/campaigns/${dashboardId}/available-accounts`, { accessToken }),
  saveAccounts: (dashboardId: string, accountIds: string[], accessToken?: string) =>
    api.put<SaveAccountsResponse>(`/campaigns/${dashboardId}/accounts`, accessToken ? { accountIds, accessToken } : { accountIds }),
  // Um endpoint para 1 a 40 itens, executados em série no servidor.
  actions: (dashboardId: string, items: ActionItem[]) =>
    api.post<{ validateOnly: boolean; results: ActionResult[] }>(`/campaigns/${dashboardId}/actions`, { items }),
};

export type ColumnKind = 'money' | 'int' | 'pct' | 'ratio' | 'decimal' | 'date';

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  kind: ColumnKind;
  defaultVisible: boolean;
  hint?: string;
}

export const COLUMNS: ColumnDef[] = [
  { key: 'spend', label: 'Gasto', kind: 'money', defaultVisible: true, hint: 'Em BRL, pela PTAX de venda do dia (sem o IOF)' },
  { key: 'mediaTax', label: 'IOF', kind: 'money', defaultVisible: false, hint: 'IOF sobre o gasto das contas em dólar (percentual configurado em Custos), em BRL' },
  { key: 'sales', label: 'Vendas', kind: 'int', defaultVisible: true },
  { key: 'grossRevenue', label: 'Faturamento', kind: 'money', defaultVisible: true },
  { key: 'netRevenue', label: 'Líquido', kind: 'money', defaultVisible: false, hint: 'Faturamento após as taxas do checkout' },
  { key: 'profit', label: 'Lucro', kind: 'money', defaultVisible: true },
  { key: 'roas', label: 'ROAS', kind: 'ratio', defaultVisible: true },
  { key: 'roi', label: 'ROI', kind: 'decimal', defaultVisible: false, hint: '(Faturamento líquido − imposto sobre venda) ÷ (gasto em anúncios + IOF)' },
  { key: 'margin', label: 'Margem', kind: 'pct', defaultVisible: true, hint: 'Lucro ÷ faturamento líquido' },
  { key: 'cpa', label: 'CPA', kind: 'money', defaultVisible: true },
  { key: 'initiateCheckouts', label: 'IC', kind: 'int', defaultVisible: true, hint: 'Inícios de checkout (InitiateCheckout, Meta)' },
  { key: 'landingPageViews', label: 'Vis. da LP', kind: 'int', defaultVisible: false, hint: 'Visualizações da página de destino (Meta)' },
  { key: 'cpc', label: 'CPC', kind: 'money', defaultVisible: true },
  { key: 'ctr', label: 'CTR', kind: 'pct', defaultVisible: true },
  { key: 'cpm', label: 'CPM', kind: 'money', defaultVisible: false },
  { key: 'impressions', label: 'Impressões', kind: 'int', defaultVisible: false },
  { key: 'clicks', label: 'Cliques', kind: 'int', defaultVisible: false, hint: 'Cliques no link' },
  { key: 'reach', label: 'Alcance', kind: 'int', defaultVisible: false },
  { key: 'frequency', label: 'Frequência', kind: 'decimal', defaultVisible: false },
  { key: 'hook', label: 'Hook', kind: 'pct', defaultVisible: false, hint: 'Vídeo de 3s ÷ impressões' },
  { key: 'hold', label: 'Hold', kind: 'pct', defaultVisible: false, hint: 'Vídeo de 75% ÷ impressões' },
  { key: 'video3s', label: 'Vídeo 3s', kind: 'int', defaultVisible: false },
  { key: 'video75', label: 'Vídeo 75%', kind: 'int', defaultVisible: false },
  { key: 'createdTime', label: 'Criação', kind: 'date', defaultVisible: true, hint: 'Data de criação na Meta' },
];

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const usd = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' });

/** Moeda em que a tela mostra os valores (o servidor manda tudo em BRL). */
export type ViewCurrency = 'BRL' | 'USD';

export function formatMetric(value: number | null | undefined, kind: ColumnKind, currency: ViewCurrency = 'BRL') {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (kind === 'money') return (currency === 'USD' ? usd : brl).format(value);
  if (kind === 'int') return integer.format(value);
  if (kind === 'pct') return `${decimal.format(value * 100)}%`;
  if (kind === 'decimal') return decimal.format(value);
  return `${decimal.format(value)}x`;
}

export function formatCurrency(value: number | null | undefined, currency: string) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (!/^[A-Z]{3}$/.test(currency)) return decimal.format(value);
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value);
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Ativo',
  PAUSED: 'Pausado',
  CAMPAIGN_PAUSED: 'Campanha pausada',
  ADSET_PAUSED: 'Conjunto pausado',
  IN_PROCESS: 'Em processamento',
  WITH_ISSUES: 'Com problemas',
  PENDING_REVIEW: 'Em análise',
  DISAPPROVED: 'Reprovado',
  PREAPPROVED: 'Pré-aprovado',
  PENDING_BILLING_INFO: 'Pagamento pendente',
  ARCHIVED: 'Arquivado',
  DELETED: 'Excluído',
};

export function statusLabel(status: string | null) {
  if (!status) return '—';
  return STATUS_LABELS[status] ?? status.toLowerCase().replace(/_/g, ' ');
}

const ACCOUNT_STATUS: Record<string, string> = {
  ACTIVE: 'Ativa',
  DISABLED: 'Desativada',
  UNSETTLED: 'Pagamento pendente',
  PENDING_RISK_REVIEW: 'Em análise de risco',
  PENDING_SETTLEMENT: 'Liquidação pendente',
  IN_GRACE_PERIOD: 'Em período de carência',
  PENDING_CLOSURE: 'Encerramento pendente',
  CLOSED: 'Encerrada',
};

export function accountStatusLabel(status: string | null | undefined) {
  if (!status) return '—';
  return ACCOUNT_STATUS[status] ?? status.toLowerCase().replace(/_/g, ' ');
}

const ERROR_MESSAGES: Record<string, string> = {
  OBJECT_NOT_IN_DASHBOARD: 'Este objeto é de uma conta que não está neste painel.',
  BUDGET_NOT_ON_THIS_LEVEL: 'O orçamento deste item mora em outro nível (campanha CBO ou conjuntos).',
  INVALID_VALUE: 'Valor de orçamento inválido.',
  UNSUPPORTED_CURRENCY: 'A moeda desta conta não aceita alteração de orçamento por aqui.',
  TOKEN_INVALID: 'O token da Meta expirou ou foi revogado. Gere um novo token do System User.',
  MISSING_PERMISSION: 'O System User não tem permissão para alterar este objeto na Meta.',
  ACCOUNT_RESTRICTED: 'A conta de anúncios está restrita na Meta.',
  RATE_LIMITED: 'A Meta limitou as chamadas desta conta. Tente de novo em alguns minutos.',
  LOW_BUDGET: 'O orçamento está abaixo do mínimo da Meta para esta conta.',
  HIGH_BUDGET: 'O orçamento passa do máximo permitido pela Meta para esta conta.',
  META_UNAVAILABLE: 'A Meta não respondeu. Tente de novo em instantes.',
  SKIPPED: 'Não enviado: a Meta limitou as chamadas antes deste item.',
  ACCOUNT_IN_OTHER_DASHBOARD: 'Esta conta já está em outro painel.',
  NOT_VISIBLE_TO_TOKEN: 'O token salvo não enxerga esta conta.',
};

/** META_REJECTED traz a mensagem da própria Meta, que é mais útil que um texto genérico. */
export function actionErrorMessage(code?: string, message?: string) {
  if (code === 'META_REJECTED' && message) return message;
  return (code && ERROR_MESSAGES[code]) || message || 'A Meta recusou a alteração.';
}

export function isActive(row: Pick<ObjectRow, 'status'>) {
  return row.status === 'ACTIVE';
}

/** Métricas do card do celular (Campanhas): as que decidem pausar, escalar ou cortar. */
export const CARD_METRICS: ColumnKey[] = ['spend', 'sales', 'profit', 'roi', 'margin', 'cpa'];

/** Cor de ganho/perda: lucro e margem pelo sinal; ROI acima ou abaixo de 1 (cobertura de mídia). */
export function metricTone(key: ColumnKey, value: number | null | undefined): 'gain' | 'loss' | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const signed = key === 'profit' || key === 'margin' ? value : key === 'roi' ? value - 1 : 0;
  if (signed === 0) return null;
  return signed > 0 ? 'gain' : 'loss';
}

/** Ajuste rápido de orçamento (+10 = +10%), arredondado em centavos e nunca abaixo de 0,01. */
export function adjustBudget(current: number, percent: number) {
  return Math.max(0.01, Math.round(current * (1 + percent / 100) * 100) / 100);
}

/** Valor do campo de orçamento no formato brasileiro (vírgula decimal, sem milhar). */
export function formatBudgetInput(value: number) {
  return String(Math.round(value * 100) / 100).replace('.', ',');
}

/**
 * Lê o campo de orçamento: "1.234,56", "1234,56", "50,5" e também "50.5" (teclado
 * numérico com ponto). Ponto seguido de exatamente 3 dígitos é milhar ("1.500").
 */
export function parseBudgetInput(text: string): number | null {
  const raw = text.trim().replace(/\s|R\$|US\$|\$/g, '');
  if (!raw) return null;
  let normalized: string;
  if (raw.includes(',')) normalized = raw.replace(/\./g, '').replace(',', '.');
  else if (/^\d+\.\d{1,2}$/.test(raw)) normalized = raw;
  else normalized = raw.replace(/\./g, '');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Data de criação no fuso do painel (dd/mm/aaaa). */
export function formatCreated(iso: string | null | undefined) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('pt-BR', { timeZone: getActiveTimezone() });
}
