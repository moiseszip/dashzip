import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { formatCompact, formatUnit, gainTone, TONE_CLASS, type SeriesPoint, type Unit } from '@/lib/summary';

/**
 * Gráficos em SVG puro, no tema do app. Cores por papel (--viz-1..3, validadas no
 * claro e no escuro); texto sempre em tokens de texto, nunca na cor da série; grade
 * e eixos recessivos; dica ao passar o mouse em toda marca.
 */

export interface Series {
  key: string;
  label: string;
  color: string;
}

const num = (value: string | number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Largura do elemento. Ref de callback: o gráfico pode montar primeiro o estado
 * vazio e só depois o SVG (quando os dados chegam), e a medida precisa acompanhar.
 */
function useWidth<T extends HTMLElement>() {
  const [ref, box] = useBox<T>();
  return [ref, box.width] as const;
}

/** Largura e altura do elemento (ref de callback: funciona mesmo se o elemento aparecer depois). */
export function useBox<T extends HTMLElement>() {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    observer.current = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width);
      const height = Math.floor(entry.contentRect.height);
      setBox((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    });
    observer.current.observe(el);
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, box] as const;
}

/** Série de lucro: o valor ganha a cor de ganho/perda pelo sinal. */
const toneOf = (seriesKey: string, value: number | null) => {
  const tone = /^profit/.test(seriesKey) ? gainTone('profit', value) : null;
  return tone ? TONE_CLASS[tone] : undefined;
};

function niceTicks(min: number, max: number, count = 4) {
  if (min === max) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? step0;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

function Legend({ series, last, raw }: { series: Series[]; last?: Record<string, string>; raw?: Record<string, number | null> }) {
  if (series.length < 2) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: s.color }} aria-hidden />
          {s.label}
          {last?.[s.key] && <span className={cn('tabular-nums text-foreground', toneOf(s.key, raw?.[s.key] ?? null))}>{last[s.key]}</span>}
        </span>
      ))}
    </div>
  );
}

function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x + 12, 0), Math.max(width - 190, 0));
  return (
    <div
      className="pointer-events-none absolute top-2 z-10 w-44 rounded-md border border-border bg-popover px-2.5 py-2 text-xs shadow-lg"
      style={{ left }}
      role="status"
    >
      {children}
    </div>
  );
}

const PAD = { top: 8, right: 12, bottom: 22, left: 64 };

/** Linhas de uma mesma unidade, num eixo só. */
export function LineChart({ points, series, unit, height = 220, formatX = (l) => l }: {
  points: SeriesPoint[];
  series: Series[];
  unit: Unit;
  height?: number;
  formatX?: (label: string) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const values = points.flatMap((p) => series.map((s) => num(p[s.key]))).filter((v): v is number => v !== null);
  const lastIndex = points.length - 1;
  const last = Object.fromEntries(series.map((s) => [s.key, formatCompact(num(points[lastIndex]?.[s.key]), unit)]));
  const lastRaw = Object.fromEntries(series.map((s) => [s.key, num(points[lastIndex]?.[s.key])]));

  if (!points.length || !values.length) return <Empty />;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const ticks = niceTicks(min, max);
  const lo = Math.min(min, ticks[0]);
  const hi = Math.max(max, ticks[ticks.length - 1]);
  const plotW = Math.max(width - PAD.left - PAD.right, 10);
  const plotH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 56))));

  const path = (key: string) => {
    let d = '';
    let pen = false;
    points.forEach((p, i) => {
      const v = num(p[key]);
      if (v === null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const onMove = (event: React.MouseEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const rel = event.clientX - rect.left;
    const i = points.length === 1 ? 0 : Math.round((rel / rect.width) * (points.length - 1));
    setHover(Math.min(Math.max(i, 0), points.length - 1));
  };

  return (
    <div>
      <Legend series={series} last={last} raw={lastRaw} />
      <div ref={ref} className="relative">
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={series.map((s) => s.label).join(', ')}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'stroke-border' : 'stroke-border/50'} strokeDasharray={t === 0 ? undefined : '2 4'} />
                <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">{formatCompact(t, unit)}</text>
              </g>
            ))}
            {points.map((p, i) => (i % every === 0 || i === lastIndex) && (
              <text key={p.label} x={x(i)} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">{formatX(p.label)}</text>
            ))}
            {series.map((s) => (
              <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {hover !== null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} className="stroke-muted-foreground/60" />
                {series.map((s) => {
                  const v = num(points[hover][s.key]);
                  return v === null ? null : (
                    <circle key={s.key} cx={x(hover)} cy={y(v)} r={4} fill={s.color} className="stroke-background" strokeWidth={2} />
                  );
                })}
              </g>
            )}
            <rect
              x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="transparent"
              onMouseMove={onMove} onMouseLeave={() => setHover(null)}
            />
          </svg>
        )}
        {hover !== null && (
          <Tooltip x={x(hover)} width={width}>
            <p className="mb-1 font-medium">{formatX(points[hover].label)}</p>
            {series.map((s) => (
              <p key={s.key} className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} aria-hidden />{s.label}
                </span>
                <span className={cn('tabular-nums', toneOf(s.key, num(points[hover][s.key])))}>{formatUnit(num(points[hover][s.key]), unit)}</span>
              </p>
            ))}
          </Tooltip>
        )}
      </div>
    </div>
  );
}

