import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  label: string;
  width: number;
  min: number;
  max: number;
  fallback: number;
  onPreview: (width: number) => void;
  onCommit: (width: number) => void;
}

/**
 * Alça na borda direita de um cabeçalho: arrastar muda a largura da coluna.
 * Teclado: setas mudam 16 px, Home volta ao padrão. Duplo clique também volta ao padrão.
 */
export function ColumnResizeHandle({ label, width, min, max, fallback, onPreview, onCommit }: Props) {
  const start = useRef<{ x: number; width: number; last: number } | null>(null);

  const down = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, width, last: width };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const next = start.current.width + event.clientX - start.current.x;
    start.current.last = next;
    onPreview(next);
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onCommit(start.current.last);
    start.current = null;
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16;
    if (event.key === 'ArrowLeft') onCommit(width - step);
    else if (event.key === 'ArrowRight') onCommit(width + step);
    else if (event.key === 'Home') onCommit(fallback);
    else return;
    event.preventDefault();
  };

  return (
    <div
      data-resize-handle=""
      draggable={false}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Arraste para ajustar a largura (duplo clique volta ao padrão)"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={() => onCommit(fallback)}
      onKeyDown={key}
      className={cn(
        'group absolute inset-y-0 -right-1.5 z-10 flex w-3 cursor-col-resize touch-none select-none justify-center',
        'focus-visible:outline-none',
      )}
    >
      <span className="h-full w-px bg-border transition-colors group-hover:w-0.5 group-hover:bg-primary group-focus-visible:w-0.5 group-focus-visible:bg-primary" />
    </div>
  );
}
