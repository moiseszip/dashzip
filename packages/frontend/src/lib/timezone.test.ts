import { afterEach, describe, expect, it, vi } from 'vitest';

// resultDates puxa a API, que puxa o cliente do Supabase (exige as variáveis de ambiente).
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
import {
  allTimezones, cachedTimezone, dayInPanel, dayInTimezone, DEFAULT_TIMEZONE, getActiveTimezone, isValidTimezone,
  normalizeTimezone, searchTimezones, setActiveTimezone, timezoneOffsetLabel,
} from './timezone';
import { resultPresetRange } from './resultDates';

afterEach(() => setActiveTimezone(DEFAULT_TIMEZONE));

describe('fuso do painel', () => {
  it('valida fusos IANA e cai em São Paulo quando inválido', () => {
    expect(isValidTimezone('America/Manaus')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Lua/Base_Alfa')).toBe(false);
    expect(normalizeTimezone('')).toBe(DEFAULT_TIMEZONE);
    expect(normalizeTimezone('Europe/Lisbon')).toBe('Europe/Lisbon');
  });

  it('vira o dia na meia-noite local', () => {
    const lateNightBrasil = new Date('2026-11-23T02:30:00Z'); // 23:30 de 22/11 em São Paulo
    expect(dayInTimezone('America/Sao_Paulo', lateNightBrasil)).toBe('2026-11-22');
    expect(dayInTimezone('America/Manaus', lateNightBrasil)).toBe('2026-11-22');
    expect(dayInTimezone('Europe/Lisbon', lateNightBrasil)).toBe('2026-11-23');
    expect(dayInTimezone('UTC', lateNightBrasil)).toBe('2026-11-23');
    expect(dayInTimezone('America/Sao_Paulo', new Date('2026-11-23T03:00:00Z'))).toBe('2026-11-23');
  });

  it('acompanha o horário de verão de Nova York e Lisboa', () => {
    expect(timezoneOffsetLabel('America/New_York', new Date('2026-07-01T12:00:00Z'))).toBe('UTC−04:00');
    expect(timezoneOffsetLabel('America/New_York', new Date('2026-12-01T12:00:00Z'))).toBe('UTC−05:00');
    expect(timezoneOffsetLabel('Europe/Lisbon', new Date('2026-07-01T12:00:00Z'))).toBe('UTC+01:00');
    expect(timezoneOffsetLabel('Europe/Lisbon', new Date('2026-01-15T12:00:00Z'))).toBe('UTC+00:00');
    expect(timezoneOffsetLabel('America/Sao_Paulo', new Date('2026-01-15T12:00:00Z'))).toBe('UTC−03:00');
    // 04:30 UTC de 8/3/2026: 23:30 de 7/3 em NY (ainda EST, −5).
    expect(dayInTimezone('America/New_York', new Date('2026-03-08T04:30:00Z'))).toBe('2026-03-07');
    // 03:30 UTC de 29/3/2026 em Lisboa já é horário de verão (04:30 local).
    expect(dayInTimezone('Europe/Lisbon', new Date('2026-03-28T23:30:00Z'))).toBe('2026-03-28');
  });

  it('o "hoje" dos seletores segue o painel ativo', () => {
    const instant = new Date('2026-11-23T02:30:00Z');
    expect(dayInPanel(instant)).toBe('2026-11-22');
    setActiveTimezone('Europe/Lisbon');
    expect(getActiveTimezone()).toBe('Europe/Lisbon');
    expect(dayInPanel(instant)).toBe('2026-11-23');
    expect(resultPresetRange('yesterday', dayInPanel(instant))).toEqual({ since: '2026-11-22', until: '2026-11-22' });
    expect(resultPresetRange('thisMonth', dayInPanel(instant))).toEqual({ since: '2026-11-01', until: '2026-11-23' });
    setActiveTimezone('fuso/inventado');
    expect(getActiveTimezone()).toBe(DEFAULT_TIMEZONE);
  });

  it('guarda o último fuso visto de cada painel', () => {
    setActiveTimezone('Asia/Tokyo', 'painel-1');
    expect(cachedTimezone('painel-1')).toBe('Asia/Tokyo');
    expect(cachedTimezone('painel-2')).toBeNull();
    expect(cachedTimezone(null)).toBeNull();
  });

  it('busca sem acento no nome, no id e no deslocamento', () => {
    const ids = allTimezones();
    expect(ids[0]).toBe('America/Sao_Paulo');
    expect(searchTimezones('sao paulo', ids)).toContain('America/Sao_Paulo');
    expect(searchTimezones('Brasília', ids)).toContain('America/Sao_Paulo');
    expect(searchTimezones('nova york', ids)).toContain('America/New_York');
    expect(searchTimezones('tokyo', ids)).toContain('Asia/Tokyo');
    expect(searchTimezones('', ids)).toHaveLength(ids.length);
  });
});