/** Colunas para categorias ordenadas (hora do dia, dia da semana). Mouse: dica ao passar; toque: dica ao tocar. */
export function ColumnChart({ points, valueKey, unit, detail, height = 200, color = 'var(--viz-1)', formatX = (l) => l }: {
  points: SeriesPoint[];
  /** Rótulo curto do eixo (a dica mostra o nome inteiro). */
  formatX?: (label: string) => string;
  valueKey: string;
  unit: Unit;
  detail?: (p: SeriesPoint) => string;
  height?: number;
  color?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  const setRefs = useCallback((el: HTMLDivElement | null) => { ref(el); wrap.current = el; }, [ref]);
  // No toque, a dica fica aberta até tocar de novo na coluna ou fora do gráfico.
  useEffect(() => {
    if (hover === null) return;
    const close = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setHover(null); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [hover]);
  const values = points.map((p) => num(p[valueKey]) ?? 0);
  const max = Math.max(...values, 0);
  if (!points.length || max === 0) return <Empty />;
  const ticks = niceTicks(0, max);
  const hi = Math.max(max, ticks[ticks.length - 1]);
  const plotW = Math.max(width - PAD.left - PAD.right, 10);
  const plotH = height - PAD.top - PAD.bottom;
  const slot = plotW / points.length;
  const barW = Math.max(Math.min(slot - 2, 28), 2);
  const y = (v: number) => PAD.top + plotH - (v / hi) * plotH;
  // Espaço por rótulo pelo texto mais longo (~6px por letra a 10px + respiro).
  const labelW = Math.max(...points.map((p) => formatX(p.label).length)) * 6 + 8;
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / labelW))));

  return (
    <div ref={setRefs} className="relative touch-manipulation">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Gráfico de colunas">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'stroke-border' : 'stroke-border/50'} strokeDasharray={t === 0 ? undefined : '2 4'} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">{formatCompact(t, unit)}</text>
            </g>
          ))}
          {points.map((p, i) => {
            const v = values[i];
            const cx = PAD.left + slot * i + slot / 2;
            const top = y(v);
            const h = PAD.top + plotH - top;
            return (
              <g
                key={p.label}
                onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHover(i); }}
                onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHover(null); }}
                onPointerDown={(e) => { if (e.pointerType !== 'mouse') setHover((current) => (current === i ? null : i)); }}
              >
                <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={plotH} fill="transparent" />
                {h > 0 && (
                  <path
                    d={`M${cx - barW / 2},${PAD.top + plotH} V${top + Math.min(4, h)} Q${cx - barW / 2},${top} ${cx - barW / 2 + Math.min(4, barW / 2)},${top} H${cx + barW / 2 - Math.min(4, barW / 2)} Q${cx + barW / 2},${top} ${cx + barW / 2},${top + Math.min(4, h)} V${PAD.top + plotH} Z`}
                    fill={color} opacity={hover === null || hover === i ? 1 : 0.45}
                  />
                )}
                {(i % every === 0) && (
                  <text x={cx} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">{formatX(p.label)}</text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && (
        <Tooltip x={PAD.left + slot * hover + slot / 2} width={width}>
          <p className="mb-1 font-medium">{points[hover].label}</p>
          <p className="tabular-nums">{formatUnit(values[hover], unit)}</p>
          {detail && <p className="text-muted-foreground">{detail(points[hover])}</p>}
        </Tooltip>
      )}
    </div>
  );
}

/** Barras horizontais ordenadas, para categorias sem ordem (produto, origem, país). */
export function BarList({ points, valueKey, unit, detail, limit = 8 }: {
  points: SeriesPoint[];
  valueKey: string;
  unit: Unit;
  detail?: (p: SeriesPoint) => string;
  limit?: number;
}) {
  const sorted = [...points].sort((a, b) => (num(b[valueKey]) ?? 0) - (num(a[valueKey]) ?? 0));
  const shown = sorted.slice(0, limit);
  const rest = sorted.slice(limit);
  const restValue = rest.reduce((sum, p) => sum + (num(p[valueKey]) ?? 0), 0);
  const rows = rest.length ? [...shown, { label: `Outros (${rest.length})`, [valueKey]: restValue } as SeriesPoint] : shown;
  const max = Math.max(...rows.map((p) => num(p[valueKey]) ?? 0), 0);
  if (!rows.length || max === 0) return <Empty />;
  return (
    <ul className="space-y-2.5">
      {rows.map((p) => {
        const v = num(p[valueKey]) ?? 0;
        return (
          <li key={p.label} className="text-sm" title={detail ? `${p.label}: ${formatUnit(v, unit)} · ${detail(p)}` : undefined}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="truncate">{p.label}</span>
              <span className="shrink-0 tabular-nums">
                {formatUnit(v, unit)}
                {detail && !String(p.label).startsWith('Outros (') && <span className="ml-1.5 text-xs text-muted-foreground">{detail(p)}</span>}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-foreground/5">
              <div className="h-1.5 rounded-full" style={{ width: `${Math.max((v / max) * 100, 1)}%`, background: 'var(--viz-1)' }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function Empty() {
  return <p className="py-6 text-center text-sm text-muted-foreground">Sem dados no período.</p>;
}
