/**
 * Mapa de calor: validação do que o tracker.js manda (campo `hm` do lote do
 * /collect) e a agregação que o painel e o desenho sobre a página leem.
 *
 * Funções puras, como em collect-payload: testam sem subir o Nest.
 */
import { cleanUrl } from './collect-payload';

export type HeatmapDevice = 'mobile' | 'desktop';
export const HEATMAP_DEVICES: HeatmapDevice[] = ['mobile', 'desktop'];

/** Abaixo disso o layout é o de celular. */
const MOBILE_MAX_WIDTH = 768;
export const MAX_CLICKS_PER_BATCH = 50;
const MAX_SELECTOR = 600;
const MAX_LABEL = 60;
const MAX_DOC_PX = 200_000;
const PAGE_ID = /^[0-9a-f]{8}$/;
const MAX_SECONDS = 86_400;

export interface HeatmapClick {
  selector: string | null;
  rx: number | null;
  ry: number | null;
  px: number;
  py: number;
  label: string | null;
}

export interface HeatmapBatch {
  url: string;
  pageId: string;
  device: HeatmapDevice;
  docW: number;
  docH: number;
  /** Maior profundidade vista, em % da página. */
  depthPct: number;
  /** Fim da primeira tela, em % da página. */
  foldPct: number;
  /** Tempo com a página visível, em segundos (null em tracker antigo). */
  seconds: number | null;
  clicks: HeatmapClick[];
}

function int(value: unknown, min: number, max: number): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function fraction(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
}

function shortText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const t = value.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

export function deviceForWidth(viewportWidth: number): HeatmapDevice {
  return viewportWidth < MOBILE_MAX_WIDTH ? 'mobile' : 'desktop';
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.min(100, Math.max(0, Math.round((part / whole) * 100))) : 0;
}

/** O `hm` do lote → dados válidos, ou null. Clique malformado é descartado sozinho. */
export function parseHeatmap(raw: unknown): HeatmapBatch | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const h = raw as Record<string, unknown>;

  const url = cleanUrl(h.u);
  const pageId = typeof h.p === 'string' && PAGE_ID.test(h.p) ? h.p : null;
  const vw = int(h.vw, 0, 20_000);
  const vh = int(h.vh, 0, 20_000);
  const docW = int(h.dw, 0, 20_000);
  const docH = int(h.dh, 0, MAX_DOC_PX);
  if (!url || !pageId || !vw || !docW || !docH || docH < 100) return null;

  const depth = int(h.sd, 0, MAX_DOC_PX) ?? 0;
  const clicks: HeatmapClick[] = [];
  for (const c of Array.isArray(h.c) ? h.c.slice(0, MAX_CLICKS_PER_BATCH) : []) {
    if (!Array.isArray(c)) continue;
    const px = int(c[3], 0, docW * 2);
    const py = int(c[4], 0, MAX_DOC_PX);
    if (px === null || py === null) continue;
    const rx = fraction(c[1]);
    const ry = fraction(c[2]);
    clicks.push({
      selector: shortText(c[0], MAX_SELECTOR),
      rx: rx !== null && ry !== null ? rx : null,
      ry: rx !== null && ry !== null ? ry : null,
      px,
      py,
      label: shortText(c[5], MAX_LABEL),
    });
  }

  return {
    url,
    pageId,
    device: deviceForWidth(vw),
    docW,
    docH,
    depthPct: pct(depth, docH),
    foldPct: pct(vh ?? 0, docH),
    seconds: h.ts === undefined || h.ts === null ? null : int(h.ts, 0, MAX_SECONDS),
    clicks,
  };
}

// ---------------------------------------------------------------------------
// Agregação
// ---------------------------------------------------------------------------

export interface ClickRow {
  selector: string | null;
  rx: number | null;
  ry: number | null;
  px: number;
  py: number;
  doc_w: number;
  label: string | null;
}

