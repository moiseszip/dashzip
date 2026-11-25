import { endOfMonth, format, parseISO, startOfMonth, subDays, subMonths } from 'date-fns';
import { displayDate } from '@/lib/costs';
import { dayInPanel } from '@/lib/timezone';
import type { SummaryDateRange } from '@/lib/summary';

export const RESULT_DATE_PRESETS = [
  { id: 'today', label: 'Hoje' },
  { id: 'yesterday', label: 'Ontem' },
  { id: 'last7', label: 'Últimos 7 dias' },
  { id: 'last30', label: 'Últimos 30 dias' },
  { id: 'thisMonth', label: 'Este mês' },
  { id: 'lastMonth', label: 'Mês passado' },
] as const;

export type DatePreset = typeof RESULT_DATE_PRESETS[number]['id'];

export interface ResultDateSelection {
  range: SummaryDateRange;
  preset: DatePreset | 'custom';
  compare: boolean;
}

export const calendarDay = (date: Date) => format(date, 'yyyy-MM-dd');

export function resultPresetRange(preset: DatePreset, today = dayInPanel()): SummaryDateRange {
  const date = parseISO(today);
  if (preset === 'yesterday') {
    const day = calendarDay(subDays(date, 1));
    return { since: day, until: day };
  }
  if (preset === 'lastMonth') {
    const lastMonth = subMonths(date, 1);
    return { since: calendarDay(startOfMonth(lastMonth)), until: calendarDay(endOfMonth(lastMonth)) };
  }
  if (preset === 'thisMonth') return { since: calendarDay(startOfMonth(date)), until: today };
  const daysBack = { today: 0, last7: 6, last30: 29 }[preset];
  return { since: calendarDay(subDays(date, daysBack)), until: today };
}

export function formatResultRange({ since, until }: SummaryDateRange) {
  return since === until ? displayDate(since) : `${displayDate(since)} a ${displayDate(until)}`;
}

/** Seleção inicial de um predefinido, sem comparação. */
export function presetSelection(preset: DatePreset): ResultDateSelection {
  return { range: resultPresetRange(preset), preset, compare: false };
}
