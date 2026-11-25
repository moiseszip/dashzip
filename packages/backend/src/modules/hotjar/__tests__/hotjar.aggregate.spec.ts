import {
  buildPurchaseTiming,
  buildQuizFunnel,
  buildRetention,
  median,
  percentile,
  PurchaseTimingRow,
  QuizRow,
  reachAt,
  RetentionRow,
  summarizeTiming,
  TIMING_BUCKETS,
  vslForUrl,
  parseVslHosts,
} from '../hotjar.aggregate';

const row = (depth: number, seconds: number | null = null, fold: number | null = 20): RetentionRow => ({
  depth_pct: depth,
  fold_pct: fold,
  seconds,
});

const HOSTS = parseVslHosts(JSON.stringify({ br: ['lp.exemplo.com', 'lp-exemplo.vercel.app'], us: ['us.exemplo.com', 'lp-us-exemplo.vercel.app'] }));

describe('retenção da página', () => {
  it('alcance, rolagem média, até o fim e primeira tela', () => {
    const r = buildRetention([row(100), row(100), row(55), row(15)]);
    expect(r.views).toBe(4);
    expect(r.reach[0]).toBe(100);
    expect(r.reach[4]).toBe(75); // 20%: três de quatro passaram
    expect(r.reach[20]).toBe(50);
    expect(r.avgDepth).toBe(67.5);
    expect(r.reachedEnd).toBe(50);
    expect(r.fold).toBe(20);
  });

  it('onde param de rolar: faixas de 10% somando 100%, com a maior queda depois da primeira tela', () => {
    const r = buildRetention([row(100), row(55), row(52), row(58), row(15), row(35)]);
    expect(r.dropoff).toHaveLength(10);
    expect(r.dropoff.find((b) => b.from === 50)!.share).toBe(50);
    expect(r.dropoff.find((b) => b.from === 90)!.share).toBeCloseTo(16.7);
    expect(Math.round(r.dropoff.reduce((s, b) => s + b.share, 0))).toBe(100);
    expect(r.biggestDrop).toEqual({ from: 50, to: 60, share: 50 });
  });

  it('quem não passou da primeira tela não conta como "maior queda", nem quem chegou ao fim', () => {
    const r = buildRetention([row(12, null, 25), row(14, null, 25), row(100, null, 25), row(100, null, 25)]);
    expect(r.biggestDrop).toBeNull();
  });

  it('alcance ao fim de cada tela (dobra), até 10 telas', () => {
    const r = buildRetention([row(100, null, 25), row(50, null, 25)]);
    expect(r.screens.map((s) => s.at)).toEqual([25, 50, 75, 100]);
    expect(r.screens.map((s) => s.reach)).toEqual([100, 100, 50, 50]);
    const tiny = buildRetention([row(100, null, 5)]);
    expect(tiny.screens).toHaveLength(10);
  });

  it('tempo na página: mediana, média e faixas, só com as visitas medidas', () => {
    const r = buildRetention([row(50, 5), row(50, 20), row(50, 45), row(50, 200), row(50, null)]);
    expect(r.time.measured).toBe(4);
    expect(r.time.median).toBe(33);
    expect(r.time.average).toBe(68);
    expect(r.time.buckets.map((b) => b.visits)).toEqual([1, 1, 1, 0, 1, 0]);
    expect(r.time.buckets[0].share).toBe(25);
  });

  it('sem dados não quebra', () => {
    const r = buildRetention([]);
    expect(r).toMatchObject({ views: 0, avgDepth: null, reachedEnd: null, fold: null, biggestDrop: null, screens: [] });
    expect(r.time).toMatchObject({ measured: 0, median: null, average: null });
  });

  it('mediana e interpolação do alcance', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(median([])).toBeNull();
    expect(reachAt([100, 80, 60], 2.5)).toBe(90);
    expect(reachAt([100, 80, 60], 50)).toBe(60);
  });
});

const q = (session: string, step: string, idx: number | null, at: number): QuizRow => ({
  session_id: session,
  step,
  idx,
  first_at: new Date(Date.UTC(2026, 10, 23, 12, 0, at)).toISOString(),
});

describe('funil do quiz', () => {
  it('conta quem chegou em cada etapa e quantos avançaram, na ordem do index', () => {
    const f = buildQuizFunnel([
      q('a', 'capa', 0, 0), q('a', 'momento', 1, 1), q('a', 'tempo', 2, 2), q('a', 'oferta', 3, 3),
      q('b', 'capa', 0, 0), q('b', 'momento', 1, 1),
      q('c', 'capa', 0, 0), q('c', 'momento', 1, 1), q('c', 'tempo', 2, 2),
      q('d', 'capa', 0, 0),
    ])!;
    expect(f.steps.map((s) => [s.step, s.sessions])).toEqual([['capa', 4], ['momento', 3], ['tempo', 2], ['oferta', 1]]);
    expect(f.started).toBe(4);
    expect(f.finished).toBe(1);
    expect(f.steps[1]).toMatchObject({ ofStart: 75, fromPrevious: 75, advanced: 66.7 });
    expect(f.steps[3].advanced).toBeNull();
    expect(f.worstStep).toBe('tempo');
  });

  it('quem caiu direto numa etapa adiante (recarregou) conta nas anteriores', () => {
    const f = buildQuizFunnel([q('a', 'capa', 0, 0), q('a', 'momento', 1, 1), q('b', 'momento', 1, 0)])!;
    expect(f.steps.map((s) => s.sessions)).toEqual([2, 2]);
  });

  it('sem index, ordena pela ordem em que as sessões viram as etapas', () => {
    const f = buildQuizFunnel([
      q('a', 'p1', null, 0), q('a', 'p2', null, 1), q('a', 'p3', null, 2),
      q('b', 'p1', null, 0), q('b', 'p2', null, 5),
    ])!;
    expect(f.steps.map((s) => s.step)).toEqual(['p1', 'p2', 'p3']);
  });

  it('voltar e repetir uma etapa não conta duas vezes a mesma sessão', () => {
    const f = buildQuizFunnel([q('a', 'capa', 0, 0), q('a', 'momento', 1, 1), q('a', 'capa', 0, 2)])!;
    expect(f.steps[0].sessions).toBe(1);
  });

  it('sem eventos de quiz, não há funil', () => {
    expect(buildQuizFunnel([])).toBeNull();
  });
});

