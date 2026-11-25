import { api } from '@/lib/api';
import type { SummaryDateRange } from '@/lib/summary';
import type { VslMarket, VslVersion } from '@/lib/vsl';

/** Aba Hotjar (docs/features/27-hotjar): tipos e chamadas da API. */

export type HotjarDevice = 'mobile' | 'desktop';

export interface HotjarFilters {
  device: HotjarDevice;
  /** utm_source da sessão; null = todas. */
  source: string | null;
  /** utm_campaign da sessão (nome|id); null = todas. */
  campaign: string | null;
}

export interface HotjarPage {
  url: string;
  views: number;
  avgDepth: number | null;
  reachedEnd: number;
  clicks: number;
  quiz: boolean;
  vsl: { market: VslMarket; version: VslVersion } | null;
}

export interface HotjarFilterOption {
  value: string;
  sessions: number;
}

export interface HotjarPagesResponse {
  pages: HotjarPage[];
  filters: { sources: HotjarFilterOption[]; campaigns: HotjarFilterOption[] };
}

export interface DropBand {
  from: number;
  to: number;
  share: number;
}

export interface PageRetention {
  views: number;
  reach: number[];
  avgDepth: number | null;
  reachedEnd: number | null;
  fold: number | null;
  dropoff: DropBand[];
  biggestDrop: DropBand | null;
  screens: { screen: number; at: number; reach: number }[];
  time: {
    measured: number;
    median: number | null;
    average: number | null;
    buckets: { label: string; min: number; visits: number; share: number }[];
  };
}

export interface QuizStep {
  step: string;
  index: number;
  sessions: number;
  ofStart: number;
  fromPrevious: number | null;
  advanced: number | null;
}

export interface QuizFunnel {
  started: number;
  finished: number;
  steps: QuizStep[];
  worstStep: string | null;
}

export interface HotjarTopElement {
  selector: string | null;
  label: string | null;
  clicks: number;
  share: number;
}

export interface HotjarPageDetail {
  retention: PageRetention;
  clicks: { total: number; topElements: HotjarTopElement[] };
  quiz: QuizFunnel | null;
  vsl: HotjarPage['vsl'];
}

export interface TimingBucket {
  label: string;
  min: number;
  max: number | null;
  purchases: number;
  share: number;
  cumulative: number;
}

export interface TimingSummary {
  measured: number;
  discarded: number;
  missing: number;
  median: number | null;
  average: number | null;
  p75: number | null;
  p90: number | null;
  buckets: TimingBucket[];
}

/** Tempo até a compra: do primeiro carregamento da página até o checkout e até a aprovação. */
export interface PurchaseTiming {
  purchases: number;
  otherPages: number;
  noSession: number;
  checkout: TimingSummary;
  purchase: TimingSummary;
}

function query(workspaceId: string, range: SummaryDateRange, filters: HotjarFilters, extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ workspace_id: workspaceId, since: range.since, until: range.until, device: filters.device, ...extra });
  if (filters.source) q.set('source', filters.source);
  if (filters.campaign) q.set('campaign', filters.campaign);
  return q.toString();
}

export function getHotjarPages(workspaceId: string, range: SummaryDateRange, filters: HotjarFilters) {
  return api.get<HotjarPagesResponse>(`/hotjar/pages?${query(workspaceId, range, filters)}`);
}

export function getHotjarPage(workspaceId: string, url: string, range: SummaryDateRange, filters: HotjarFilters) {
  return api.get<HotjarPageDetail>(`/hotjar/page?${query(workspaceId, range, filters, { url })}`);
}

export function getHotjarPurchaseTiming(workspaceId: string, url: string, range: SummaryDateRange, filters: HotjarFilters) {
  return api.get<PurchaseTiming>(`/hotjar/purchase-timing?${query(workspaceId, range, filters, { url })}`);
}

/** "arch.exemplo.com/quiz": domínio sem www + caminho. */
export function pagePath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url || '—';
  }
}

export const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Math.round(n)}%`);

/** 75 → "1 min 15 s"; 42 → "42 s"; 4500 → "1 h 15 min". */
export function duration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds} s`;
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const min = Math.floor((seconds % 3600) / 60);
    return min ? `${h} h ${min} min` : `${h} h`;
  }
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}

/** "cbo-kit|120256873073380460" → "cbo-kit". */
export const campaignName = (value: string) => value.split('|')[0].trim() || value;

/**
 * Link da página real com o mapa desenhado por cima (heatmap.js). `embed`
 * tira a barra do topo: os controles ficam no painel.
 */
export function heatmapEmbedLink(
  url: string,
  token: string,
  mode: 'clicks' | 'scroll',
  range: SummaryDateRange,
  filters: HotjarFilters,
  embed: boolean,
): string {
  const u = new URL(url);
  u.searchParams.set('stl_heatmap', token);
  u.searchParams.set('stl_hm', mode);
  u.searchParams.set('stl_hm_dev', filters.device);
  u.searchParams.set('stl_hm_since', range.since);
  u.searchParams.set('stl_hm_until', range.until);
  if (filters.source) u.searchParams.set('stl_hm_src', filters.source);
  if (filters.campaign) u.searchParams.set('stl_hm_cmp', filters.campaign);
  if (embed) u.searchParams.set('stl_hm_embed', '1');
  return u.toString();
}

/** Nome legível da etapa do quiz: "compromisso" → "Compromisso", "passo_2" → "Passo 2". */
export function stepLabel(step: string): string {
  const t = step.replace(/[_-]+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : step;
}
