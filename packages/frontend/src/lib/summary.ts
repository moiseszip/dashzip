import { api } from '@/lib/api';

/**
 * Contrato do Resumo (docs/features/24-summary/summary.md). `pct` é fração (0,12 = 12%);
 * `ratio` é número puro (ROAS 2,1). `previous` é o período anterior de mesmo tamanho.
 */

export type Unit = 'BRL' | 'int' | 'pct' | 'ratio';

export type ChartKey =
  | 'hourly' | 'daily' | 'funnelMeta' | 'funnelTracking' | 'byProduct' | 'byPaymentMethod' | 'approvalRate'
  | 'byDayOfWeek' | 'byHour' | 'byCountry' | 'byState' | 'byUtmSource' | 'byUtmTerm';

export interface SummaryCard {
  key: string;
  label: string;
  value: number | null;
  unit: Unit;
  previous?: number | null;
}

export interface SeriesPoint {
  label: string;
  [metric: string]: string | number | null;
}

export interface SummaryResponse {
  since: string;
  until: string;
  previousPeriod: { since: string; until: string } | null;
  currency: 'BRL';
  cards: SummaryCard[];
  charts: Partial<Record<ChartKey, SeriesPoint[]>>;
  catalog: {
    /** Agrupamento do "Adicionar card"; qualquer item vai em qualquer seção. */
    categories: { key: string; title: string }[];
    cards: { key: string; label: string; unit: Unit; category: string; hint?: string }[];
    charts: { key: string; label: string; category: string; hint?: string }[];
  };
  filters: { accounts: { id: string; name: string | null; currency: string | null }[]; products: string[]; platforms: string[] };
  warnings: string[];
  /** 'wiapy' quando o período veio da Wiapy na hora; ausente em API antiga. */
  salesSource?: 'wiapy' | 'webhook';
}

/** Item na grade da seção: posição (x, y) e tamanho (w, h) em passos da grade de 12 colunas. */
export interface LayoutItem {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutSection {
  key: string;
  title: string;
  collapsed: boolean;
  items: LayoutItem[];
}

export interface SummaryLayout {
  version: 2;
  sections: LayoutSection[];
}

/** Formato antigo (ordem + tamanho), ainda aceito na leitura e na importação. */
export type LegacySize = 'sm' | 'md' | 'lg';
export interface SummaryLayoutV1 {
  version: 1;
  sections: { key: string; title: string; collapsed: boolean; items: { key: string; size: LegacySize }[] }[];
}

export interface LayoutResponse {
  layout: SummaryLayout;
  saved: boolean;
  defaultLayout: SummaryLayout;
}

export interface SummaryFilters {
  accountIds: string[];
  products: string[];
  platforms: string[];
}

export type SummaryDateRange = { since: string; until: string };
export type SummaryDateSelection = SummaryDateRange | { days: '7' | '30' | '90' };

export function summaryQuery(period: SummaryDateSelection, filters: SummaryFilters, compare = false) {
  const params = new URLSearchParams(period);
  if (!compare) params.set('compare', '0');
  if (filters.accountIds.length) params.set('accountIds', filters.accountIds.join(','));
  if (filters.products.length) params.set('products', filters.products.join(','));
  if (filters.platforms.length) params.set('platforms', filters.platforms.join(','));
  return params.toString();
}

export const summaryApi = {
  get: (dashboardId: string, period: SummaryDateSelection, filters: SummaryFilters, compare = false) =>
    api.get<SummaryResponse>(`/summary/${dashboardId}?${summaryQuery(period, filters, compare)}`),
  layout: (dashboardId: string) => api.get<LayoutResponse>(`/preferences/${dashboardId}/summary-layout`),
  saveLayout: (dashboardId: string, layout: SummaryLayout | SummaryLayoutV1) =>
    api.put<LayoutResponse>(`/preferences/${dashboardId}/summary-layout`, { layout }),
  resetLayout: (dashboardId: string) => api.delete<LayoutResponse>(`/preferences/${dashboardId}/summary-layout`),
};

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlCompact = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function formatUnit(value: number | null | undefined, unit: Unit) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (unit === 'BRL') return brl.format(value);
  if (unit === 'int') return integer.format(value);
  if (unit === 'pct') return `${pct1.format(value * 100)}%`;
  return `${decimal.format(value)}x`;
}

export function formatCompact(value: number | null | undefined, unit: Unit) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (unit === 'BRL') return Math.abs(value) >= 10_000 ? brlCompact.format(value) : brl.format(value);
  return formatUnit(value, unit);
}

/** Valor de um card: o ROI vai sem o "x" (como em Campanhas e Testes); o ROAS mantém. */
export function formatCardValue(key: string, value: number | null | undefined, unit: Unit) {
  if (key === 'margin' && unit === 'pct' && value !== null && value !== undefined && Number.isFinite(value)) {
    return `${decimal.format(value * 100)}%`;
  }
  if (key === 'roi' && unit === 'ratio') {
    return value === null || value === undefined || !Number.isFinite(value) ? '—' : decimal.format(value);
  }
  return formatUnit(value, unit);
}

/**
 * Cor de ganho/perda pelo próprio valor (não pela variação): Lucro e Margem pelo
 * sinal; ROI e ROAS contra o valor de referência 1. No valor de referência
 * ou sem dado, null (cor normal).
 */
export function gainTone(key: string, value: number | null | undefined): 'gain' | 'loss' | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const breakEven = key === 'roi' || key === 'roas' ? 1 : key === 'profit' || key === 'margin' ? 0 : null;
  if (breakEven === null || value === breakEven) return null;
  return value > breakEven ? 'gain' : 'loss';
}

export const TONE_CLASS = { gain: 'text-success', loss: 'text-destructive' } as const;

/** Cards em que subir é ruim (custo, devolução): a variação inverte o sentido da cor. */
export const LOWER_IS_BETTER = new Set([
  'spend', 'cpa', 'fees', 'taxes', 'mediaTax', 'productCosts', 'expenses', 'refundRate', 'refundedRevenue',
  'chargebackRate', 'cpc', 'cpm', 'costPerCheckout',
]);

export function variation(value: number | null, previous: number | null | undefined) {
  if (value === null || previous === null || previous === undefined || previous === 0) return null;
  return (value - previous) / Math.abs(previous);
}
