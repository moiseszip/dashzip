import { normalizeRule } from '../rules.controller';
import {
  conditionHolds, evaluate, inScope, isDue, plan, RuleDefinition, RuleRow, ruleWarnings, windowRange,
} from '../rules-engine';

const row = (fields: Partial<RuleRow> = {}): RuleRow => ({
  id: '120200000000000001', name: 'ARC | Vídeo 03', level: 'adset', accountId: 'act_111', status: 'ACTIVE',
  dailyBudget: 20, lifetimeBudget: null, budgetLevel: 'adset', accountCurrency: 'USD',
  spend: 80, sales: 0, cpa: null, roi: null, initiateCheckouts: 4, ...fields,
});

const rule = (fields: Partial<RuleDefinition> = {}): RuleDefinition => ({
  level: 'adset', targetStatus: 'active', accountIds: [], nameContains: null,
  conditions: [{ metric: 'sales', operator: 'lte', valueA: 0, valueB: null }, { metric: 'spend', operator: 'gte', valueA: 70, valueB: null }],
  window: 'today', action: { type: 'pause', valueType: null, value: null, limit: null },
  frequencyMinutes: 10, dailyHour: null, maxRunsPerDay: null, hourStart: null, hourEnd: null, ...fields,
});

describe('Janela', () => {
  it('converte a janela em período de São Paulo', () => {
    expect(windowRange('today', '2026-11-22')).toEqual({ since: '2026-11-22', until: '2026-11-22' });
    expect(windowRange('yesterday', '2026-11-22')).toEqual({ since: '2026-11-21', until: '2026-11-21' });
    expect(windowRange('last_7_days', '2026-11-22')).toEqual({ since: '2026-11-15', until: '2026-11-21' });
    expect(windowRange('last_3_days_with_today', '2026-11-22')).toEqual({ since: '2026-11-20', until: '2026-11-22' });
  });
});

describe('Condições', () => {
  it('todas precisam casar; métrica indisponível nunca casa', () => {
    expect(evaluate(row(), rule().conditions).matched).toBe(true);
    expect(evaluate(row({ sales: 1 }), rule().conditions).matched).toBe(false);
    expect(conditionHolds(null, { metric: 'cpa', operator: 'gt', valueA: 50, valueB: null })).toBe(false);
    expect(conditionHolds(30, { metric: 'cpa', operator: 'between', valueA: 40, valueB: 20 })).toBe(true);
    expect(conditionHolds(30, { metric: 'cpa', operator: 'not_between', valueA: 20, valueB: 40 })).toBe(false);
  });

  it('custo por início de checkout é calculado', () => {
    const result = evaluate(row(), [{ metric: 'costPerCheckout', operator: 'gt', valueA: 19, valueB: null }]);
    expect(result.checks[0]).toMatchObject({ actual: 20, ok: true });
  });

  it('filtra por status, conta e nome', () => {
    expect(inScope(row(), rule())).toBe(true);
    expect(inScope(row({ status: 'PAUSED' }), rule())).toBe(false);
    expect(inScope(row({ effectiveStatus: 'CAMPAIGN_PAUSED' }), rule())).toBe(false);
    expect(inScope(row(), rule({ accountIds: ['act_222'] }))).toBe(false);
    expect(inScope(row(), rule({ accountIds: ['111'], nameContains: 'arc' }))).toBe(true);
    expect(inScope(row(), rule({ nameContains: 'NBR' }))).toBe(false);
  });
});

describe('Ação planejada', () => {
  it('pausa mostra antes e depois', () => {
    expect(plan(row(), rule().action)).toEqual({ action: 'pause', before: 'ACTIVE', after: 'PAUSED' });
  });

  it('aumento percentual respeita o teto e redução respeita o piso', () => {
    expect(plan(row(), { type: 'increase_budget', valueType: 'percentage', value: 20, limit: 30 }))
      .toEqual({ action: 'set_daily_budget', before: 20, after: 24, value: 24 });
    expect(plan(row({ dailyBudget: 28 }), { type: 'increase_budget', valueType: 'percentage', value: 20, limit: 30 }))
      .toMatchObject({ after: 30, value: 30 });
    expect(plan(row(), { type: 'decrease_budget', valueType: 'amount', value: 15, limit: 10 })).toMatchObject({ after: 10 });
    expect(plan(row({ dailyBudget: 10 }), { type: 'decrease_budget', valueType: 'amount', value: 5, limit: 10 }))
      .toMatchObject({ skipped: 'Orçamento já no limite.' });
  });

  it('não mexe em orçamento que mora em outro nível', () => {
    expect(plan(row({ budgetLevel: 'campaign', dailyBudget: null }), { type: 'set_budget', valueType: 'amount', value: 50, limit: null }))
      .toMatchObject({ skipped: 'O orçamento diário não mora neste nível.' });
  });
});

