/**
 * Aba Hotjar (docs/features/27-hotjar): as contas de retenção da página e do
 * funil do quiz. Funções puras, testadas sem subir o Nest.
 */
import { REACH_STEP, scrollReach } from '../tracking/heatmap';
import { VSL_MARKETS, versionOf, type VslMarket, type VslVersion } from '../vsl/vsl.aggregate';

export interface RetentionRow {
  depth_pct: number;
  fold_pct: number | null;
  seconds: number | null;
}

export interface DropBand {
  /** Faixa da página, em %: de `from` a `to`. */
  from: number;
  to: number;
  /** % das visitas que pararam de rolar nessa faixa. */
  share: number;
}

export interface ScreenReach {
  /** 1 = primeira tela. */
  screen: number;
  /** Onde a tela termina, em % da página. */
  at: number;
  reach: number;
}

export interface TimeBucket {
  label: string;
  /** Limite inferior, em segundos (inclusivo). */
  min: number;
  visits: number;
  share: number;
}

export interface PageRetention {
  views: number;
  /** reach[i] = % das visitas que chegaram a i * 5% da página. */
  reach: number[];
  avgDepth: number | null;
  /** % que viu 90% da página ou mais. */
  reachedEnd: number | null;
  /** Fim da primeira tela, em média, em % da página. */
  fold: number | null;
  /** Onde as visitas param de rolar, a cada 10% da página. */
  dropoff: DropBand[];
  /** A faixa onde mais gente para (fora a primeira tela), ou null sem dados. */
  biggestDrop: DropBand | null;
  /** Alcance ao fim de cada tela (dobra), até 10 telas. */
  screens: ScreenReach[];
  time: {
    /** Visitas com tempo medido (tracker novo). */
    measured: number;
    median: number | null;
    average: number | null;
    buckets: TimeBucket[];
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export const TIME_BUCKETS: { label: string; min: number }[] = [
  { label: 'até 10 s', min: 0 },
  { label: '10–30 s', min: 10 },
  { label: '30 s–1 min', min: 30 },
  { label: '1–2 min', min: 60 },
  { label: '2–5 min', min: 120 },
  { label: '5 min ou mais', min: 300 },
];

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Alcance numa posição qualquer da página, interpolando entre os pontos de 5%. */
export function reachAt(reach: number[], pct: number): number {
  if (!reach.length) return 0;
  const i = Math.floor(pct / REACH_STEP);
  if (i >= reach.length - 1) return reach[reach.length - 1];
  const f = (pct - i * REACH_STEP) / REACH_STEP;
  return round1(reach[i] + (reach[i + 1] - reach[i]) * f);
}

export function buildRetention(rows: RetentionRow[]): PageRetention {
  const views = rows.length;
  const reach = scrollReach(rows);
  const folds = rows.map((r) => r.fold_pct).filter((f): f is number => typeof f === 'number' && f > 0);
  const fold = folds.length ? Math.round(folds.reduce((a, b) => a + b, 0) / folds.length) : null;

  // Onde parou: a profundidade máxima de cada visita cai numa faixa de 10%.
  // 100% entra na última faixa.
  const dropoff: DropBand[] = [];
  for (let from = 0; from < 100; from += 10) {
    const to = from + 10;
    const n = rows.filter((r) => r.depth_pct >= from && (to === 100 ? r.depth_pct <= 100 : r.depth_pct < to)).length;
    dropoff.push({ from, to, share: views ? round1((n / views) * 100) : 0 });
  }
  // A primeira tela sempre aparece inteira: quem "parou" nela só não rolou.
  // A maior queda que importa é a que vem depois do fim da primeira tela, sem
  // contar a última faixa (lá é o fim da página, não abandono).
  const firstScreenEnd = fold ?? 0;
  const candidates = dropoff.filter((b) => b.to > firstScreenEnd && b.to < 100 && b.share > 0);
  const biggestDrop = views && candidates.length
    ? candidates.reduce((best, b) => (b.share > best.share ? b : best))
    : null;

  const screens: ScreenReach[] = [];
  if (fold && views) {
    for (let k = 1; k <= 10 && k * fold <= 100; k++) {
      screens.push({ screen: k, at: k * fold, reach: reachAt(reach, k * fold) });
    }
  }

  const secs = rows.map((r) => r.seconds).filter((s): s is number => typeof s === 'number' && s >= 0);
  const buckets = TIME_BUCKETS.map((b, i) => {
    const max = TIME_BUCKETS[i + 1]?.min ?? Infinity;
    const n = secs.filter((s) => s >= b.min && s < max).length;
    return { ...b, visits: n, share: secs.length ? round1((n / secs.length) * 100) : 0 };
  });

  return {
    views,
    reach,
    avgDepth: views ? round1(rows.reduce((sum, r) => sum + r.depth_pct, 0) / views) : null,
    reachedEnd: views ? round1((rows.filter((r) => r.depth_pct >= 90).length / views) * 100) : null,
    fold,
    dropoff,
    biggestDrop,
    screens,
    time: {
      measured: secs.length,
      median: median(secs),
      average: secs.length ? Math.round(secs.reduce((a, b) => a + b, 0) / secs.length) : null,
      buckets,
    },
  };
}

// ---------------------------------------------------------------------------
// Quiz
// ---------------------------------------------------------------------------

export interface QuizRow {
  session_id: string;
  step: string;
  idx: number | null;
  first_at: string;
}

export interface QuizStep {
  step: string;
  index: number;
  /** Sessões que chegaram nesta etapa (ou numa depois dela). */
  sessions: number;
  /** % das sessões que começaram o quiz. */
  ofStart: number;
  /** % de quem chegou na etapa anterior e chegou nesta. */
  fromPrevious: number | null;
  /** % de quem chegou aqui e avançou para a próxima. */
  advanced: number | null;
}

export interface QuizFunnel {
  started: number;
  finished: number;
  steps: QuizStep[];
  /** A etapa que mais perde gente (avançou mais baixo), fora a última. */
  worstStep: string | null;
}

/**
 * Funil do quiz: a ordem das etapas vem do `index` mandado pela página; sem
 * ele, da ordem média em que as sessões viram cada etapa. Uma sessão que
 * chegou numa etapa conta em todas as anteriores (quem recarregou no meio e
 * caiu direto num passo adiante também passou pelos de antes).
 */
export function buildQuizFunnel(rows: QuizRow[]): QuizFunnel | null {
  if (!rows.length) return null;

  const meta = new Map<string, { idx: number | null; order: number[] }>();
  const bySession = new Map<string, QuizRow[]>();
  for (const r of rows) {
    const list = bySession.get(r.session_id) ?? [];
    list.push(r);
    bySession.set(r.session_id, list);
  }
  for (const list of bySession.values()) {
    list.sort((a, b) => a.first_at.localeCompare(b.first_at));
    list.forEach((r, position) => {
      const m = meta.get(r.step) ?? { idx: null, order: [] };
      if (typeof r.idx === 'number') m.idx = m.idx === null ? r.idx : Math.min(m.idx, r.idx);
      m.order.push(position);
      meta.set(r.step, m);
    });
  }

  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const ordered = [...meta.entries()]
    .sort(([, a], [, b]) => {
      if (a.idx !== null && b.idx !== null && a.idx !== b.idx) return a.idx - b.idx;
      if (a.idx !== null && b.idx === null) return -1;
      if (a.idx === null && b.idx !== null) return 1;
      return avg(a.order) - avg(b.order);
    })
    .map(([step]) => step);
  const position = new Map(ordered.map((step, i) => [step, i]));

  // Etapa mais funda de cada sessão.
  const deepest = new Map<string, number>();
  for (const [session, list] of bySession) {
    deepest.set(session, Math.max(...list.map((r) => position.get(r.step) ?? 0)));
  }
  const counts = ordered.map((_, i) => [...deepest.values()].filter((d) => d >= i).length);
  const started = counts[0] ?? 0;
  const pct = (part: number, whole: number) => (whole ? round1((part / whole) * 100) : null);

  const steps: QuizStep[] = ordered.map((step, i) => ({
    step,
    index: i,
    sessions: counts[i],
    ofStart: pct(counts[i], started) ?? 0,
    fromPrevious: i === 0 ? null : pct(counts[i], counts[i - 1]),
    advanced: i === ordered.length - 1 ? null : pct(counts[i + 1], counts[i]),
  }));

  const losing = steps.filter((s) => s.advanced !== null && s.sessions > 0);
  const worst = losing.length ? losing.reduce((a, b) => ((b.advanced ?? 100) < (a.advanced ?? 100) ? b : a)) : null;

  return {
    started,
    finished: counts[counts.length - 1] ?? 0,
    steps,
    worstStep: worst && (worst.advanced ?? 100) < 100 ? worst.step : null,
  };
}

// ---------------------------------------------------------------------------
// VSL da página
// ---------------------------------------------------------------------------

/** Domínios das LPs que gravam a retenção da VSL, por mercado. Vêm de `VSL_HOSTS`. */
export type VslHosts = Record<VslMarket, string[]>;
export const NO_VSL_HOSTS: VslHosts = { br: [], us: [] };

/** `VSL_HOSTS` em JSON, ex.: {"br":["lp.seudominio.com"],"us":[]}. Inválido ou ausente: nenhum. */
export function parseVslHosts(raw: string | undefined): VslHosts {
  if (!raw?.trim()) return NO_VSL_HOSTS;
  try {
    const value = JSON.parse(raw) as Partial<Record<VslMarket, unknown>>;
    const list = (hosts: unknown) => (Array.isArray(hosts) ? hosts.filter((h): h is string => typeof h === 'string').map((h) => h.trim().toLowerCase()) : []);
    return { br: list(value.br), us: list(value.us) };
  } catch {
    return NO_VSL_HOSTS;
  }
}

/** A VSL que a página tem, pelo domínio e caminho; null quando não tem. */
export function vslForUrl(url: string, hosts: VslHosts = NO_VSL_HOSTS): { market: VslMarket; version: VslVersion; video: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  for (const market of Object.keys(hosts) as VslMarket[]) {
    if (!hosts[market].includes(host)) continue;
    const version = versionOf(market, parsed.pathname);
    return version ? { market, version, video: VSL_MARKETS[market].video } : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tempo até a compra
// ---------------------------------------------------------------------------

/** Linha de hotjar_purchase_timing. */
export interface PurchaseTimingRow {
  kind: 'page' | 'other' | 'no_session';
  to_checkout: number | null;
  to_purchase: number | null;
  n: number;
}

export interface TimingBucket {
  label: string;
  /** Limite inferior, em segundos (inclusivo). */
  min: number;
  /** Limite superior, em segundos (exclusivo); null na última faixa. */
  max: number | null;
  purchases: number;
  /** % das compras medidas nesta faixa. */
  share: number;
  /** % das compras medidas até o fim desta faixa. */
  cumulative: number;
}

export interface TimingSummary {
  /** Compras com o tempo medido (entraram no gráfico). */
  measured: number;
  /** Tempo negativo ou acima de 24 h: fora do gráfico. */
  discarded: number;
  /** Sem o carregamento da página registrado (pageview e rolagem perdidos). */
  missing: number;
  median: number | null;
  average: number | null;
  p75: number | null;
  p90: number | null;
  buckets: TimingBucket[];
}

export interface PurchaseTiming {
  /** Compras com sessão que começaram o checkout nesta página. */
  purchases: number;
  /** Compras com sessão, nos filtros, que começaram o checkout em outra página (ou sem clique registrado). */
  otherPages: number;
  /** Vendas aprovadas no período sem sessão do rastreio (ficaram de fora). */
  noSession: number;
  /** Do primeiro carregamento da página até o clique no checkout. */
  checkout: TimingSummary;
  /** Do primeiro carregamento da página até a aprovação da venda. */
  purchase: TimingSummary;
}

/** Acima disso o tempo é tratado como absurdo (aba esquecida aberta, relógio errado). */
export const MAX_TIMING_SECONDS = 24 * 60 * 60;

export const TIMING_BUCKETS: { label: string; min: number }[] = [
  { label: '0–10 s', min: 0 },
  { label: '10–30 s', min: 10 },
  { label: '30–60 s', min: 30 },
  { label: '1–2 min', min: 60 },
  { label: '2–5 min', min: 120 },
  { label: '5–10 min', min: 300 },
  { label: '10–30 min', min: 600 },
  { label: '30 min–2 h', min: 1800 },
  { label: 'mais de 2 h', min: 7200 },
];

/** Percentil com interpolação linear (como o percentile_cont), em segundos inteiros. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
}

/** Faixas, acumulado e percentis de uma lista de tempos, descartando os absurdos. */
export function summarizeTiming(values: (number | null)[]): TimingSummary {
  const present = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const valid = present.filter((v) => v >= 0 && v <= MAX_TIMING_SECONDS);
  const total = valid.length;
  let running = 0;
  const buckets = TIMING_BUCKETS.map((b, i) => {
    const max = TIMING_BUCKETS[i + 1]?.min ?? null;
    const purchases = valid.filter((v) => v >= b.min && (max === null || v < max)).length;
    running += purchases;
    return {
      ...b,
      max,
      purchases,
      share: total ? round1((purchases / total) * 100) : 0,
      cumulative: total ? round1((running / total) * 100) : 0,
    };
  });
  return {
    measured: total,
    discarded: present.length - total,
    missing: values.length - present.length,
    median: percentile(valid, 0.5),
    average: total ? Math.round(valid.reduce((a, b) => a + b, 0) / total) : null,
    p75: percentile(valid, 0.75),
    p90: percentile(valid, 0.9),
    buckets,
  };
}

export function buildPurchaseTiming(rows: PurchaseTimingRow[]): PurchaseTiming {
  const page = rows.filter((r) => r.kind === 'page');
  const count = (kind: PurchaseTimingRow['kind']) =>
    rows.filter((r) => r.kind === kind).reduce((sum, r) => sum + (Number(r.n) || 0), 0);
  return {
    purchases: page.length,
    otherPages: count('other'),
    noSession: count('no_session'),
    checkout: summarizeTiming(page.map((r) => r.to_checkout)),
    purchase: summarizeTiming(page.map((r) => r.to_purchase)),
  };
}
