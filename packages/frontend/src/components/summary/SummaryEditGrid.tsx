import type { ReactNode } from 'react';
import GridLayout, { useContainerWidth, type Layout, type LayoutItem as GridItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import '@/components/summary/summary-grid.css';
import type { LayoutItem } from '@/lib/summary';
import { GRID_COLS, GRID_GAP, ROW_HEIGHT } from '@/lib/summaryLayout';

/**
 * Grade do modo Personalizar (react-grid-layout + arraste e redimensionamento).
 * Fica num chunk à parte: só baixa quando alguém abre o Personalizar no desktop.
 */

function pointer(event: Event) {
  if ('changedTouches' in event) {
    const touch = (event as TouchEvent).changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }
  const mouse = event as MouseEvent;
  return typeof mouse.clientX === 'number' ? { x: mouse.clientX, y: mouse.clientY } : null;
}

/** A seção sob o ponteiro (cada seção marca o contêiner com data-section-drop). */
export function sectionAt(x: number, y: number) {
  for (const el of document.querySelectorAll<HTMLElement>('[data-section-drop]')) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el;
  }
  return null;
}

const toGrid = (items: LayoutItem[]): GridItem[] => items.map(({ key, x, y, w, h }) => ({ i: key, x, y, w, h, minW: 1, minH: 1, maxH: 30 }));

export default function EditGrid({ sectionKey, items, render, onChange, onDropElsewhere, onHoverSection }: {
  sectionKey: string;
  items: LayoutItem[];
  render: (item: LayoutItem) => ReactNode;
  onChange: (items: LayoutItem[]) => void;
  /** Card solto sobre outra seção: posição na grade dela. */
  onDropElsewhere: (key: string, target: string, at: { x: number; y: number }) => void;
  onHoverSection: (key: string | null) => void;
}) {
  const { width, containerRef, mounted } = useContainerWidth();
  const keys = new Set(items.map((i) => i.key));

  const onLayoutChange = (layout: Layout) => {
    const next = layout.filter((l) => keys.has(l.i)).map(({ i, x, y, w, h }) => ({ key: i, x, y, w, h }));
    const same = next.length === items.length && next.every((n) => {
      const cur = items.find((i) => i.key === n.key);
      return cur && cur.x === n.x && cur.y === n.y && cur.w === n.w && cur.h === n.h;
    });
    if (!same) onChange(next);
  };

  const otherSectionAt = (event: Event) => {
    const p = pointer(event);
    if (!p) return null;
    const el = sectionAt(p.x, p.y);
    return el && el.dataset.sectionDrop !== sectionKey ? el : null;
  };

  return (
    <div ref={containerRef} className="min-h-[3rem]" data-section-grid>
      {mounted && width > 0 && (
        <GridLayout
          width={width}
          layout={toGrid(items)}
          gridConfig={{ cols: GRID_COLS, rowHeight: ROW_HEIGHT, margin: [GRID_GAP, GRID_GAP], containerPadding: [0, 0] }}
          dragConfig={{ enabled: true, cancel: '.grid-no-drag', threshold: 4 }}
          resizeConfig={{
            enabled: true,
            handles: ['se'],
            handleComponent: (axis, ref) => (
              <span
                ref={ref as React.Ref<HTMLSpanElement>}
                className={`react-resizable-handle react-resizable-handle-${axis} summary-resize-handle`}
                aria-hidden="true"
                title="Arraste para redimensionar"
              >
                <svg viewBox="0 0 12 12" className="h-3 w-3"><path d="M11 4v7H4M11 8v3H8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
              </span>
            ),
          }}
          onLayoutChange={onLayoutChange}
          onDrag={(_l, _o, _n, _p, event) => onHoverSection(otherSectionAt(event)?.dataset.sectionDrop ?? null)}
          onDragStop={(_l, oldItem, _n, _p, event, element) => {
            onHoverSection(null);
            const target = otherSectionAt(event);
            if (!target || !oldItem) return;
            const grid = target.querySelector<HTMLElement>('[data-section-grid]') ?? target;
            const g = grid.getBoundingClientRect();
            const box = element?.getBoundingClientRect();
            const colWidth = (g.width - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;
            const at = box
              ? { x: Math.round((box.left - g.left) / (colWidth + GRID_GAP)), y: Math.max(Math.round((box.top - g.top) / (ROW_HEIGHT + GRID_GAP)), 0) }
              : { x: 0, y: Number.MAX_SAFE_INTEGER };
            onDropElsewhere(oldItem.i, target.dataset.sectionDrop!, at);
          }}
        >
          {items.map((item) => <div key={item.key}>{render(item)}</div>)}
        </GridLayout>
      )}
    </div>
  );
}

