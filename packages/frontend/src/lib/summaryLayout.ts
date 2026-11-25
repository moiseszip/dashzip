import { moveElement, verticalCompactor, type Layout as GridLayout } from 'react-grid-layout/core';
import type { LayoutItem, LayoutSection, LegacySize, SummaryLayout, SummaryLayoutV1 } from '@/lib/summary';

/**
 * Grade do Resultado (docs/features/24-summary/summary.md): 12 colunas por seção,
 * linhas de altura fixa. Arrastar e redimensionar encaixam nos passos da grade;
 * no celular (até 640px) os cards empilham em largura total, na ordem de leitura.
 */
export const GRID_COLS = 12;
export const ROW_HEIGHT = 44;
export const GRID_GAP = 12;
export const MOBILE_MAX = 640;
export const MAX_ITEM_ROWS = 30;

/** No celular, card de número (até 4 das 12 colunas e até 3 linhas) divide a linha com outro; gráfico não. */
export const isHalfOnMobile = (item: { w: number; h: number }) => item.w <= 4 && item.h <= 3;

const BIG_CHARTS = new Set(['byCountry', 'byState']);

/** Tamanho padrão de um item novo. */
export function defaultSize(key: string, isChart: boolean): { w: number; h: number } {
  if (!isChart) return { w: 2, h: 2 };
  if (key === 'hourly' || key === 'daily') return { w: 12, h: 7 };
  return { w: 6, h: BIG_CHARTS.has(key) ? 9 : 7 };
}

/** Tamanho equivalente ao antigo pequeno/médio/largura toda (o v1 usava 6 colunas no desktop). */
export function sizeFromLegacy(key: string, size: LegacySize, isChart: boolean): { w: number; h: number } {
  if (isChart) return { w: size === 'lg' ? 12 : size === 'md' ? 6 : 4, h: BIG_CHARTS.has(key) ? 9 : 7 };
  return { w: size === 'lg' ? 12 : size === 'md' ? 4 : 2, h: 2 };
}

/** Itens em fila, da esquerda para a direita, quebrando a linha quando não cabem. */
export function flowItems(items: { key: string; w: number; h: number }[]): LayoutItem[] {
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  return items.map(({ key, w, h }) => {
    const width = Math.min(Math.max(w, 1), GRID_COLS);
    if (x + width > GRID_COLS) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    const item = { key, x, y, w: width, h };
    x += width;
    rowHeight = Math.max(rowHeight, h);
    return item;
  });
}

/** v1 (ordem por seção + tamanho) → v2 (posição e tamanho na grade), igual ao backend. */
export function migrateLayout(layout: SummaryLayoutV1, isChart: (key: string) => boolean): SummaryLayout {
  return {
    version: 2,
    sections: layout.sections.map((section) => ({
      key: section.key,
      title: section.title,
      collapsed: section.collapsed,
      items: flowItems(section.items.map((item) => ({ key: item.key, ...sizeFromLegacy(item.key, item.size, isChart(item.key)) }))),
    })),
  };
}

/** Qualquer layout recebido (API ou arquivo importado) no formato v2. */
export function normalizeLayout(layout: SummaryLayout | SummaryLayoutV1, isChart: (key: string) => boolean): SummaryLayout {
  return layout.version === 1 ? migrateLayout(layout, isChart) : layout;
}

/** Ordem de leitura (linha, depois coluna): a ordem do celular e do teclado. */
export function readingOrder(items: LayoutItem[]) {
  return [...items].sort((a, b) => a.y - b.y || a.x - b.x);
}

const toGrid = (items: LayoutItem[]): GridLayout => items.map(({ key, x, y, w, h }) => ({ i: key, x, y, w, h }));
const fromGrid = (layout: GridLayout): LayoutItem[] => layout.map(({ i, x, y, w, h }) => ({ key: i, x, y, w, h }));

/** Compacta para cima e resolve sobreposição, como a grade faz depois de arrastar. */
export function compactItems(items: LayoutItem[]): LayoutItem[] {
  return fromGrid(verticalCompactor.compact(toGrid(items), GRID_COLS));
}

