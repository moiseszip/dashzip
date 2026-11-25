import { roundMoney, shiftDay } from '../finance/finance-totals';
import { DEFAULT_TIMEZONE, dayInTimezone, hourInTimezone } from '../../shared/helpers/timezone';

/**
 * Motor das regras automáticas (docs/features/25-rules/rules.md). Tudo puro:
 * janela, condições, ação planejada, agenda e avisos.
 */

export const RULE_METRICS = {
  spend: { label: 'Gasto', unit: 'BRL' },
  sales: { label: 'Vendas', unit: 'int' },
  cpa: { label: 'CPA', unit: 'BRL' },
  roi: { label: 'ROI', unit: 'ratio' },
  roas: { label: 'ROAS', unit: 'ratio' },
  profit: { label: 'Lucro', unit: 'BRL' },
  netRevenue: { label: 'Faturamento líquido', unit: 'BRL' },
  grossRevenue: { label: 'Faturamento bruto', unit: 'BRL' },
  cpc: { label: 'CPC', unit: 'BRL' },
  cpm: { label: 'CPM', unit: 'BRL' },
  ctr: { label: 'CTR', unit: 'pct' },
  impressions: { label: 'Impressões', unit: 'int' },
  clicks: { label: 'Cliques no link', unit: 'int' },
  landingPageViews: { label: 'Visualizações da página', unit: 'int' },
  initiateCheckouts: { label: 'Inícios de checkout', unit: 'int' },
  costPerCheckout: { label: 'Custo por início de checkout', unit: 'BRL' },
  frequency: { label: 'Frequência', unit: 'ratio' },
  hook: { label: 'Hook (3 s ÷ impressões)', unit: 'pct' },
  hold: { label: 'Hold (75% ÷ impressões)', unit: 'pct' },
  dailyBudget: { label: 'Orçamento diário (moeda da conta)', unit: 'native' },
} as const;
export type RuleMetric = keyof typeof RULE_METRICS;

export const OPERATORS = ['gt', 'gte', 'lt', 'lte', 'between', 'not_between'] as const;
export type Operator = (typeof OPERATORS)[number];

export const WINDOWS = [
  'today', 'yesterday',
  'last_2_days', 'last_3_days', 'last_7_days', 'last_14_days', 'last_30_days',
  'last_2_days_with_today', 'last_3_days_with_today', 'last_7_days_with_today', 'last_14_days_with_today', 'last_30_days_with_today',
] as const;
export type RuleWindow = (typeof WINDOWS)[number];

export const ACTIONS = ['pause', 'activate', 'increase_budget', 'decrease_budget', 'set_budget'] as const;
export type RuleActionType = (typeof ACTIONS)[number];

export const FREQUENCIES = [5, 10, 15, 30, 60, 120, 180, 360, 1440] as const;

export interface RuleCondition {
  metric: RuleMetric;
  operator: Operator;
  valueA: number;
  valueB: number | null;
}

export interface RuleAction {
  type: RuleActionType;
  /** Aumento/redução: 'percentage' (0–100) ou 'amount' (moeda da conta). Definir: 'amount'. Pausar/ativar: null. */
  valueType: 'percentage' | 'amount' | null;
  value: number | null;
  /** Aumento: orçamento máximo. Redução: orçamento mínimo. Na moeda da conta. */
  limit: number | null;
}

export interface RuleDefinition {
  level: 'campaign' | 'adset' | 'ad';
  targetStatus: 'active' | 'paused';
  accountIds: string[];
  nameContains: string | null;
  conditions: RuleCondition[];
  window: RuleWindow;
  action: RuleAction;
  frequencyMinutes: (typeof FREQUENCIES)[number];
  /** Só quando frequencyMinutes = 1440: hora no fuso do painel (0–23). */
  dailyHour: number | null;
  maxRunsPerDay: number | null;
  /** Faixa de horas (fuso do painel) em que pode rodar (inclusiva). Null = o dia todo. */
  hourStart: number | null;
  hourEnd: number | null;
}