describe('VSL da página', () => {
  it('acha mercado e versão pelo domínio e caminho da LP', () => {
    expect(vslForUrl('https://lp.exemplo.com/', HOSTS)).toMatchObject({ market: 'br', version: 'a', video: 'mini-vsl-v1' });
    expect(vslForUrl('https://lp-exemplo.vercel.app/b', HOSTS)).toMatchObject({ market: 'br', version: 'b' });
    expect(vslForUrl('https://lp.exemplo.com/quiz/', HOSTS)).toMatchObject({ version: 'quiz' });
    expect(vslForUrl('https://lp-us-exemplo.vercel.app/', HOSTS)).toMatchObject({ market: 'us', version: 'a' });
  });

  it('outras páginas e domínios não têm VSL', () => {
    expect(vslForUrl('https://outra.exemplo.com/', HOSTS)).toBeNull();
    expect(vslForUrl('https://lp.exemplo.com/obrigado', HOSTS)).toBeNull();
    expect(vslForUrl('https://lp-us-exemplo.vercel.app/b', HOSTS)).toBeNull();
    expect(vslForUrl('lixo', HOSTS)).toBeNull();
    expect(vslForUrl('https://lp.exemplo.com/')).toBeNull();
    expect(parseVslHosts('nao-json')).toEqual({ br: [], us: [] });
  });
});

const sale = (to_checkout: number | null, to_purchase: number | null): PurchaseTimingRow => ({ kind: 'page', to_checkout, to_purchase, n: 1 });

describe('tempo até a compra', () => {
  it('faixas de 0–10 s a mais de 2 h, com % e contagem', () => {
    const t = summarizeTiming([0, 9, 10, 29, 30, 59, 60, 119, 120, 299, 300, 599, 600, 1799, 1800, 7199, 7200, 86400]);
    expect(TIMING_BUCKETS.map((b) => b.label)).toEqual([
      '0–10 s', '10–30 s', '30–60 s', '1–2 min', '2–5 min', '5–10 min', '10–30 min', '30 min–2 h', 'mais de 2 h',
    ]);
    expect(t.buckets.map((b) => b.purchases)).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2]);
    expect(t.buckets[0]).toMatchObject({ min: 0, max: 10, share: 11.1 });
    expect(t.buckets[8]).toMatchObject({ min: 7200, max: null });
  });

  it('acumulado: "X% compraram em até" sai das contagens, fechando em 100%', () => {
    const t = summarizeTiming([2, 4, 6, 8, 9, 9, 9, 20, 45, 200]);
    expect(t.buckets.map((b) => b.cumulative)).toEqual([70, 80, 90, 90, 100, 100, 100, 100, 100]);
    expect(t.buckets[0].share).toBe(70);
  });

  it('mediana, média, P75 e P90 com interpolação', () => {
    const t = summarizeTiming([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(t).toMatchObject({ median: 55, average: 55, p75: 78, p90: 91 });
    expect(percentile([5], 0.9)).toBe(5);
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([1, 2, 3], 0.5)).toBe(2);
  });

  it('descarta negativos e mais de 24 h, e conta quem não tem o carregamento', () => {
    const t = summarizeTiming([-3, 86401, 100000, 50, null, 70]);
    expect(t).toMatchObject({ measured: 2, discarded: 3, missing: 1, median: 60 });
    expect(Math.max(...t.buckets.map((b) => b.cumulative))).toBe(100);
  });

  it('junta as linhas do banco: compras da página, de outras páginas e sem sessão', () => {
    const r = buildPurchaseTiming([
      sale(14, 135), sale(0, 158), sale(550, 673), sale(null, null), sale(-5, 120),
      { kind: 'other', to_checkout: null, to_purchase: null, n: 4 },
      { kind: 'no_session', to_checkout: null, to_purchase: null, n: 1 },
    ]);
    expect(r).toMatchObject({ purchases: 5, otherPages: 4, noSession: 1 });
    expect(r.checkout).toMatchObject({ measured: 3, discarded: 1, missing: 1, median: 14 });
    expect(r.purchase).toMatchObject({ measured: 4, discarded: 0, missing: 1, median: 147 });
  });

  it('sem compras não quebra', () => {
    const r = buildPurchaseTiming([{ kind: 'no_session', to_checkout: null, to_purchase: null, n: 2 }]);
    expect(r).toMatchObject({ purchases: 0, otherPages: 0, noSession: 2 });
    expect(r.checkout).toMatchObject({ measured: 0, median: null, average: null, p75: null, p90: null });
    expect(r.checkout.buckets.every((b) => b.share === 0 && b.cumulative === 0)).toBe(true);
  });
});
