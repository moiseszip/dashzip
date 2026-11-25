import { buildPageDetail, ClickRow, deviceForWidth, filterValue, parseHeatmap, scrollReach, topElements, validDayRange } from '../heatmap';
import { HEATMAP_SCRIPT } from '../heatmap-script';
import { parseCollectBody } from '../collect-payload';

const hm = (over: Record<string, unknown> = {}) => ({
  u: 'https://www.loja.com.br/oferta?sck=stl_x&utm_source=fb#topo',
  p: 'a1b2c3d4',
  vw: 390,
  vh: 800,
  dw: 390,
  dh: 4000,
  sd: 2000,
  c: [['#comprar', 0.5, 0.25, 195, 1210, '  Quero   comprar ']],
  ...over,
});

describe('parseHeatmap', () => {
  it('limpa a URL, acha o dispositivo pela largura e calcula rolagem e primeira tela', () => {
    const h = parseHeatmap(hm())!;
    expect(h.url).toBe('https://www.loja.com.br/oferta');
    expect(h.device).toBe('mobile');
    expect(h.depthPct).toBe(50);
    expect(h.foldPct).toBe(20);
    expect(h.clicks).toEqual([{ selector: '#comprar', rx: 0.5, ry: 0.25, px: 195, py: 1210, label: 'Quero comprar' }]);
  });

  it('largura de 768 ou mais é computador', () => {
    expect(deviceForWidth(767)).toBe('mobile');
    expect(deviceForWidth(768)).toBe('desktop');
  });

  it('descarta o lote sem página, sem tamanho ou com page_id fora do formato', () => {
    expect(parseHeatmap(null)).toBeNull();
    expect(parseHeatmap(hm({ u: 'javascript:alert(1)' }))).toBeNull();
    expect(parseHeatmap(hm({ dh: 0 }))).toBeNull();
    expect(parseHeatmap(hm({ p: 'xyz' }))).toBeNull();
  });

  it('descarta só o clique malformado e limita a 50 por lote', () => {
    const many = Array.from({ length: 80 }, () => ['div', 0.1, 0.1, 10, 10, null]);
    expect(parseHeatmap(hm({ c: [...many, 'lixo', ['x', 0, 0, 'a', 1]] }))!.clicks).toHaveLength(50);
    expect(parseHeatmap(hm({ c: ['lixo', ['x', 0, 0, 'a', 1]] }))!.clicks).toHaveLength(0);
  });

  it('clique sem posição dentro do elemento fica só com os pixels', () => {
    const [c] = parseHeatmap(hm({ c: [['div', null, null, 10, 20, null]] }))!.clicks;
    expect(c).toMatchObject({ rx: null, ry: null, px: 10, py: 20 });
  });

  it('rolagem passando do fim da página fica em 100%', () => {
    expect(parseHeatmap(hm({ sd: 9999 }))!.depthPct).toBe(100);
  });

  it('chega pelo lote do /collect', () => {
    const batch = parseCollectBody({
      tid: '11111111-2222-4333-8444-555555555555',
      vid: '11111111-2222-4333-8444-555555555556',
      sid: '11111111-2222-4333-8444-555555555557',
      events: [{ type: 'page_exit', url: 'https://www.loja.com.br/oferta', duration_seconds: 3 }],
      hm: hm(),
    })!;
    expect(batch.heatmap?.clicks).toHaveLength(1);
  });
});

describe('agregação', () => {
  const click = (selector: string | null, label: string | null = null): ClickRow => ({
    selector, rx: 0.5, ry: 0.5, px: 1, py: 1, doc_w: 390, label,
  });

  it('alcance da rolagem a cada 5%', () => {
    const reach = scrollReach([{ depth_pct: 100, fold_pct: 20 }, { depth_pct: 50, fold_pct: 20 }]);
    expect(reach).toHaveLength(21);
    expect(reach[0]).toBe(100);
    expect(reach[10]).toBe(100);
    expect(reach[11]).toBe(50);
    expect(reach[20]).toBe(50);
  });

  it('elementos mais clicados, com o rótulo mais comum', () => {
    const top = topElements([click('#a', 'Comprar'), click('#a', 'Comprar'), click('#a', 'Outro'), click('#b')]);
    expect(top[0]).toEqual({ selector: '#a', label: 'Comprar', clicks: 3, share: 75 });
    expect(top[1]).toMatchObject({ selector: '#b', clicks: 1, share: 25 });
  });

  it('resumo da página', () => {
    const d = buildPageDetail([click('#a')], [{ depth_pct: 80, fold_pct: 20 }, { depth_pct: 40, fold_pct: 30 }]);
    expect(d).toMatchObject({ views: 2, clicks: 1, avgDepth: 60, fold: 25 });
  });

  it('sem dados não quebra', () => {
    expect(buildPageDetail([], [])).toMatchObject({ views: 0, clicks: 0, avgDepth: null, fold: null, topElements: [] });
  });
});

describe('heatmap.js', () => {
  it('é JavaScript válido', () => {
    expect(() => new Function(HEATMAP_SCRIPT)).not.toThrow();
  });

  it('no iframe da aba Hotjar lê período e filtros e troca o modo por postMessage', () => {
    expect(HEATMAP_SCRIPT).toContain("param('stl_hm_embed')");
    expect(HEATMAP_SCRIPT).toContain("'&since=' + since");
    expect(HEATMAP_SCRIPT).toContain('stlHm');
  });
});

describe('tempo na página (ts)', () => {
  it('vem em segundos inteiros, limitado a um dia; tracker antigo fica sem', () => {
    expect(parseHeatmap(hm({ ts: 42.4 }))!.seconds).toBe(42);
    expect(parseHeatmap(hm({ ts: -5 }))!.seconds).toBe(0);
    expect(parseHeatmap(hm({ ts: 999999 }))!.seconds).toBe(86400);
    expect(parseHeatmap(hm({ ts: 'x' }))!.seconds).toBeNull();
    expect(parseHeatmap(hm())!.seconds).toBeNull();
  });
});

describe('período e filtros da aba Hotjar', () => {
  it('aceita dias válidos em ordem e até 92 dias', () => {
    expect(validDayRange('2026-11-01', '2026-11-23')).toEqual({ since: '2026-11-01', until: '2026-11-23' });
    expect(validDayRange('2026-11-23', '2026-11-23')).not.toBeNull();
    expect(validDayRange('2026-11-23', '2026-11-01')).toBeNull();
    expect(validDayRange('2026-02-31', '2026-03-01')).toBeNull();
    expect(validDayRange('2026-01-01', '2026-12-31')).toBeNull();
    expect(validDayRange('ontem', '2026-11-01')).toBeNull();
    expect(validDayRange(undefined, '2026-11-01')).toBeNull();
  });

  it('filtro vazio é "todos"', () => {
    expect(filterValue('  facebook ')).toBe('facebook');
    expect(filterValue('')).toBeNull();
    expect(filterValue(undefined)).toBeNull();
  });
});
