import { api } from '@/lib/api';

/**
 * Contrato de Regras automáticas (docs/features/25-rules/rules.md). Condições em dinheiro
 * vêm em BRL; ctr, hook e hold em fração; dailyBudget e os valores da ação de orçamento
 * na moeda da conta.
 */

export type RuleMetric =
  | 'spend' | 'sales' | 'cpa' | 'roi' | 'roas' | 'profit' | 'netRevenue' | 'grossRevenue' | 'cpc' | 'cpm'
  | 'ctr' | 'impressions' | 'clicks' | 'landingPageViews' | 'initiateCheckouts' | 'costPerCheckout' | 'frequency'
  | 'hook' | 'hold' | 'dailyBudget';
export type Operator = 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'not_between';
export type RuleWindow =
  | 'today' | 'yesterday'
  | 'last_2_days' | 'last_3_days' | 'last_7_days' | 'last_14_days' | 'last_30_days'
  | 'last_2_days_with_today' | 'last_3_days_with_today' | 'last_7_days_with_today'
  | 'last_14_days_with_today' | 'last_30_days_with_today';
export type RuleActionType = 'pause' | 'activate' | 'increase_budget' | 'decrease_budget' | 'set_budget';
export type MetricUnit = 'BRL' | 'int' | 'ratio' | 'pct' | 'native';

export interface RuleCondition {
  metric: RuleMetric;
  operator: Operator;
  valueA: number;
  valueB: number | null;
}

export interface RuleDefinition {
  level: 'campaign' | 'adset' | 'ad';
  targetStatus: 'active' | 'paused';
  accountIds: string[];
  nameContains: string | null;
  conditions: RuleCondition[];
  window: RuleWindow;
  action: {
    type: RuleActionType;
    valueType: 'percentage' | 'amount' | null;
    value: number | null;
    limit: number | null;
  };
  frequencyMinutes: number;
  dailyHour: number | null;
  maxRunsPerDay: number | null;
  hourStart: number | null;
  hourEnd: number | null;
}

export interface RuleBody extends RuleDefinition {
  name: string;
  enabled: boolean;
}

export interface RunSummary {
  id: string;
  trigger: 'schedule' | 'manual';
  ran_at: string;
  evaluated: number;
  matched: number;
  succeeded: number;
  failed: number;
  error: string | null;
}

export interface Rule extends RuleBody {
  id: string;
  lastRunAt: string | null;
  runsToday: number;
  createdAt: string;
  updatedAt: string;
  lastRun: RunSummary | null;
}

export interface RulesCatalog {
  metrics: { key: RuleMetric; label: string; unit: MetricUnit }[];
  operators: Operator[];
  windows: RuleWindow[];
  actions: RuleActionType[];
  frequencies: number[];
}

export interface SimulationMatch {
  objectId: string;
  name: string;
  accountId: string;
  level: RuleDefinition['level'];
  status: string | null;
  accountCurrency: string;
  conditions: (RuleCondition & { actual: number | null; ok: boolean })[];
  action: { action: 'pause' | 'activate' | 'set_daily_budget'; before: string | number | null; after: string | number | null; value?: number; skipped?: string };
}

export interface SimulationResponse {
  since: string;
  until: string;
  evaluated: number;
  matches: SimulationMatch[];
  warnings: string[];
}

export interface RunRow extends RunSummary {
  rule_id: string;
  since: string;
  until: string;
  actions: { objectId: string; name: string; accountId: string; action: string; before: string | number | null; after: string | number | null; ok: boolean; code?: string; message?: string }[];
}

export const rulesApi = {
  list: (id: string) => api.get<{ rules: Rule[]; catalog: RulesCatalog }>(`/rules/${id}`),
  create: (id: string, body: RuleBody) => api.post<{ rule: Rule; warnings: string[] }>(`/rules/${id}`, body),
  update: (id: string, ruleId: string, body: RuleBody) => api.put<{ rule: Rule; warnings: string[] }>(`/rules/${id}/${ruleId}`, body),
  setEnabled: (id: string, ruleId: string, enabled: boolean) => api.patch<{ rule: Rule }>(`/rules/${id}/${ruleId}/enabled`, { enabled }),
  remove: (id: string, ruleId: string) => api.delete(`/rules/${id}/${ruleId}`),
  // O simulate aceita só a definição: nome e liga/desliga são recusados pela validação.
  simulate: (id: string, definition: RuleDefinition) => api.post<SimulationResponse>(`/rules/${id}/simulate`, definition),
  run: (id: string, ruleId: string) => api.post<RunRow>(`/rules/${id}/${ruleId}/run`),
  runs: (id: string, ruleId: string, before?: string) =>
    api.get<{ runs: RunRow[]; nextBefore: string | null }>(`/rules/${id}/runs?ruleId=${ruleId}&limit=20${before ? `&before=${encodeURIComponent(before)}` : ''}`),
};

