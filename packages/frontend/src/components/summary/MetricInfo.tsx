import { useEffect, useRef, useState, type PointerEvent } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Info } from 'lucide-react';

export function MetricInfo({ label, hint }: { label: string; hint: string }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  function onMouseEnter(event: PointerEvent<HTMLButtonElement | HTMLDivElement>) {
    if (event.pointerType !== 'mouse') return;
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  }

  function onMouseLeave(event: PointerEvent<HTMLButtonElement | HTMLDivElement>) {
    if (event.pointerType !== 'mouse') return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 180);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Sobre ${label}`}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-5 sm:w-5"
          onPointerEnter={onMouseEnter}
          onPointerLeave={onMouseLeave}
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-label={`Cálculo de ${label}`}
          sideOffset={4}
          collisionPadding={12}
          onPointerEnter={onMouseEnter}
          onPointerLeave={onMouseLeave}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          className="z-50 max-w-[min(18rem,calc(100vw-1.5rem))] rounded-md border border-border bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-lg"
        >
          {hint}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
