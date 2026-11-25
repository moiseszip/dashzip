import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Card de uma seção da aba Hotjar. */
export function Section({ icon: Icon, title, description, children, className }: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('min-w-0 space-y-4 rounded-lg border border-foreground/10 p-4', className)} aria-label={title}>
      <header>
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Icon className="h-4 w-4 text-muted-foreground" /> {title}
        </h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </header>
      {children}
    </section>
  );
}

export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-foreground/10 px-3 py-2">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
      {note && <p className="truncate text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

/** Barra horizontal com rótulo e valor, usada na rolagem, no abandono, no tempo e no quiz. */
export function BarRow({ label, value, width, tone = 'default', marker, title }: {
  label: ReactNode;
  value: ReactNode;
  /** 0–100 */
  width: number;
  tone?: 'default' | 'heat' | 'alert' | 'muted';
  marker?: string;
  title?: string;
}) {
  const w = Math.max(0, Math.min(100, width));
  const background =
    tone === 'heat'
      ? `hsl(${Math.round(240 * (1 - w / 100))} 85% 55%)`
      : tone === 'alert'
      ? 'hsl(var(--destructive))'
      : tone === 'muted'
      ? 'hsl(var(--muted-foreground) / 0.45)'
      : 'var(--viz-1)';
  return (
    <li className="flex items-center gap-2 text-xs" title={title}>
      <span className="w-20 shrink-0 truncate tabular-nums text-muted-foreground sm:w-24">{label}</span>
      <div className="relative h-4 min-w-0 flex-1 overflow-hidden rounded bg-foreground/5">
        <div className="h-full rounded" style={{ width: `${w}%`, background }} />
        {marker && <span className="absolute right-1 top-0 text-[10px] leading-4 text-muted-foreground">{marker}</span>}
      </div>
      <span className="w-12 shrink-0 text-right tabular-nums">{value}</span>
    </li>
  );
}