export function definitionOf(body: RuleBody): RuleDefinition {
  const { name: _name, enabled: _enabled, ...definition } = body;
  return definition;
}

export const LEVEL_LABELS: Record<RuleDefinition['level'], { one: string; many: string }> = {
  campaign: { one: 'campanha', many: 'campanhas' },
  adset: { one: 'conjunto', many: 'conjuntos' },
  ad: { one: 'anúncio', many: 'anúncios' },
};

export const OPERATOR_LABELS: Record<Operator, string> = {
  gt: 'maior que', gte: 'maior ou igual a', lt: 'menor que', lte: 'menor ou igual a', between: 'entre', not_between: 'fora de',
};
export const OPERATOR_SYMBOLS: Record<Operator, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤', between: 'entre', not_between: 'fora de' };

export function windowLabel(window: RuleWindow) {
  if (window === 'today') return 'Hoje';
  if (window === 'yesterday') return 'Ontem';
  const n = window.match(/last_(\d+)_days/)?.[1];
  return window.endsWith('_with_today') ? `Últimos ${n} dias, com hoje` : `Últimos ${n} dias, até ontem`;
}

export const ACTION_LABELS: Record<RuleActionType, string> = {
  pause: 'Pausar', activate: 'Ativar', increase_budget: 'Aumentar orçamento', decrease_budget: 'Reduzir orçamento', set_budget: 'Definir orçamento',
};

export function frequencyLabel(minutes: number) {
  if (minutes === 1440) return 'Uma vez por dia';
  if (minutes < 60) return `A cada ${minutes} min`;
  return minutes === 60 ? 'A cada hora' : `A cada ${minutes / 60} h`;
}

export const isBudgetAction = (type: RuleActionType) => type === 'increase_budget' || type === 'decrease_budget' || type === 'set_budget';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

/** Valor de condição para leitura; pct chega em fração. */
export function formatMetricValue(value: number | null, unit: MetricUnit | undefined) {
  if (value === null || !Number.isFinite(value)) return '—';
  if (unit === 'BRL') return brl.format(value);
  if (unit === 'pct') return `${decimal.format(value * 100)}%`;
  if (unit === 'ratio') return decimal.format(value);
  return decimal.format(value);
}

export function emptyRule(): RuleBody {
  return {
    name: '',
    enabled: false,
    level: 'ad',
    targetStatus: 'active',
    accountIds: [],
    nameContains: null,
    conditions: [{ metric: 'spend', operator: 'gte', valueA: 0, valueB: null }],
    window: 'today',
    action: { type: 'pause', valueType: null, value: null, limit: null },
    frequencyMinutes: 15,
    dailyHour: null,
    maxRunsPerDay: null,
    hourStart: null,
    hourEnd: null,
  };
}

/** As mesmas combinações que o backend recusa (400), para avisar antes de salvar. */
export function validateRule(rule: RuleBody): string | null {
  if (!rule.name.trim()) return 'Dê um nome à regra.';
  if (!rule.conditions.length) return 'Inclua ao menos uma condição.';
  if (rule.conditions.some((c) => (c.operator === 'between' || c.operator === 'not_between') && c.valueB === null)) return 'Condição "entre" precisa dos dois valores.';
  if (rule.level === 'ad' && isBudgetAction(rule.action.type)) return 'Anúncio não tem orçamento: escolha conjunto ou campanha.';
  if (rule.action.type === 'pause' && rule.targetStatus !== 'active') return 'Pausar só vale para itens ativos.';
  if (rule.action.type === 'activate' && rule.targetStatus !== 'paused') return 'Ativar só vale para itens pausados.';
  if (isBudgetAction(rule.action.type) && (rule.action.value === null || rule.action.value <= 0)) return 'Informe o valor da ação de orçamento.';
  if ((rule.hourStart === null) !== (rule.hourEnd === null)) return 'A faixa de horas precisa de início e fim.';
  if (rule.dailyHour !== null && rule.frequencyMinutes !== 1440) return 'Hora fixa só vale para "uma vez por dia".';
  return null;
}
