import { api } from '@/lib/api';
import type { AccountInfo, ObjectRow } from '@/lib/campaigns';

export interface TestCell {
  spend: number | null;
  mediaTax: number | null;
  grossRevenue: number | null;
  netRevenue: number | null;
  salesTax: number | null;
  profit: number | null;
  sales: number;
  impressions: number | null;
  clicks: number | null;
  initiateCheckouts: number | null;
}

export interface TestOffer {
  id: string;
  name: string;
  codes: string[];
  accountIds: string[];
  products: string[];
}

export interface TestRow extends Pick<ObjectRow, 'id' | 'name' | 'accountId' | 'accountCurrency' | 'status' | 'effectiveStatus' | 'dailyBudget' | 'lifetimeBudget' | 'budgetLevel'> {
  accountName: string;
  offerId: string | null;
  byDay: Record<string, TestCell>;
}

interface Matrix {
  since: string;
  until: string;
  days: string[];
  rows: TestRow[];
  accounts: AccountInfo[];
  offers: TestOffer[];
  untrackedSales: { count: number };
  warnings: string[];
}

export interface TestChange {
  kind: 'activated' | 'paused' | 'budget';
  objectName: string | null;
  at: string;
  actor: string;
  from?: number;
  to?: number;
}

export type TestPeriod = { days: '7' | '30' | '90' } | { since: string; until: string };

export const testsApi = {
  matrix: (id: string, period: TestPeriod) => api.get<Matrix>(`/tests/${id}/matrix?${new URLSearchParams(period)}`),
  changes: (id: string) => api.get<{ changes: Record<string, TestChange[]>; warnings: string[] }>(`/tests/${id}/changes`),
  saveOffers: (id: string, offers: TestOffer[]) => api.put<{ offers: TestOffer[] }>(`/tests/${id}/offers`, { offers }),
};

export function groupDays(days: string[], grain: 'day' | 'week' | 'month') {
  const groups = new Map<string, string[]>();
  for (const day of days) {
    const date = new Date(`${day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const key = grain === 'day' ? day : grain === 'month' ? day.slice(0, 7) : date.toISOString().slice(0, 10);
    const group = groups.get(key) ?? [];
    group.push(day);
    groups.set(key, group);
  }
  return [...groups].map(([key, dates]) => ({
    key,
    dates,
    label: grain === 'month' ? key.split('-').reverse().join('/') : dates[0].slice(5).split('-').reverse().join('/'),
  }));
}

export function sumTestCells(row: TestRow, days: string[]): TestCell {
  const cells = days.flatMap((day) => row.byDay[day] ? [row.byDay[day]] : []);
  const sum = (key: keyof TestCell) => cells.reduce<number | null>(
    (total, cell) => total === null || cell[key] === null ? null : total + cell[key],
    0,
  );
  return {
    spend: sum('spend'), mediaTax: sum('mediaTax'), grossRevenue: sum('grossRevenue'), netRevenue: sum('netRevenue'), salesTax: sum('salesTax'),
    profit: sum('profit'), sales: sum('sales') ?? 0, impressions: sum('impressions'), clicks: sum('clicks'),
    initiateCheckouts: sum('initiateCheckouts'),
  };
}