describe('Agenda', () => {
  const state = { enabled: true, lastRunAt: '2026-11-22T13:00:00.000Z', runsDay: '2026-11-22', runsToday: 3 };
  const now = new Date('2026-11-22T13:10:30.000Z'); // 10h10 em São Paulo

  it('roda quando passou a frequência', () => {
    expect(isDue(rule(), state, now)).toBe(true);
    expect(isDue(rule({ frequencyMinutes: 15 }), state, now)).toBe(false);
    expect(isDue(rule(), { ...state, enabled: false }, now)).toBe(false);
  });

  it('respeita o limite por dia e a faixa de horas', () => {
    expect(isDue(rule({ maxRunsPerDay: 3 }), state, now)).toBe(false);
    expect(isDue(rule({ maxRunsPerDay: 3 }), { ...state, runsDay: '2026-11-21' }, now)).toBe(true);
    expect(isDue(rule({ hourStart: 11, hourEnd: 22 }), state, now)).toBe(false);
    expect(isDue(rule({ hourStart: 22, hourEnd: 11 }), state, now)).toBe(true);
  });

  it('uma vez por dia na hora marcada', () => {
    const daily = rule({ frequencyMinutes: 1440, dailyHour: 10 });
    expect(isDue(daily, { ...state, runsDay: '2026-11-21' }, now)).toBe(true);
    expect(isDue(daily, state, now)).toBe(false);
    expect(isDue({ ...daily, dailyHour: 9 }, { ...state, runsDay: '2026-11-21' }, now)).toBe(false);
  });
});

describe('Avisos', () => {
  it('janela "hoje" abaixo de 1 CPA', () => {
    const [warning] = ruleWarnings(rule(), 95);
    expect(warning).toContain('abaixo do CPA dos últimos 7 dias');
    expect(ruleWarnings(rule({ conditions: [{ metric: 'sales', operator: 'lte', valueA: 0, valueB: null }, { metric: 'spend', operator: 'gte', valueA: 200, valueB: null }] }), 95)).toEqual([]);
  });

  it('pausa por IC e orçamento sem limite diário', () => {
    expect(ruleWarnings(rule({ conditions: [{ metric: 'initiateCheckouts', operator: 'lte', valueA: 0, valueB: null }] }), 50)[0])
      .toContain('início de checkout');
    expect(ruleWarnings(rule({ action: { type: 'increase_budget', valueType: 'percentage', value: 10, limit: null }, frequencyMinutes: 5 }), null)[0])
      .toContain('sem limite de execuções');
  });
});

describe('Validação da regra', () => {
  const body = (fields: Record<string, unknown> = {}) => ({ ...rule(), ...fields }) as never;

  it('recusa combinações sem sentido', () => {
    expect(() => normalizeRule(body({ level: 'ad', action: { type: 'set_budget', valueType: 'amount', value: 10, limit: null } }))).toThrow('Anúncio não tem orçamento');
    expect(() => normalizeRule(body({ targetStatus: 'paused' }))).toThrow('Pausar só vale para objetos ativos.');
    expect(() => normalizeRule(body({ action: { type: 'increase_budget', valueType: null, value: 10, limit: null } }))).toThrow('percentual ou em valor');
    expect(() => normalizeRule(body({ hourStart: 8 }))).toThrow('faixa de horas');
  });

  it('normaliza contas e limpa campos que não se aplicam', () => {
    const normalized = normalizeRule(body({ accountIds: ['111'], nameContains: '  ', dailyHour: null }));
    expect(normalized).toMatchObject({ accountIds: ['act_111'], nameContains: null, action: { valueType: null, value: null, limit: null } });
  });
});
