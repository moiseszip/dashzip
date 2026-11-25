import { Suspense, lazy, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, EyeOff, FolderInput, GripVertical, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { LayoutItem } from '@/lib/summary';
import { GRID_COLS, GRID_GAP, isHalfOnMobile, MOBILE_MAX, readingOrder, ROW_HEIGHT } from '@/lib/summaryLayout';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';

/**
 * Grade das seções do Resultado. Fora do modo Personalizar é uma CSS grid fixa
 * (12 colunas, linhas de 44px); no celular vira 2 colunas (números lado a lado,
 * gráficos em largura total). No modo
 * Personalizar usa o react-grid-layout: arrasta o card, redimensiona pela alça do
 * canto inferior direito e solta em outra seção.
 */

export function useIsMobile() {
  return useMediaQuery(`(max-width: ${MOBILE_MAX}px)`);
}

/**
 * Grade fixa: posição e tamanho salvos no desktop; no celular, ordem de leitura
 * em 2 colunas (cards pequenos lado a lado, gráficos em largura total).
 */
export function StaticGrid({ items, mobile, render }: {
  items: LayoutItem[];
  mobile: boolean;
  render: (item: LayoutItem) => ReactNode;
}) {
  const ordered = mobile ? readingOrder(items) : items;
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: mobile ? 'repeat(2, minmax(0, 1fr))' : `repeat(${GRID_COLS}, minmax(0, 1fr))`,
        gridAutoFlow: mobile ? 'row dense' : undefined,
        gridAutoRows: `${ROW_HEIGHT}px`,
        gap: `${GRID_GAP}px`,
      }}
    >
      {ordered.map((item) => {
        const style: CSSProperties = mobile
          ? { gridColumn: isHalfOnMobile(item) ? 'span 1' : '1 / -1', gridRow: `span ${item.h}` }
          : { gridColumn: `${item.x + 1} / span ${item.w}`, gridRow: `${item.y + 1} / span ${item.h}` };
        return <div key={item.key} className="min-w-0" style={style}>{render(item)}</div>;
      })}
    </div>
  );
}

type EditGridProps = Parameters<typeof import('@/components/summary/SummaryEditGrid').default>[0];
const LazyEditGrid = lazy(() => import('@/components/summary/SummaryEditGrid'));

/** Grade do Personalizar, carregada sob demanda (react-grid-layout fica fora do chunk do Resultado). */
export function EditGrid(props: EditGridProps) {
  return (
    <Suspense fallback={<StaticGrid items={props.items} mobile={false} render={props.render} />}>
      <LazyEditGrid {...props} />
    </Suspense>
  );
}

/**
 * Moldura do card no modo Personalizar: o card inteiro arrasta; o menu (fora do
 * arraste) move para cima/baixo ou para outra seção e remove. Com foco, as setas
 * movem o card e Shift + setas mudam o tamanho.
 */
export function EditFrame({ label, children, sections, onNudge, onResize, onMoveTo, onHide, draggable }: {
  label: string;
  children: ReactNode;
  sections: { key: string; title: string }[];
  onNudge: (dx: number, dy: number) => void;
  onResize: (dw: number, dh: number) => void;
  onMoveTo: (section: string) => void;
  onHide: () => void;
  draggable: boolean;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = delta[event.key];
    if (d) {
      event.preventDefault();
      if (event.shiftKey) onResize(d[0], d[1]);
      else onNudge(d[0], d[1]);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onHide();
    }
  };
  return (
    <div
      tabIndex={0}
      role="group"
      aria-label={`${label}. Setas movem, Shift + setas mudam o tamanho, Delete remove.`}
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight Delete"
      onKeyDown={onKeyDown}
      className={cn(
        'group relative h-full rounded-xl ring-1 ring-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        draggable && 'cursor-grab active:cursor-grabbing',
      )}
    >
      <div className="pointer-events-none h-full select-none opacity-80">{children}</div>
      {draggable && <GripVertical className="pointer-events-none absolute left-1.5 top-1.5 h-4 w-4 text-muted-foreground" aria-hidden />}
      <div className="grid-no-drag absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-md border border-border bg-background/95 p-0.5 shadow-sm transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="h-6 w-6" aria-label={`Mover ${label}`}><MoreHorizontal className="h-3.5 w-3.5" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
            <DropdownMenuItem onSelect={() => onNudge(0, -1)}><ArrowUp className="mr-2 h-3.5 w-3.5" /> Mover para cima</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onNudge(0, 1)}><ArrowDown className="mr-2 h-3.5 w-3.5" /> Mover para baixo</DropdownMenuItem>
            {sections.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground">Mover para seção…</DropdownMenuLabel>
                {sections.map((s) => (
                  <DropdownMenuItem key={s.key} onSelect={() => onMoveTo(s.key)}>
                    <FolderInput className="mr-2 h-3.5 w-3.5" /> <span className="truncate">{s.title || 'Seção sem título'}</span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="icon" variant="ghost" className="h-6 w-6" aria-label={`Remover ${label}`} onClick={onHide}><EyeOff className="h-3 w-3" /></Button>
      </div>
    </div>
  );
}
