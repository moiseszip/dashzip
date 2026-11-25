import { useId, useState } from 'react';
import { formatUnit, type SeriesPoint } from '@/lib/summary';
import { Empty, useBox } from '@/components/summary/Charts';

/**
 * Funil em faixa única: cada etapa é uma coluna e a faixa afina de uma para a outra
 * com curvas suaves, na espessura do volume da etapa sobre a primeira. Percentual
 * sobre a primeira no meio da faixa, número absoluto embaixo, taxa sobre a etapa
 * anterior na dica. Estreito (card pequeno ou celular), vira vertical.
 */

const num = (value: string | number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const pct = (value: number | null) => (value === null ? '—' : formatUnit(value, 'pct'));

export interface FunnelStep {
  label: string;
  value: number | null;
  pctOfFirst: number | null;
  stepRate: number | null;
  pendingNow: number | null;
}

export function funnelFromPoints(points: SeriesPoint[]): FunnelStep[] {
  const first = num(points[0]?.value);
  return points.map((p, i) => {
    const value = num(p.value);
    const prev = i > 0 ? num(points[i - 1].value) : null;
    return {
      label: p.label,
      value,
      pctOfFirst: num(p.pctOfFirst) ?? (value !== null && first ? value / first : null),
      stepRate: i === 0 ? null : num(p.stepRate) ?? (value !== null && prev ? value / prev : null),
      pendingNow: num(p.pendingNow),
    };
  });
}

/** Contorno da faixa ao longo do eixo principal: plano no centro de cada etapa, curva entre elas. */
function bandPath(centers: number[], half: number[], mid: number, start: number, end: number, vertical: boolean) {
  const pt = (along: number, across: number) => (vertical ? `${across.toFixed(1)},${along.toFixed(1)}` : `${along.toFixed(1)},${across.toFixed(1)}`);
  let top = `M${pt(start, mid - half[0])} L${pt(centers[0], mid - half[0])}`;
  let bottom = `L${pt(end, mid + half[half.length - 1])} L${pt(centers[centers.length - 1], mid + half[half.length - 1])}`;
  for (let i = 1; i < centers.length; i++) {
    const c = (centers[i - 1] + centers[i]) / 2;
    top += ` C${pt(c, mid - half[i - 1])} ${pt(c, mid - half[i])} ${pt(centers[i], mid - half[i])}`;
  }
  top += ` L${pt(end, mid - half[half.length - 1])}`;
  for (let i = centers.length - 1; i > 0; i--) {
    const c = (centers[i - 1] + centers[i]) / 2;
    bottom += ` C${pt(c, mid + half[i])} ${pt(c, mid + half[i - 1])} ${pt(centers[i - 1], mid + half[i - 1])}`;
  }
  bottom += ` L${pt(start, mid + half[0])} Z`;
  return `${top} ${bottom}`;
}

export function FunnelFlow({ points }: { points: SeriesPoint[] }) {
  const gradientId = useId().replace(/:/g, '');
  const [ref, box] = useBox<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const steps = funnelFromPoints(points);
  const first = steps[0]?.value ?? null;
  if (!steps.length || !first) return <Empty />;

  const n = steps.length;
  const vertical = box.width > 0 && box.width < 420;
  const width = box.width;
  const height = vertical ? Math.max(box.height, n * 64) : Math.max(box.height, 180);
  const along = vertical ? height : width;
  const slot = along / n;
  const centers = steps.map((_, i) => slot * (i + 0.5));
  // Horizontal: nome no topo e número embaixo da coluna. Vertical: nome à esquerda e número à direita.
  const labelBand = vertical ? 0 : 22;
  const crossSize = vertical ? width * 0.42 : height - labelBand * 2;
  const mid = vertical ? width / 2 : labelBand + crossSize / 2;
  const maxHalf = Math.max(crossSize / 2 - 4, 8);
  const half = steps.map((s) => Math.max(((s.value ?? 0) / first) * maxHalf, 1.5));
  const d = bandPath(centers, half, mid, 0, along, vertical);
  const shown = hover !== null ? steps[hover] : null;

  return (
    <div ref={ref} className="relative h-full min-h-[180px] w-full">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Funil: ${steps.map((s) => `${s.label} ${formatUnit(s.value, 'int')}`).join(', ')}`}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2={vertical ? '0' : '1'} y2={vertical ? '1' : '0'}>
              <stop offset="0%" style={{ stopColor: 'var(--viz-1)' }} />
              <stop offset="100%" style={{ stopColor: 'var(--viz-3)' }} />
            </linearGradient>
          </defs>
          <path d={d} fill={`url(#${gradientId})`} opacity={0.9} />
          {steps.map((step, i) => {
            const c = centers[i];
            const sep = slot * i;
            return (
              <g key={step.label}>
                {i > 0 && (vertical
                  ? <line x1={0} x2={width} y1={sep} y2={sep} className="stroke-border" strokeWidth={1} />
                  : <line x1={sep} x2={sep} y1={0} y2={height} className="stroke-border" strokeWidth={1} />)}
                {vertical ? (
                  <>
                    <text x={4} y={c} dy="-0.2em" className="fill-muted-foreground text-[11px]">{step.label}</text>
                    <text x={4} y={c} dy="1.1em" className="fill-foreground text-xs font-medium tabular-nums">{formatUnit(step.value, 'int')}</text>
                  </>
                ) : (
                  <>
                    <text x={c} y={14} textAnchor="middle" className="fill-muted-foreground text-[11px]">{step.label}</text>
                    <text x={c} y={height - 6} textAnchor="middle" className="fill-foreground text-xs font-medium tabular-nums">{formatUnit(step.value, 'int')}</text>
                  </>
                )}
                <text
                  x={vertical ? width - 4 : c} y={vertical ? c : mid} dy="0.35em" textAnchor={vertical ? 'end' : 'middle'}
                  className="fill-foreground text-xs font-semibold tabular-nums"
                  style={{ paintOrder: 'stroke', stroke: 'hsl(var(--card))', strokeWidth: 3, strokeLinejoin: 'round' }}
                >
                  {pct(step.pctOfFirst)}
                </text>
                <rect
                  x={vertical ? 0 : sep} y={vertical ? sep : 0} width={vertical ? width : slot} height={vertical ? slot : height}
                  fill="transparent" tabIndex={0} aria-label={`${step.label}: ${formatUnit(step.value, 'int')}`}
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>
      )}
      {shown && hover !== null && (
        <div
          role="status"
          className="pointer-events-none absolute z-10 w-52 rounded-md border border-border bg-popover px-2.5 py-2 text-xs shadow-lg"
          style={vertical
            ? { top: Math.min(centers[hover] + 12, Math.max(height - 90, 0)), left: 8 }
            : { top: 28, left: Math.min(Math.max(centers[hover] - 104, 0), Math.max(width - 210, 0)) }}
        >
          <p className="mb-1 font-medium">{shown.label}</p>
          <p className="tabular-nums">{formatUnit(shown.value, 'int')} · {pct(shown.pctOfFirst)} da primeira etapa</p>
          {hover > 0 && (
            <p className="text-muted-foreground">
              {pct(shown.stepRate)} de {steps[hover - 1].label.toLowerCase()} ({shown.label.toLowerCase()} ÷ {steps[hover - 1].label.toLowerCase()})
            </p>
          )}
          {shown.pendingNow !== null && (
            <p className="text-muted-foreground">Inclui as já pagas; {formatUnit(shown.pendingNow, 'int')} ainda pendentes</p>
          )}
        </div>
      )}
    </div>
  );
}
