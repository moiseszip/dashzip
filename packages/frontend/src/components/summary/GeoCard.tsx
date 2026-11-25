import { lazy, Suspense, useState, type ComponentType } from 'react';
import { Empty, useBox } from '@/components/summary/Charts';
import { formatUnit, type SeriesPoint } from '@/lib/summary';
import { cn } from '@/lib/utils';

/**
 * Vendas por país (mapa-múndi) e por estado (mapa do Brasil), com alternância
 * Mapa/Ranking e o resumo das vendas sem país/estado no canto. Os pontos vêm do
 * backend já normalizados (ISO-2 / UF); `code` vazio é o "sem país".
 */

export interface GeoMapProps {
  width: number;
  height: number;
  /** Intensidade 0–1 do país/estado, ou null sem venda. */
  valueOf: (id: string) => number | null;
  onHover: (id: string | null) => void;
  active: string | null;
}

const WorldMap = lazy(() => import('@/components/summary/maps/WorldMap'));
const BrazilMap = lazy(() => import('@/components/summary/maps/BrazilMap'));

const num = (value: string | number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

type View = 'map' | 'ranking';
type Metric = 'sales' | 'revenue';

function Toggle<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md border border-border p-0.5 text-[11px]">
      {options.map((o) => (
        <button
          key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}
          className={cn('rounded px-2 py-0.5', value === o.value ? 'bg-foreground/10 font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function GeoCard({ kind, points }: { kind: 'country' | 'state'; points: SeriesPoint[] }) {
  const [view, setView] = useState<View>('map');
  const [metric, setMetric] = useState<Metric>('sales');
  const [active, setActive] = useState<string | null>(null);
  const [ref, box] = useBox<HTMLDivElement>();

  const known = points.filter((p) => p.code);
  const unknown = points.find((p) => !p.code);
  const total = points.reduce((sum, p) => sum + num(p.sales), 0);
  if (!total) return <Empty />;

  // No mapa-múndi o id é o numérico ISO; no do Brasil, a UF.
  const idOf = (p: SeriesPoint) => String(kind === 'country' ? p.numeric ?? '' : p.code ?? '');
  const byId = new Map(known.map((p) => [idOf(p), p]));
  const max = Math.max(...known.map((p) => num(p[metric])), 0);
  const valueOf = (id: string) => {
    const p = byId.get(id);
    return p && max > 0 ? num(p[metric]) / max : null;
  };
  const hovered = active ? byId.get(active) : undefined;
  const Map_ = (kind === 'country' ? WorldMap : BrazilMap) as ComponentType<GeoMapProps>;
  const noun = kind === 'country' ? 'país' : 'estado';

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {unknown ? <>Sem {noun}: <span className="tabular-nums text-foreground">{formatUnit(num(unknown.sales), 'int')}</span> ({formatUnit(num(unknown.share), 'pct')})</> : `Todas com ${noun}`}
        </p>
        <div className="flex items-center gap-1.5">
          {view === 'map' && (
            <Toggle<Metric> label="Intensidade" value={metric} onChange={setMetric} options={[{ value: 'sales', label: 'Vendas' }, { value: 'revenue', label: 'Faturamento' }]} />
          )}
          <Toggle<View> label="Visão" value={view} onChange={setView} options={[{ value: 'map', label: 'Mapa' }, { value: 'ranking', label: 'Ranking' }]} />
        </div>
      </div>
      {view === 'map' ? (
        <div ref={ref} className="relative min-h-[140px] flex-1">
          {box.width > 0 && box.height > 0 && (
            <Suspense fallback={<p className="py-6 text-center text-xs text-muted-foreground">Carregando o mapa…</p>}>
              <Map_ width={box.width} height={box.height} valueOf={valueOf} onHover={setActive} active={active} />
            </Suspense>
          )}
          <div role="status" className="pointer-events-none absolute left-0 top-0 min-w-[9rem] rounded-md border border-border bg-popover/95 px-2.5 py-1.5 text-xs shadow-sm empty:hidden">
            {hovered ? (
              <>
                <p className="font-medium">{hovered.label}</p>
                <p className="tabular-nums">{formatUnit(num(hovered.sales), 'int')} {num(hovered.sales) === 1 ? 'venda' : 'vendas'} · {formatUnit(num(hovered.revenue), 'BRL')}</p>
                <p className="text-muted-foreground">{formatUnit(num(hovered.share), 'pct')} do total</p>
              </>
            ) : active ? <p className="text-muted-foreground">Sem vendas</p> : null}
          </div>
        </div>
      ) : (
        <Ranking points={known} unknown={unknown} />
      )}
    </div>
  );
}

function Ranking({ points, unknown }: { points: SeriesPoint[]; unknown?: SeriesPoint }) {
  const rows = unknown ? [...points, unknown] : points;
  const top = Math.max(...rows.map((p) => num(p.share)), 0);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card text-left text-[11px] text-muted-foreground">
          <tr>
            <th className="py-1 font-normal">Local</th>
            <th className="py-1 text-right font-normal">Vendas</th>
            <th className="hidden py-1 text-right font-normal sm:table-cell">Faturamento</th>
            <th className="w-[34%] py-1 pl-3 font-normal">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={String(p.code) || 'none'} className={cn('border-t border-border/60', !p.code && 'text-muted-foreground')}>
              <td className="max-w-0 truncate py-1.5 pr-2" title={p.label}>{p.label}</td>
              <td className="py-1.5 text-right tabular-nums">{formatUnit(num(p.sales), 'int')}</td>
              <td className="hidden py-1.5 text-right tabular-nums sm:table-cell">{formatUnit(num(p.revenue), 'BRL')}</td>
              <td className="py-1.5 pl-3">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-foreground/5">
                    <div className="h-1.5 rounded-full" style={{ width: `${Math.max((num(p.share) / (top || 1)) * 100, 2)}%`, background: 'var(--viz-1)' }} />
                  </div>
                  <span className="w-11 shrink-0 text-right text-xs tabular-nums">{formatUnit(num(p.share), 'pct')}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
