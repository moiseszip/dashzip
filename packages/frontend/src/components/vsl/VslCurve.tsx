import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { vslPercent } from '@/lib/vsl';

export type VslSeries = { label: string; color: string; curve: number[] };

const margin = { top: 12, right: 18, bottom: 26, left: 42 };
const ticks = [0, 0.25, 0.5, 0.75, 1];

export function VslCurve({ duration, series, empty }: { duration: number; series: VslSeries[]; empty: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [second, setSecond] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!container.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(120, Math.round(entry.contentRect.width))));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  const height = Math.min(300, Math.max(200, Math.round(width * 0.42)));
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const end = duration - 1;
  const current = Math.min(second, end);
  const showDetail = series.length > 0 && (hovered || focused);
  const x = (s: number) => margin.left + s / end * plotWidth;
  const y = (value: number) => margin.top + (1 - value) * plotHeight;
  const interval = Math.max(1, Math.ceil(end / Math.max(1, Math.floor(plotWidth / 55)) / 5) * 5);
  const timeTicks = Array.from({ length: Math.floor(end / interval) + 1 }, (_, i) => i * interval);
  const detail = series.map((item) => `${item.label} ${vslPercent(item.curve[current] ?? null)}`);

  function move(event: PointerEvent<SVGSVGElement>) {
    if (!series.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    const position = ((event.clientX - bounds.left) / bounds.width * width - margin.left) / plotWidth;
    setSecond(Math.max(0, Math.min(end, Math.round(position * end))));
    setHovered(true);
  }

  return (
    <div ref={container} className="min-w-0">
      {series.length > 0 && <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((item) => <span key={item.label} className="inline-flex items-center gap-2">
          <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: item.color }} aria-hidden="true" />
          {item.label}
        </span>)}
      </div>}
      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          className="block select-none rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          role={series.length ? 'slider' : 'img'}
          aria-label="Curva de retenção por segundo"
          tabIndex={series.length ? 0 : undefined}
          aria-valuemin={series.length ? 0 : undefined}
          aria-valuemax={series.length ? end : undefined}
          aria-valuenow={series.length ? current : undefined}
          aria-valuetext={series.length ? `${current} s. ${detail.join(', ')}` : undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onPointerMove={move}
          onPointerDown={move}
          onPointerLeave={() => setHovered(false)}
          onPointerCancel={() => setHovered(false)}
          onKeyDown={(event) => {
            const next = { ArrowLeft: current - 1, ArrowDown: current - 1, ArrowRight: current + 1, ArrowUp: current + 1, Home: 0, End: end }[event.key];
            if (next === undefined) return;
            event.preventDefault();
            setSecond(Math.max(0, Math.min(end, next)));
          }}
        >
          {ticks.map((tick) => <g key={tick}>
            <line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} className="stroke-border" />
            <text x={margin.left - 6} y={y(tick) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">{vslPercent(tick)}</text>
          </g>)}
          {timeTicks.map((s) => <text key={s} x={x(s)} y={height - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">{s}s</text>)}
          {series.map((item) => <path key={item.label}
            d={item.curve.map((value, s) => `${s ? 'L' : 'M'}${x(s).toFixed(1)},${y(value).toFixed(1)}`).join(' ')}
            fill="none" stroke={item.color} strokeWidth={2} strokeLinejoin="round" />)}
          {showDetail && <g>
            <line x1={x(current)} x2={x(current)} y1={margin.top} y2={height - margin.bottom} className="stroke-muted-foreground" />
            {series.map((item) => item.curve[current] !== undefined && <circle key={item.label}
              cx={x(current)} cy={y(item.curve[current])} r={4} fill={item.color} className="stroke-card" strokeWidth={2} />)}
          </g>}
        </svg>
        {showDetail && <div aria-hidden="true" className="pointer-events-none absolute top-1 rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow-sm"
          style={current > end / 2 ? { right: `${(1 - x(current) / width) * 100}%` } : { left: `${x(current) / width * 100}%` }}>
          <p className="mb-1 font-semibold">{current}s</p>
          {detail.map((text) => <p key={text}>{text}</p>)}
        </div>}
        {!series.length && <div className="pointer-events-none absolute inset-0 grid place-items-center px-12 text-center">
          <p className="rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground">{empty}</p>
        </div>}
      </div>
    </div>
  );
}
