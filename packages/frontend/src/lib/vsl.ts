import { api } from '@/lib/api';

export const vslPeriods = ['1', '3', '7', '14', '30'] as const;
export const vslMarkets = {
  br: { label: 'ARC · BR', video: 'mini-vsl-v1', versions: ['a', 'b', 'quiz'] as const },
  us: { label: 'ARC · EUA', video: 'mini-vsl-en', versions: ['a'] as const },
};
export const vslVersions = {
  a: { label: 'Versão A', color: 'var(--viz-1)' },
  b: { label: 'Versão B', color: 'var(--viz-2)' },
  quiz: { label: 'Quiz', color: 'var(--viz-3)' },
};

export type VslMarket = keyof typeof vslMarkets;
export type VslVersion = keyof typeof vslVersions;

export interface VslGroup {
  duration: number;
  visits: number;
  plays: number;
  averageRetention: number | null;
  finish: number | null;
  checkout: { all: number | null; muted: number | null; played: number | null; half: number | null };
  curve: number[];
  milestones: { label: string; second: number; retention: number | null }[];
  creatives: { name: string; visits: number; plays: number; retention: number | null; checkout: number }[];
}

interface VslReport {
  since: string;
  until: string;
  market: VslMarket;
  selected: VslVersion[];
  versions: Record<'a', VslGroup> & Partial<Record<'b' | 'quiz', VslGroup>>;
  total: VslGroup | null;
}

export function getVslReport(workspace: string, days: string, market: VslMarket, versions: VslVersion[]) {
  const query = new URLSearchParams({ days, market, versions: versions.join(',') });
  return api.get<VslReport>(`/vsl/${workspace}?${query}`);
}

/** Período exato (aba Hotjar, seletor de data padrão). */
export function getVslReportRange(workspace: string, range: { since: string; until: string }, market: VslMarket, versions: VslVersion[]) {
  const query = new URLSearchParams({ since: range.since, until: range.until, market, versions: versions.join(',') });
  return api.get<VslReport>(`/vsl/${workspace}?${query}`);
}

export const vslPercent = (value: number | null) => value === null ? '—' : `${Math.round(value * 100)}%`;
export const vslPlayRate = ({ visits, plays }: VslGroup) => visits ? plays / visits : null;