export interface ScrollRow {
  depth_pct: number;
  fold_pct: number | null;
}

/** A cada 5% da página: quantos % das visitas chegaram até ali. */
export const REACH_STEP = 5;

export interface TopElement {
  selector: string | null;
  label: string | null;
  clicks: number;
  share: number;
}

export interface HeatmapPageDetail {
  views: number;
  clicks: number;
  /** reach[i] = % das visitas que chegaram a i * 5% da página. */
  reach: number[];
  avgDepth: number | null;
  /** Onde termina a primeira tela, em média, em % da página. */
  fold: number | null;
  topElements: TopElement[];
}

export function scrollReach(rows: ScrollRow[]): number[] {
  const steps = 100 / REACH_STEP;
  const reach: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const at = i * REACH_STEP;
    const reached = rows.filter((r) => r.depth_pct >= at).length;
    reach.push(rows.length ? Math.round((reached / rows.length) * 1000) / 10 : 0);
  }
  return reach;
}

export function topElements(clicks: ClickRow[], limit = 20): TopElement[] {
  const groups = new Map<string, { selector: string | null; labels: Map<string, number>; clicks: number }>();
  for (const c of clicks) {
    const key = c.selector ?? '';
    const g = groups.get(key) ?? { selector: c.selector, labels: new Map(), clicks: 0 };
    g.clicks++;
    if (c.label) g.labels.set(c.label, (g.labels.get(c.label) ?? 0) + 1);
    groups.set(key, g);
  }
  return [...groups.values()]
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, limit)
    .map((g) => ({
      selector: g.selector,
      label: [...g.labels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      clicks: g.clicks,
      share: clicks.length ? Math.round((g.clicks / clicks.length) * 1000) / 10 : 0,
    }));
}

export function buildPageDetail(clicks: ClickRow[], scrolls: ScrollRow[]): HeatmapPageDetail {
  const folds = scrolls.map((s) => s.fold_pct).filter((f): f is number => typeof f === 'number');
  return {
    views: scrolls.length,
    clicks: clicks.length,
    reach: scrollReach(scrolls),
    avgDepth: scrolls.length
      ? Math.round((scrolls.reduce((sum, s) => sum + s.depth_pct, 0) / scrolls.length) * 10) / 10
      : null,
    fold: folds.length ? Math.round(folds.reduce((a, b) => a + b, 0) / folds.length) : null,
    topElements: topElements(clicks),
  };
}

/** O formato compacto que o desenho sobre a página lê: [seletor, rx, ry, px, py, largura da página]. */
export function overlayPoints(clicks: ClickRow[]): Array<[string | null, number | null, number | null, number, number, number]> {
  return clicks.map((c) => [c.selector, c.rx, c.ry, c.px, c.py, c.doc_w]);
}

// ---------------------------------------------------------------------------
// Período e filtros da aba Hotjar
// ---------------------------------------------------------------------------

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** O mesmo teto do seletor de período do painel. */
export const MAX_RANGE_DAYS = 92;

/** "YYYY-MM-DD" a "YYYY-MM-DD", inclusivos, em ordem e com no máximo 92 dias; senão null. */
export function validDayRange(since: unknown, until: unknown): { since: string; until: string } | null {
  if (typeof since !== 'string' || typeof until !== 'string' || !DAY.test(since) || !DAY.test(until)) return null;
  const a = Date.parse(`${since}T00:00:00Z`);
  const b = Date.parse(`${until}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  if ((b - a) / 86_400_000 + 1 > MAX_RANGE_DAYS) return null;
  // Data que não existe (2026-02-31) vira outro dia no Date.parse: recusa.
  if (new Date(a).toISOString().slice(0, 10) !== since || new Date(b).toISOString().slice(0, 10) !== until) return null;
  return { since, until };
}

/** Valor de filtro (utm_source / utm_campaign) como veio da sessão; vazio = todos. */
export function filterValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v ? v.slice(0, 300) : null;
}
