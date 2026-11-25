/**
 * Retenção da mini VSL das LPs (docs/features/27-hotjar/vsl.md). Porta fiel do
 * `agregar` do painel de testes antigo (painel-testes/src/lib/vsl.ts).
 *
 * Cada linha da tabela de visitas da VSL (`VSL_SOURCE_TABLE`) é uma visita: nasce quando a LP abre e a rota
 * /api/vsl da LP sobrescreve o estado acumulado da sessão. `seg_som` são os
 * segundos realmente tocados com som (pular pela barra não conta). A retenção
 * conta só quem tocou para assistir; o autoplay mudo de fundo não entra.
 */

export interface VslRow {
  pagina: string;
  video: string;
  duracao: number | null;
  som: boolean;
  seg_som: number[] | null;
  cta: boolean;
  utm_content: string | null;
}

export interface VslGroup {
  duration: number;
  visits: number;
  plays: number;
  averageRetention: number | null;
  finish: number | null;
  checkout: { all: number | null; played: number | null; muted: number | null; half: number | null };
  curve: number[];
  milestones: { label: string; second: number; retention: number | null }[];
  creatives: { name: string; visits: number; plays: number; retention: number | null; checkout: number }[];
}

export type VslMarket = 'br' | 'us';
export type VslVersion = 'a' | 'b' | 'quiz';

/** VSLs no ar. Vídeo novo = linha aqui; página nova com a VSL = entra em `pages`. */
export const VSL_MARKETS: Record<VslMarket, { video: string; duration: number; pages: Partial<Record<VslVersion, string>> }> = {
  br: { video: 'mini-vsl-v1', duration: 78, pages: { a: '/', b: '/b', quiz: '/quiz' } },
  us: { video: 'mini-vsl-en', duration: 67, pages: { a: '/' } },
};

export const MAX_SECOND = 1800;
const ratio = (part: number, base: number) => (base ? part / base : null);

/** Página normalizada: sem barra final, raiz = "/". */
export const normalizePage = (page: string) => page.replace(/\/+$/, '') || '/';

export function versionOf(market: VslMarket, page: string): VslVersion | null {
  const path = normalizePage(page);
  const entry = Object.entries(VSL_MARKETS[market].pages).find(([, value]) => value === path);
  return entry ? (entry[0] as VslVersion) : null;
}

function mode(values: number[]): number {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = 0;
  let bestCount = 0;
  for (const [value, count] of counts) if (count > bestCount) [best, bestCount] = [value, count];
  return best;
}

export function aggregate(rows: VslRow[], defaultDuration: number): VslGroup {
  const duration = Math.max(2, mode(rows.map((row) => row.duracao ?? 0).filter((value) => value > 0)) || defaultDuration);
  const seconds = (row: VslRow) =>
    [...new Set((row.seg_som ?? []).filter((s) => Number.isInteger(s) && s >= 0 && s < duration))];

  const played = rows.filter((row) => row.som);
  const audience = new Array<number>(duration).fill(0);
  for (const row of played) for (const s of seconds(row)) audience[s]++;
  const curve = audience.map((count) => (played.length ? count / played.length : 0));

  const watched = (row: VslRow) => seconds(row).length / duration;
  const half = played.filter((row) => watched(row) >= 0.5);
  const muted = rows.filter((row) => !row.som);
  const last = Math.max(0, duration - 2);
  const finished = played.filter((row) => (row.seg_som ?? []).some((s) => s >= last && s <= MAX_SECOND));
  const sumWatched = (list: VslRow[]) => list.reduce((total, row) => total + watched(row), 0);

  const points: [string, number][] = [
    ['3 s', 3],
    ['10 s', 10],
    ['25%', Math.round(duration * 0.25)],
    ['50%', Math.round(duration * 0.5)],
    ['75%', Math.round(duration * 0.75)],
    ['Fim', last],
  ];
  const milestones = points
    .filter(([, second]) => second < duration)
    .map(([label, second]) => ({ label, second, retention: played.length ? curve[second] : null }));

  const byCreative = new Map<string, VslRow[]>();
  for (const row of rows) {
    const name = (row.utm_content || '(sem utm_content)').split('|')[0].trim() || '(sem utm_content)';
    const list = byCreative.get(name);
    if (list) list.push(row);
    else byCreative.set(name, [row]);
  }
  const creatives = [...byCreative.entries()]
    .map(([name, list]) => {
      const withSound = list.filter((row) => row.som);
      return {
        name,
        visits: list.length,
        plays: withSound.length / list.length,
        retention: withSound.length ? sumWatched(withSound) / withSound.length : null,
        checkout: list.filter((row) => row.cta).length / list.length,
      };
    })
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 10);

  return {
    duration,
    visits: rows.length,
    plays: played.length,
    averageRetention: played.length ? sumWatched(played) / played.length : null,
    finish: ratio(finished.length, played.length),
    checkout: {
      all: ratio(rows.filter((row) => row.cta).length, rows.length),
      played: ratio(played.filter((row) => row.cta).length, played.length),
      muted: ratio(muted.filter((row) => row.cta).length, muted.length),
      half: ratio(half.filter((row) => row.cta).length, half.length),
    },
    curve,
    milestones,
    creatives,
  };
}

/** Agrupa as linhas por versão da LP e calcula o somado das versões marcadas (2+). */
export function buildReport(rows: VslRow[], market: VslMarket, requested: VslVersion[]) {
  const config = VSL_MARKETS[market];
  const available = Object.keys(config.pages) as VslVersion[];
  const chosen = available.filter((id) => requested.includes(id));
  const selected = chosen.length ? chosen : available;

  const byVersion = new Map<VslVersion, VslRow[]>(available.map((id) => [id, []]));
  for (const row of rows) {
    if (row.video !== config.video) continue;
    const version = versionOf(market, row.pagina);
    if (version) byVersion.get(version)!.push(row);
  }

  const versions = Object.fromEntries(
    available.map((id) => [id, aggregate(byVersion.get(id)!, config.duration)]),
  ) as Partial<Record<VslVersion, VslGroup>>;
  const total = selected.length > 1
    ? aggregate(selected.flatMap((id) => byVersion.get(id)!), config.duration)
    : null;

  return { market, selected, versions, total };
}
