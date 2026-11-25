import { describe, expect, it } from 'vitest';
import type { LayoutItem, SummaryLayout, SummaryLayoutV1 } from '@/lib/summary';
import {
  appendItem, cleanLayout, defaultSize, isHalfOnMobile, migrateLayout, moveToSection, normalizeLayout, nudgeItem, readingOrder, resizeItem,
} from '@/lib/summaryLayout';

const CHARTS = new Set(['hourly', 'daily', 'byProduct', 'byHour', 'funnelMeta', 'byCountry']);
const isChart = (key: string) => CHARTS.has(key);

const legacy: SummaryLayoutV1 = {
  version: 1,
  sections: [
    { key: 'general', title: 'Geral', collapsed: false, items: [
      { key: 'grossRevenue', size: 'sm' }, { key: 'profit', size: 'md' }, { key: 'roi', size: 'sm' },
      { key: 'roas', size: 'sm' }, { key: 'margin', size: 'sm' }, { key: 'sales', size: 'lg' }, { key: 'cpa', size: 'sm' },
    ] },
    { key: 'charts', title: 'Gráficos', collapsed: true, items: [
      { key: 'hourly', size: 'lg' }, { key: 'byProduct', size: 'md' }, { key: 'byHour', size: 'md' }, { key: 'funnelMeta', size: 'sm' },
      { key: 'byCountry', size: 'md' },
    ] },
  ],
};

describe('migração do layout antigo', () => {
  it('converte pequeno/médio/largura toda em posições e tamanhos equivalentes, na mesma ordem', () => {
    const next = migrateLayout(legacy, isChart);
    expect(next.version).toBe(2);
    expect(next.sections.map((s) => [s.key, s.title, s.collapsed])).toEqual([['general', 'Geral', false], ['charts', 'Gráficos', true]]);
    expect(next.sections[0].items).toEqual([
      { key: 'grossRevenue', x: 0, y: 0, w: 2, h: 2 },
      { key: 'profit', x: 2, y: 0, w: 4, h: 2 },
      { key: 'roi', x: 6, y: 0, w: 2, h: 2 },
      { key: 'roas', x: 8, y: 0, w: 2, h: 2 },
      { key: 'margin', x: 10, y: 0, w: 2, h: 2 },
      { key: 'sales', x: 0, y: 2, w: 12, h: 2 },
      { key: 'cpa', x: 0, y: 4, w: 2, h: 2 },
    ]);
    expect(next.sections[1].items).toEqual([
      { key: 'hourly', x: 0, y: 0, w: 12, h: 7 },
      { key: 'byProduct', x: 0, y: 7, w: 6, h: 7 },
      { key: 'byHour', x: 6, y: 7, w: 6, h: 7 },
      { key: 'funnelMeta', x: 0, y: 14, w: 4, h: 7 },
      { key: 'byCountry', x: 4, y: 14, w: 6, h: 9 },
    ]);
    expect(readingOrder(next.sections[0].items).map((i) => i.key)).toEqual(legacy.sections[0].items.map((i) => i.key));
  });

  it('normalizeLayout deixa o v2 como está', () => {
    const v2 = migrateLayout(legacy, isChart);
    expect(normalizeLayout(v2, isChart)).toBe(v2);
    expect(normalizeLayout(legacy, isChart)).toEqual(v2);
  });
});

describe('edição na grade', () => {
  const row: LayoutItem[] = [
    { key: 'a', x: 0, y: 0, w: 2, h: 2 },
    { key: 'b', x: 2, y: 0, w: 2, h: 2 },
    { key: 'c', x: 0, y: 2, w: 4, h: 2 },
  ];
  const at = (items: LayoutItem[], key: string) => items.find((i) => i.key === key)!;

  it('setas laterais movem uma coluna, sem sair da grade', () => {
    expect(at(nudgeItem(row, 'c', 1, 0), 'c')).toMatchObject({ x: 1, y: 2 });
    expect(nudgeItem(row, 'a', -1, 0)).toBe(row);
  });

  it('seta para cima troca de linha com o vizinho de cima', () => {
    const next = nudgeItem(row, 'c', 0, -1);
    expect(at(next, 'c').y).toBe(0);
    expect(at(next, 'a').y).toBeGreaterThanOrEqual(2);
  });

  it('seta para baixo desce abaixo do vizinho de baixo', () => {
    const next = nudgeItem(row, 'a', 0, 1);
    expect(at(next, 'a').y).toBeGreaterThan(at(next, 'c').y);
    expect(readingOrder(next).map((i) => i.key)).toEqual(['b', 'c', 'a']);
  });

  it('Shift + setas mudam o tamanho dentro dos limites', () => {
    expect(at(resizeItem(row, 'a', 1, 1), 'a')).toMatchObject({ w: 3, h: 3 });
    expect(at(resizeItem(row, 'a', -5, -5), 'a')).toMatchObject({ w: 1, h: 1 });
    expect(at(resizeItem(row, 'b', 20, 0), 'b').w).toBe(10);
  });

  it('item novo entra no fim da seção', () => {
    expect(at(appendItem(row, 'hourly', { w: 12, h: 7 }), 'hourly')).toEqual({ key: 'hourly', x: 0, y: 4, w: 12, h: 7 });
  });

  it('move um card para outra seção, no fim ou na posição solta', () => {
    const layout: SummaryLayout = {
      version: 2,
      sections: [
        { key: 's1', title: 'Um', collapsed: false, items: row },
        { key: 's2', title: 'Dois', collapsed: false, items: [{ key: 'd', x: 0, y: 0, w: 6, h: 2 }] },
      ],
    };
    const end = moveToSection(layout, 'a', 's2');
    expect(end.sections[0].items.map((i) => i.key)).toEqual(['b', 'c']);
    expect(at(end.sections[0].items, 'b')).toMatchObject({ x: 2, y: 0 });
    expect(at(end.sections[1].items, 'a')).toMatchObject({ x: 0, y: 2, w: 2, h: 2 });

    const dropped = moveToSection(layout, 'a', 's2', { x: 0, y: 0 });
    expect(at(dropped.sections[1].items, 'a')).toMatchObject({ x: 0, y: 0 });
    expect(at(dropped.sections[1].items, 'd').y).toBe(2);
    expect(moveToSection(layout, 'a', 's1')).toBe(layout);
  });

  it('o layout salvo leva só key, x, y, w e h', () => {
    const dirty = { version: 2, sections: [{ key: 's', title: 'S', collapsed: false, items: [{ key: 'a', x: 0, y: 0, w: 2, h: 2, i: 'a', moved: false }] }] } as unknown as SummaryLayout;
    expect(cleanLayout(dirty).sections[0].items[0]).toEqual({ key: 'a', x: 0, y: 0, w: 2, h: 2 });
  });
});

describe('isHalfOnMobile', () => {
  it('cards de número dividem a linha no celular; gráficos ocupam a largura toda', () => {
    expect(isHalfOnMobile(defaultSize('grossRevenue', false))).toBe(true);
    expect(isHalfOnMobile({ w: 4, h: 2 })).toBe(true);
    expect(isHalfOnMobile(defaultSize('byProduct', true))).toBe(false);
    expect(isHalfOnMobile({ w: 4, h: 7 })).toBe(false);
    expect(isHalfOnMobile({ w: 6, h: 2 })).toBe(false);
  });
});
