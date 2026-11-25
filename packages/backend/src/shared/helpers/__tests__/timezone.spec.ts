import {
  DEFAULT_TIMEZONE, dayInTimezone, dayRangeUtc, dayStartUtc, hourInTimezone, isValidTimezone, normalizeTimezone, weekdayInTimezone,
} from '../timezone';
import { needsSecondFactor, tokenAal } from '../../../common/guards/auth.guard';
import { dayRangeBounds, periodStart } from '../../../modules/sales/sales-list';
import { isDue, RuleDefinition } from '../../../modules/rules/rules-engine';
import { hourInSaoPaulo, weekdayInSaoPaulo } from '../../../modules/summary/summary-metrics';

describe('fuso do painel', () => {
  it('valida e normaliza fusos IANA', () => {
    expect(isValidTimezone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Europe/Lisbon')).toBe(true);
    expect(isValidTimezone('Brasil/Hora_Certa')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone(null)).toBe(false);
    expect(normalizeTimezone('nada')).toBe(DEFAULT_TIMEZONE);
    expect(normalizeTimezone(undefined)).toBe(DEFAULT_TIMEZONE);
    expect(normalizeTimezone('Asia/Tokyo')).toBe('Asia/Tokyo');
  });

  it('vira o dia na meia-noite local de cada fuso', () => {
    const instant = new Date('2026-11-23T02:30:00Z');
    expect(dayInTimezone(instant, 'America/Sao_Paulo')).toBe('2026-11-22');
    expect(dayInTimezone(instant, 'America/Manaus')).toBe('2026-11-22');
    expect(dayInTimezone(instant, 'UTC')).toBe('2026-11-23');
    expect(dayInTimezone(instant, 'Europe/Lisbon')).toBe('2026-11-23');
    expect(dayInTimezone(new Date('2026-11-23T03:00:00Z'), 'America/Sao_Paulo')).toBe('2026-11-23');
    expect(dayInTimezone(new Date('2026-11-23T02:59:59Z'), 'America/Sao_Paulo')).toBe('2026-11-22');
    expect(hourInTimezone(instant, 'America/Sao_Paulo')).toBe(23);
    expect(hourInTimezone(instant, 'Asia/Tokyo')).toBe(11);
    expect(weekdayInTimezone(instant, 'America/Sao_Paulo')).toBe(0);
    expect(weekdayInTimezone(instant, 'UTC')).toBe(1);
  });

  it('São Paulo sem horário de verão começa o dia às 03:00 UTC, como antes', () => {
    expect(dayStartUtc('2026-11-23', 'America/Sao_Paulo').toISOString()).toBe('2026-11-23T03:00:00.000Z');
    expect(dayRangeUtc('2026-11-01', '2026-11-07', 'America/Sao_Paulo')).toEqual({
      from: '2026-11-01T03:00:00.000Z', to: '2026-11-08T03:00:00.000Z',
    });
    expect(dayStartUtc('2026-11-23', 'America/Manaus').toISOString()).toBe('2026-11-23T04:00:00.000Z');
    expect(dayStartUtc('2026-11-23', 'UTC').toISOString()).toBe('2026-11-23T00:00:00.000Z');
  });

  it('respeita o horário de verão de Nova York e Lisboa', () => {
    expect(dayStartUtc('2026-07-01', 'America/New_York').toISOString()).toBe('2026-07-01T04:00:00.000Z');
    expect(dayStartUtc('2026-12-01', 'America/New_York').toISOString()).toBe('2026-12-01T05:00:00.000Z');
    // Dia da mudança (8/3/2026, 02:00 → 03:00): começa à meia-noite EST e tem 23 h.
    const spring = dayRangeUtc('2026-03-08', '2026-03-08', 'America/New_York');
    expect(spring.from).toBe('2026-03-08T05:00:00.000Z');
    expect((Date.parse(spring.to) - Date.parse(spring.from)) / 3_600_000).toBe(23);
    // Volta (1/11/2026): 25 h.
    const fall = dayRangeUtc('2026-11-01', '2026-11-01', 'America/New_York');
    expect((Date.parse(fall.to) - Date.parse(fall.from)) / 3_600_000).toBe(25);
    expect(dayStartUtc('2026-07-01', 'Europe/Lisbon').toISOString()).toBe('2026-06-30T23:00:00.000Z');
    expect(dayStartUtc('2026-01-15', 'Europe/Lisbon').toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('acha o começo do dia quando a meia-noite não existe (horário de verão antigo do Brasil)', () => {
    // 4/11/2018: 00:00 virou 01:00 em São Paulo; o dia começou às 01:00 local (03:00 UTC).
    expect(dayStartUtc('2018-11-04', 'America/Sao_Paulo').toISOString()).toBe('2018-11-04T03:00:00.000Z');
    // 17/2/2019: 00:00 voltou para 23:00 do dia 16; o dia 17 começa na segunda meia-noite (03:00 UTC).
    expect(dayStartUtc('2019-02-17', 'America/Sao_Paulo').toISOString()).toBe('2019-02-17T03:00:00.000Z');
    expect(dayStartUtc('2019-01-10', 'America/Sao_Paulo').toISOString()).toBe('2019-01-10T02:00:00.000Z');
  });

  it('Vendas cortam o intervalo e o "hoje" no fuso do painel', () => {
    expect(dayRangeBounds('2026-11-22', '2026-11-22')).toEqual({ from: '2026-11-22T03:00:00.000Z', to: '2026-11-23T03:00:00.000Z' });
    expect(dayRangeBounds('2026-11-22', '2026-11-22', 'Europe/Lisbon')).toEqual({ from: '2026-11-22T00:00:00.000Z', to: '2026-11-23T00:00:00.000Z' });
    const now = Date.parse('2026-11-23T01:00:00Z');
    expect(periodStart('today', now)).toBe('2026-11-22T03:00:00.000Z');
    expect(periodStart('today', now, 'UTC')).toBe('2026-11-23T00:00:00.000Z');
  });

  it('regra diária roda na hora local do painel', () => {
    const rule = {
      frequencyMinutes: 1440, dailyHour: 9, maxRunsPerDay: null, hourStart: null, hourEnd: null,
    } as unknown as RuleDefinition;
    const state = { enabled: true, lastRunAt: null, runsDay: null, runsToday: 0 };
    const nineInLisbon = new Date('2026-11-23T09:10:00Z');
    expect(isDue(rule, state, nineInLisbon, 'Europe/Lisbon')).toBe(true);
    expect(isDue(rule, state, nineInLisbon)).toBe(false);
    expect(isDue(rule, state, new Date('2026-11-23T12:10:00Z'))).toBe(true);
  });
});

describe('Resultado no fuso do painel', () => {
  it('hora e dia da semana do pedido seguem o fuso', () => {
    expect(hourInSaoPaulo('2026-11-23T02:30:00Z')).toBe(23);
    expect(hourInSaoPaulo('2026-11-23T02:30:00Z', 'Europe/Lisbon')).toBe(2);
    expect(weekdayInSaoPaulo('2026-11-23T02:30:00Z')).toBe(0);
    expect(weekdayInSaoPaulo('2026-11-23T02:30:00Z', 'UTC')).toBe(1);
  });
});

describe('2FA no backend', () => {
  const jwt = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;

  it('lê a claim aal do token', () => {
    expect(tokenAal(jwt({ aal: 'aal2' }))).toBe('aal2');
    expect(tokenAal(jwt({}))).toBeNull();
    expect(tokenAal('nao-e-jwt')).toBeNull();
  });

  it('exige aal2 só de quem tem fator verificado', () => {
    const withFactor = { factors: [{ status: 'verified' }] };
    expect(needsSecondFactor(withFactor, jwt({ aal: 'aal1' }))).toBe(true);
    expect(needsSecondFactor(withFactor, jwt({ aal: 'aal2' }))).toBe(false);
    expect(needsSecondFactor({ factors: [{ status: 'unverified' }] }, jwt({ aal: 'aal1' }))).toBe(false);
    expect(needsSecondFactor({}, jwt({ aal: 'aal1' }))).toBe(false);
    expect(needsSecondFactor({ factors: null }, 'fixture')).toBe(false);
  });
});
