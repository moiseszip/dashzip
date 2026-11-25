/**
 * Fuso horário do painel. Cada painel guarda um fuso IANA em
 * `workspaces.timezone` (padrão America/Sao_Paulo) e ele decide o que é
 * "hoje" e onde cada dia começa e termina. Doc: docs/features/30-settings.
 *
 * Tudo aqui usa o Intl do Node, que conhece o horário de verão de cada fuso:
 * nada de deslocamento fixo como o antigo `T03:00:00Z`.
 */

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Fuso IANA que o runtime reconhece. "UTC" vale; texto livre não. */
export function isValidTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** O fuso salvo ou, se vier vazio ou inválido, São Paulo. */
export function normalizeTimezone(value: unknown): string {
  return isValidTimezone(value) ? value : DEFAULT_TIMEZONE;
}

interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: string }

function localParts(date: Date, timeZone: string): LocalParts {
  const out: Record<string, string> = {};
  for (const part of partsFormatter(timeZone).formatToParts(date)) out[part.type] = part.value;
  return {
    year: Number(out.year), month: Number(out.month), day: Number(out.day),
    hour: Number(out.hour) % 24, minute: Number(out.minute), second: Number(out.second), weekday: out.weekday,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-11-23": o dia do calendário daquele instante no fuso. */
export function dayInTimezone(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Hora local (0–23) daquele instante no fuso. */
export function hourInTimezone(date: Date, timeZone: string): number {
  return localParts(date, timeZone).hour;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Dia da semana local (0 = domingo). */
export function weekdayInTimezone(date: Date, timeZone: string): number {
  return WEEKDAYS[localParts(date, timeZone).weekday];
}

/** Diferença, em ms, entre o relógio local e o UTC naquele instante. */
function offsetAt(instant: number, timeZone: string): number {
  const p = localParts(new Date(instant), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * Primeiro instante (UTC) do dia `day` no fuso. Em dia de horário de verão
 * em que a meia-noite não existe (o relógio pula de 23:59 para 01:00), é o
 * primeiro instante que já cai naquele dia.
 */
export function dayStartUtc(day: string, timeZone: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d);
  const first = wall - offsetAt(wall, timeZone);
  const second = wall - offsetAt(first, timeZone);
  const candidates = [first, second].filter((t) => dayInTimezone(new Date(t), timeZone) === day);
  return new Date(candidates.length ? Math.min(...candidates) : first);
}

/** Limites em UTC de um intervalo de dias locais: início inclusivo, fim exclusivo. */
export function dayRangeUtc(since: string, until: string, timeZone: string): { from: string; to: string } {
  return { from: dayStartUtc(since, timeZone).toISOString(), to: dayStartUtc(shiftDay(until, 1), timeZone).toISOString() };
}

/** Soma dias a um "YYYY-MM-DD" (aritmética de calendário, sem fuso). */
export function shiftDay(day: string, days: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