/** Linha de Campanhas com o que o motor lê. */
export interface RuleRow {
  id: string;
  name: string;
  level: string;
  accountId: string;
  status: string | null;
  effectiveStatus?: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  budgetLevel: 'campaign' | 'adset' | null;
  accountCurrency: string;
  [metric: string]: unknown;
}

export function windowRange(window: RuleWindow, today: string) {
  if (window === 'today') return { since: today, until: today };
  if (window === 'yesterday') return { since: shiftDay(today, -1), until: shiftDay(today, -1) };
  const days = Number(window.match(/last_(\d+)_days/)![1]);
  if (window.endsWith('_with_today')) return { since: shiftDay(today, 1 - days), until: today };
  return { since: shiftDay(today, -days), until: shiftDay(today, -1) };
}

export function metricValue(row: RuleRow, metric: RuleMetric): number | null {
  if (metric === 'costPerCheckout') {
    const spend = row.spend as number | null;
    const ic = row.initiateCheckouts as number | null;
    return spend === null || ic === null || ic === 0 ? null : spend / ic;
  }
  const value = row[metric];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Métrica indisponível (null) nunca casa: "CPA > 50" sem venda é falso. */
export function conditionHolds(actual: number | null, condition: RuleCondition): boolean {
  if (actual === null) return false;
  const { operator, valueA, valueB } = condition;
  const low = Math.min(valueA, valueB ?? valueA);
  const high = Math.max(valueA, valueB ?? valueA);
  switch (operator) {
    case 'gt': return actual > valueA;
    case 'gte': return actual >= valueA;
    case 'lt': return actual < valueA;
    case 'lte': return actual <= valueA;
    case 'between': return actual >= low && actual <= high;
    case 'not_between': return actual < low || actual > high;
    default: return false;
  }
}

export function evaluate(row: RuleRow, conditions: RuleCondition[]) {
  const checks = conditions.map((condition) => {
    const actual = metricValue(row, condition.metric);
    return { ...condition, actual, ok: conditionHolds(actual, condition) };
  });
  return { matched: checks.length > 0 && checks.every((check) => check.ok), checks };
}

/** Filtro de alvo: nível, status, conta e nome. */
export function inScope(row: RuleRow, rule: RuleDefinition) {
  // "Ativo" = entregando de fato: anúncio ativo dentro de campanha pausada não conta.
  if (rule.targetStatus === 'active' && (row.effectiveStatus ?? row.status) !== 'ACTIVE') return false;
  if (rule.targetStatus === 'paused' && row.status !== 'PAUSED') return false;
  if (rule.accountIds.length && !rule.accountIds.some((id) => id.replace(/^act_/, '') === row.accountId.replace(/^act_/, ''))) return false;
  if (rule.nameContains && !row.name.toLowerCase().includes(rule.nameContains.toLowerCase())) return false;
  return true;
}

export interface PlannedAction {
  action: 'pause' | 'activate' | 'set_daily_budget';
  before: string | number | null;
  after: string | number | null;
  value?: number;
  skipped?: string;
}

/** O que a ação faria nesta linha (antes → depois). `skipped` explica quando não há o que fazer. */
export function plan(row: RuleRow, action: RuleAction): PlannedAction {
  if (action.type === 'pause') {
    return row.status === 'PAUSED'
      ? { action: 'pause', before: 'PAUSED', after: 'PAUSED', skipped: 'Já está pausado.' }
      : { action: 'pause', before: row.status, after: 'PAUSED' };
  }
  if (action.type === 'activate') {
    return row.status === 'ACTIVE'
      ? { action: 'activate', before: 'ACTIVE', after: 'ACTIVE', skipped: 'Já está ativo.' }
      : { action: 'activate', before: row.status, after: 'ACTIVE' };
  }
  const current = row.dailyBudget;
  if (row.budgetLevel !== row.level || current === null) {
    return { action: 'set_daily_budget', before: current, after: current, skipped: 'O orçamento diário não mora neste nível.' };
  }
  let next: number;
  if (action.type === 'set_budget') next = action.value ?? current;
  else {
    const delta = action.valueType === 'percentage' ? current * (action.value ?? 0) / 100 : action.value ?? 0;
    next = action.type === 'increase_budget' ? current + delta : current - delta;
    if (action.limit !== null && action.type === 'increase_budget') next = Math.min(next, action.limit);
    if (action.limit !== null && action.type === 'decrease_budget') next = Math.max(next, action.limit);
  }
  next = roundMoney(Math.max(1, next));
  if (next === current) return { action: 'set_daily_budget', before: current, after: current, skipped: 'Orçamento já no limite.' };
  return { action: 'set_daily_budget', before: current, after: next, value: next };
}


export interface RuleState {
  enabled: boolean;
  lastRunAt: string | null;
  runsDay: string | null;
  runsToday: number;
}

/**
 * A regra deve rodar agora? Tolerância de 1 min para o tique de 5 min do pg_cron.
 * Janela de horário, horário diário e "execuções hoje" seguem o fuso do painel.
 */
export function isDue(rule: RuleDefinition, state: RuleState, now: Date, timeZone: string = DEFAULT_TIMEZONE): boolean {
  if (!state.enabled) return false;
  const hour = hourInTimezone(now, timeZone);
  const today = dayInTimezone(now, timeZone);
  const runsToday = state.runsDay === today ? state.runsToday : 0;
  if (rule.maxRunsPerDay !== null && runsToday >= rule.maxRunsPerDay) return false;
  if (rule.hourStart !== null && rule.hourEnd !== null) {
    const inside = rule.hourStart <= rule.hourEnd
      ? hour >= rule.hourStart && hour <= rule.hourEnd
      : hour >= rule.hourStart || hour <= rule.hourEnd;
    if (!inside) return false;
  }
  if (rule.frequencyMinutes === 1440) {
    if (rule.dailyHour !== null && hour !== rule.dailyHour) return false;
    return runsToday === 0;
  }
  if (!state.lastRunAt) return true;
  return now.getTime() - Date.parse(state.lastRunAt) >= (rule.frequencyMinutes - 1) * 60_000;
}

/**
 * Avisos de configuração arriscada. `cpa7d` é o CPA dos últimos 7 dias das
 * contas da regra (null sem venda).
 */
export function ruleWarnings(rule: RuleDefinition, cpa7d: number | null): string[] {
  const warnings: string[] = [];
  const pauses = rule.action.type === 'pause';
  const spendFloor = rule.conditions
    .filter((c) => c.metric === 'spend' && (c.operator === 'gte' || c.operator === 'gt'))
    .reduce<number | null>((min, c) => (min === null ? c.valueA : Math.min(min, c.valueA)), null);
  const waitsNoSale = rule.conditions.some((c) => c.metric === 'sales' && (c.operator === 'lte' || c.operator === 'lt') && c.valueA <= 1);
  if (pauses && rule.window === 'today' && spendFloor !== null && waitsNoSale) {
    if (cpa7d !== null && spendFloor < cpa7d) {
      warnings.push(
        `Janela "hoje" com gasto mínimo de R$ ${spendFloor.toFixed(2)}, abaixo do CPA dos últimos 7 dias (R$ ${cpa7d.toFixed(2)}): `
        + 'todo anúncio começa o dia sem venda, e o vencedor pode ser pausado toda manhã. Use um gatilho de pelo menos 2× o CPA ou uma janela de 2 dias ou mais.',
      );
    } else if (cpa7d === null) {
      warnings.push('Janela "hoje" com pausa por falta de venda: sem CPA dos últimos 7 dias para comparar. Confira se o gasto mínimo fica acima de 2× o CPA esperado.');
    }
  }
  if (pauses && rule.conditions.some((c) => c.metric === 'initiateCheckouts')) {
    warnings.push('Pausar por início de checkout: cada visita ao checkout pode gerar mais de um IC na Meta. Prefira vendas ou gasto.');
  }
  if (rule.frequencyMinutes <= 10 && ['increase_budget', 'decrease_budget'].includes(rule.action.type) && rule.maxRunsPerDay === null) {
    warnings.push('Ajuste de orçamento a cada poucos minutos sem limite de execuções por dia: o orçamento pode subir ou descer muitas vezes no mesmo dia.');
  }
  return warnings;
}
