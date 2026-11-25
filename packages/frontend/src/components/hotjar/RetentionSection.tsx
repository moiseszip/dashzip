import { ScrollText } from 'lucide-react';
import { duration, pct, type PageRetention } from '@/lib/hotjar';
import { BarRow, Section, Stat } from './Section';

/** Até onde rolam, onde param e quanto tempo ficam na página. */
export function RetentionSection({ retention: r }: { retention: PageRetention }) {
  const rows = Array.from({ length: 10 }, (_, i) => ({ at: (i + 1) * 10, reach: r.reach[(i + 1) * 2] ?? 0 }));
  const maxDrop = Math.max(1, ...r.dropoff.map((b) => b.share));
  const maxTime = Math.max(1, ...r.time.buckets.map((b) => b.share));

  return (
    <Section icon={ScrollText} title="Retenção da página" description="Até onde as visitas rolam, onde abandonam e quanto tempo ficam">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Visitas" value={r.views.toLocaleString('pt-BR')} />
        <Stat label="Rolagem média" value={pct(r.avgDepth)} />
        <Stat label="Viram até o fim" value={pct(r.reachedEnd)} note="90% da página ou mais" />
        <Stat
          label="Tempo na página"
          value={duration(r.time.median)}
          note={r.time.measured ? `mediana · média ${duration(r.time.average)}` : 'medindo desde 23/11'}
        />
      </div>

      {r.views === 0 ? (
        <p className="text-sm text-muted-foreground">Sem visitas medidas nesta página com esses filtros.</p>
      ) : (
        <>
          <div>
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">Quantos chegaram até cada parte da página</h3>
            <ul className="space-y-1">
              {rows.map((row) => (
                <BarRow
                  key={row.at}
                  label={`${row.at}%`}
                  value={pct(row.reach)}
                  width={row.reach}
                  tone="heat"
                  marker={r.fold !== null && r.fold > row.at - 10 && r.fold <= row.at ? 'fim da 1ª tela' : undefined}
                />
              ))}
            </ul>
          </div>

          {r.screens.length > 1 && (
            <div>
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">Por dobra (cada tela do aparelho)</h3>
              <ol className="flex flex-wrap gap-1.5">
                {r.screens.map((s) => (
                  <li key={s.screen} className="rounded-md border border-foreground/10 px-2 py-1 text-xs">
                    <span className="text-muted-foreground">{s.screen}ª tela</span>{' '}
                    <span className="font-medium tabular-nums">{pct(s.reach)}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div>
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">Onde abandonam (pararam de rolar)</h3>
            <p className="mb-2 text-xs">
              {r.biggestDrop
                ? <>A maior saída depois da primeira tela é entre <strong>{r.biggestDrop.from}% e {r.biggestDrop.to}%</strong> da página: {pct(r.biggestDrop.share)} das visitas param ali.</>
                : 'Nenhuma queda forte depois da primeira tela.'}
            </p>
            <ul className="space-y-1">
              {r.dropoff.map((b) => (
                <BarRow
                  key={b.from}
                  label={`${b.from}–${b.to}%`}
                  value={pct(b.share)}
                  width={(b.share / maxDrop) * 100}
                  tone={r.biggestDrop?.from === b.from ? 'alert' : 'muted'}
                />
              ))}
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">Tempo na página (com a aba visível)</h3>
            {r.time.measured === 0 ? (
              <p className="text-xs text-muted-foreground">
                O tempo começou a ser medido em 23/11/2026: aparece a partir das próximas visitas.
              </p>
            ) : (
              <ul className="space-y-1">
                {r.time.buckets.map((b) => (
                  <BarRow key={b.min} label={b.label} value={pct(b.share)} width={(b.share / maxTime) * 100} />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </Section>
  );
}
