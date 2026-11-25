import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Timer } from 'lucide-react';
import { Segmented } from '@/components/ui/segmented';
import { useMask } from '@/contexts/StreamingModeContext';
import {
  duration,
  getHotjarPurchaseTiming,
  pct,
  type HotjarFilters,
  type TimingSummary,
} from '@/lib/hotjar';
import type { SummaryDateRange } from '@/lib/summary';
import { Section, Stat } from './Section';

type Mode = 'checkout' | 'purchase';

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;

/**
 * Tempo até a compra: das vendas aprovadas ligadas a uma sessão do rastreio,
 * quanto tempo a pessoa ficou na página antes de ir para o checkout (ou até a
 * venda ser aprovada). Os números ficam visíveis no modo streaming.
 */
export function PurchaseTimingSection({ workspaceId, url, range, filters }: {
  workspaceId: string;
  url: string;
  range: SummaryDateRange;
  filters: HotjarFilters;
}) {
  const { scrub } = useMask();
  const [mode, setMode] = useState<Mode>('checkout');
  const timing = useQuery({
    queryKey: ['hotjar-purchase-timing', workspaceId, url, range.since, range.until, filters],
    queryFn: () => getHotjarPurchaseTiming(workspaceId, url, range, filters),
    retry: false,
  });

  return (
    <Section
      icon={Timer}
      title="Tempo até a compra"
      description="Quanto tempo quem comprou ficou na página, do primeiro carregamento na sessão"
    >
      <Segmented<Mode>
        value={mode}
        onChange={setMode}
        label="Medir até"
        fill
        options={[
          { value: 'checkout', label: 'Até o checkout' },
          { value: 'purchase', label: 'Até a compra' },
        ]}
      />
      {timing.isPending ? (
        <div className="flex justify-center py-6" role="status" aria-label="Carregando">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : timing.isError ? (
        <p role="alert" className="text-sm text-destructive">{scrub(timing.error.message)}</p>
      ) : (
        <Timing
          summary={mode === 'checkout' ? timing.data.checkout : timing.data.purchase}
          mode={mode}
          noSession={timing.data.noSession}
          otherPages={timing.data.otherPages}
        />
      )}
    </Section>
  );
}

function Timing({ summary: t, mode, noSession, otherPages }: {
  summary: TimingSummary;
  mode: Mode;
  noSession: number;
  otherPages: number;
}) {
  const goal = mode === 'checkout' ? 'foi para o checkout' : 'comprou';
  const maxShare = Math.max(1, ...t.buckets.map((b) => b.share));
  const left: string[] = [];
  if (noSession) left.push(`${plural(noSession, 'venda aprovada', 'vendas aprovadas')} sem sessão do rastreio (não dá para ligar a uma página)`);
  if (t.discarded) left.push(`${plural(t.discarded, 'descartada', 'descartadas')} por tempo negativo ou acima de 24 h`);
  if (t.missing) left.push(`${plural(t.missing, 'sem', 'sem')} o carregamento da página registrado`);
  if (otherPages) left.push(`${plural(otherPages, 'compra', 'compras')} com sessão sem clique de checkout registrado nesta página (pode ter sido em outra página)`);

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Mediana" value={duration(t.median)} note="metade em até" />
        <Stat label="Média" value={duration(t.average)} />
        <Stat label="P75" value={duration(t.p75)} note="75% em até" />
        <Stat label="P90" value={duration(t.p90)} note="90% em até" />
      </div>

      {t.measured === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma venda aprovada com sessão do rastreio começou o checkout nesta página no período, com esses filtros.
        </p>
      ) : (
        <div>
          <p className="mb-2 text-xs">
            Metade {goal} em até <strong>{duration(t.median)}</strong> na página; 90% em até <strong>{duration(t.p90)}</strong>.
          </p>
          <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="w-20 shrink-0 sm:w-24">Tempo</span>
            <span className="min-w-0 flex-1 truncate">
              % das compras<span className="hidden sm:inline"> (a barra termina no acumulado)</span>
            </span>
            <span className="w-[6.5rem] shrink-0 text-right">faixa · acum.</span>
          </div>
          <ul className="space-y-1" aria-label="Distribuição do tempo até a compra">
            {t.buckets.map((b) => {
              const before = Math.max(0, b.cumulative - b.share);
              return (
                <li
                  key={b.min}
                  className="flex items-center gap-2 text-xs"
                  title={`${b.label}: ${plural(b.purchases, 'compra', 'compras')} (${pct(b.share)})${b.max === null ? '' : `; ${pct(b.cumulative)} em até ${duration(b.max)}`}`}
                >
                  <span className="w-20 shrink-0 truncate tabular-nums text-muted-foreground sm:w-24">{b.label}</span>
                  <div className="relative h-4 min-w-0 flex-1 overflow-hidden rounded bg-foreground/5">
                    <div className="absolute inset-y-0 left-0 rounded-l bg-foreground/10" style={{ width: `${before}%` }} />
                    {b.share > 0 && (
                      <div
                        className="absolute inset-y-0 rounded"
                        style={{ left: `${before}%`, width: `${Math.max(1, b.share)}%`, background: 'var(--viz-1)', opacity: 0.55 + 0.45 * (b.share / maxShare) }}
                      />
                    )}
                  </div>
                  <span className="w-[6.5rem] shrink-0 text-right tabular-nums">
                    <span>{pct(b.share)}</span>
                    <span className="text-muted-foreground"> ({b.purchases})</span>
                    <span className="ml-1.5 inline-block w-9 text-muted-foreground">{pct(b.cumulative)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        {plural(t.measured, 'compra entrou', 'compras entraram')} no gráfico.
        {left.length > 0 && <> Ficaram de fora: {left.join('; ')}.</>}
      </p>
    </>
  );
}
