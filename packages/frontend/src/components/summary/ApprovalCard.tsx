import { useBox } from '@/components/summary/Charts';
import { formatUnit, type SeriesPoint } from '@/lib/summary';
import { cn } from '@/lib/utils';

/**
 * Taxa de aprovação por meio de pagamento (docs/features/24-summary/summary.md):
 * uma linha por meio (crédito, débito, Pix, boleto) com um anel de progresso e a
 * taxa ao lado. Taxa = pedidos aprovados ÷ pedidos gerados do meio no período;
 * sem pedido do meio, "—" e o anel vazio. Os pontos vêm prontos do backend.
 */

export const APPROVAL_HINT = 'Aprovados ÷ gerados do método no período. Reembolso e chargeback contam como aprovados (foram pagos).';

const num = (value: string | number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function Ring({ rate, size = 36 }: { rate: number | null; size?: number }) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = rate === null ? 0 : Math.min(Math.max(rate, 0), 1);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-foreground/10" />
      {filled > 0 && (
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          stroke="var(--viz-1)" strokeDasharray={`${c * filled} ${c}`}
        />
      )}
    </svg>
  );
}

export function ApprovalCard({ points }: { points: SeriesPoint[] }) {
  const [ref, box] = useBox<HTMLDivElement>();
  const twoColumns = box.width >= 520;
  return (
    <div ref={ref} className="flex h-full min-h-0 flex-col gap-3">
      <ul className={cn('grid gap-x-6 gap-y-3', twoColumns ? 'grid-cols-2' : 'grid-cols-1')}>
        {points.map((p) => {
          const generated = num(p.generated) ?? 0;
          const approved = num(p.approved) ?? 0;
          const rate = generated > 0 ? num(p.rate) : null;
          const detail = generated > 0
            ? `${formatUnit(approved, 'int')} de ${formatUnit(generated, 'int')} ${generated === 1 ? 'pedido' : 'pedidos'}`
            : 'Sem pedidos no período';
          return (
            <li key={String(p.method ?? p.label)} className="flex items-center gap-3" title={`${p.label}: ${detail}. ${APPROVAL_HINT}`}>
              <Ring rate={rate} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{p.label}</p>
                <p className="truncate text-xs text-muted-foreground">{detail}</p>
              </div>
              <span className={cn('shrink-0 text-base font-semibold tabular-nums', rate === null && 'text-muted-foreground')}>
                {formatUnit(rate, 'pct')}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-auto text-[11px] leading-snug text-muted-foreground">Aprovados ÷ gerados do método.</p>
    </div>
  );
}