/** Põe um item novo no fim da seção, em largura padrão. */
export function appendItem(items: LayoutItem[], key: string, size: { w: number; h: number }): LayoutItem[] {
  const bottom = items.reduce((max, item) => Math.max(max, item.y + item.h), 0);
  return compactItems([...items, { key, x: 0, y: bottom, w: Math.min(size.w, GRID_COLS), h: size.h }]);
}

/**
 * Teclado no modo Personalizar: setas movem o card focado, Shift + setas mudam o
 * tamanho. Para cima/baixo, o card vai para a linha do vizinho de cima/baixo.
 */
export function nudgeItem(items: LayoutItem[], key: string, dx: number, dy: number): LayoutItem[] {
  const grid = toGrid(items);
  const item = grid.find((i) => i.i === key);
  if (!item) return items;
  const overlapsColumns = (other: LayoutItem) => other.x < item.x + item.w && item.x < other.x + other.w;
  let x = item.x;
  let y = item.y;
  if (dx) x = Math.min(Math.max(item.x + dx, 0), GRID_COLS - item.w);
  if (dy < 0) {
    const above = items.filter((o) => o.key !== key && o.y + o.h <= item.y && overlapsColumns(o));
    if (!above.length) return items;
    y = Math.max(...above.map((o) => o.y));
  } else if (dy > 0) {
    const below = items.filter((o) => o.key !== key && o.y >= item.y + item.h && overlapsColumns(o));
    if (!below.length) return items;
    const next = below.reduce((a, b) => (b.y < a.y ? b : a));
    // Abaixo do vizinho: a compactação sobe o vizinho para o lugar do card.
    y = next.y + next.h;
  }
  if (x === item.x && y === item.y) return items;
  const moved = moveElement(grid, item, x, y, true, false, 'vertical', GRID_COLS);
  return fromGrid(verticalCompactor.compact(moved, GRID_COLS));
}

export function resizeItem(items: LayoutItem[], key: string, dw: number, dh: number): LayoutItem[] {
  const next = items.map((item) => item.key !== key ? item : {
    ...item,
    w: Math.min(Math.max(item.w + dw, 1), GRID_COLS - item.x),
    h: Math.min(Math.max(item.h + dh, 1), MAX_ITEM_ROWS),
  });
  return compactItems(next);
}

/** Move um item para outra seção; sem posição, entra no fim dela. */
export function moveToSection(layout: SummaryLayout, key: string, target: string, at?: { x: number; y: number }): SummaryLayout {
  const from = layout.sections.find((s) => s.items.some((i) => i.key === key));
  const item = from?.items.find((i) => i.key === key);
  if (!from || !item || from.key === target || !layout.sections.some((s) => s.key === target)) return layout;
  return {
    ...layout,
    sections: layout.sections.map((section): LayoutSection => {
      if (section.key === from.key) return { ...section, items: compactItems(section.items.filter((i) => i.key !== key)) };
      if (section.key !== target) return section;
      if (!at) return { ...section, items: appendItem(section.items, key, item) };
      const x = Math.min(Math.max(at.x, 0), GRID_COLS - item.w);
      // Entra pelo fim da seção e sobe até onde foi solto, empurrando quem estiver ali (como na grade).
      const bottom = section.items.reduce((max, i) => Math.max(max, i.y + i.h), 0);
      const grid = toGrid([...section.items, { ...item, x, y: bottom }]);
      const moved = moveElement(grid, grid[grid.length - 1], x, Math.min(Math.max(at.y, 0), bottom), true, false, 'vertical', GRID_COLS);
      return { ...section, items: fromGrid(verticalCompactor.compact(moved, GRID_COLS)) };
    }),
  };
}

/** O layout que vai para a API: só key, x, y, w, h. */
export function cleanLayout(layout: SummaryLayout): SummaryLayout {
  return {
    version: 2,
    sections: layout.sections.map((s) => ({
      key: s.key,
      title: s.title,
      collapsed: s.collapsed,
      items: s.items.map(({ key, x, y, w, h }) => ({ key, x, y, w, h })),
    })),
  };
}

export function newSectionKey(layout: SummaryLayout) {
  const keys = new Set(layout.sections.map((s) => s.key));
  let n = layout.sections.length + 1;
  while (keys.has(`secao-${n}`)) n += 1;
  return `secao-${n}`;
}
