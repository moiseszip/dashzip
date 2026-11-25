import { Card, CardContent } from '@/components/ui/card';
import { vslPercent, vslPlayRate, vslVersions, type VslGroup, type VslVersion } from '@/lib/vsl';
import { VslCurve } from './VslCurve';
import { useMask } from '@/contexts/StreamingModeContext';

const count = (value: number) => value.toLocaleString('pt-BR');
const checkoutRows = [
  { key: 'all', label: 'Todas as visitas' },
  { key: 'muted', label: 'Não tocou para assistir' },
  { key: 'played', label: 'Tocou para assistir' },
  { key: 'half', label: 'Assistiu a 50% ou mais' },
] as const;

export function VslReport({ label, versions, total }: {
  label: string;
  versions: { id: VslVersion; group: VslGroup }[];
  total: VslGroup | null;
}) {
  const { maskUtm } = useMask();
  const comparison = versions.length > 1 && total !== null;
  const group = comparison ? total : versions[0].group;
  const series = versions.filter(({ group }) => group.plays > 0).map(({ id, group }) => ({
    ...vslVersions[id], curve: group.curve,
  }));

  return (
    <Card>
      <CardContent className="space-y-5 p-4 sm:p-5">
        <div>
          <h2 className="text-base font-semibold">{label} · {versions.map(({ id }) => vslVersions[id].label).join(' × ')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            A curva mostra a parcela de quem tocou para assistir que viu cada segundo do vídeo.
          </p>
        </div>
        {!comparison && <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: 'Visitas', value: count(group.visits), note: 'Abriram a página' },
            { label: 'Tocou para assistir', value: vslPercent(vslPlayRate(group)), note: `${count(group.plays)} sessões` },
            { label: 'Retenção média', value: vslPercent(group.averageRetention), note: 'Do vídeo assistido' },
            { label: 'Até o fim', value: vslPercent(group.finish), note: 'De quem tocou para assistir' },
          ].map((metric) => <div key={metric.label} className="rounded-lg bg-muted p-3">
            <dt className="text-xs text-muted-foreground">{metric.label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{metric.value}</dd>
            <dd className="text-xs text-muted-foreground">{metric.note}</dd>
          </div>)}
        </dl>}
        {comparison && versions.some(({ group }) => group.plays < 100) &&
          <p className="text-xs text-muted-foreground">Amostra pequena. Há versões com menos de 100 sessões que tocaram para assistir.</p>}
        <VslCurve duration={Math.max(...versions.map(({ group }) => group.duration))} series={series}
          empty={group.visits ? 'Ninguém tocou para assistir nas versões selecionadas.' : 'Sem visitas nas versões selecionadas no período.'} />

        {comparison ? <Comparison versions={versions} total={total} /> : <Details group={group} />}
        {group.creatives.length > 0 && <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] text-xs">
            <caption className="pb-2 text-left text-sm font-semibold">
              {comparison ? 'Criativos das versões selecionadas' : 'Criativos'}
            </caption>
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 pr-3 text-left">Criativo (utm_content)</th>
                {['Visitas', 'Tocou', 'Retenção', 'Checkout'].map((heading) =>
                  <th scope="col" key={heading} className="px-2 py-2 text-right">{heading}</th>)}
              </tr>
            </thead>
            <tbody>
              {group.creatives.map((creative) => <tr key={creative.name} className="border-t">
                <th scope="row" className="max-w-64 truncate py-2 pr-3 text-left font-medium" title={maskUtm('utm_content', creative.name)}>{maskUtm('utm_content', creative.name) || '—'}</th>
                <td className="px-2 py-2 text-right tabular-nums">{count(creative.visits)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{vslPercent(creative.plays)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{vslPercent(creative.retention)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{vslPercent(creative.checkout)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>}
      </CardContent>
    </Card>
  );
}

function Details({ group }: { group: VslGroup }) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <dl>
        <div className="flex justify-between pb-2 text-sm font-semibold"><dt>Marcos</dt><dd className="text-xs font-normal text-muted-foreground">{group.duration}s de vídeo</dd></div>
        {group.milestones.map((milestone) => <div key={milestone.label} className="flex justify-between border-t py-2 text-xs">
          <dt>{milestone.label} <span className="text-muted-foreground">({milestone.second}s)</span></dt>
          <dd className="tabular-nums">{vslPercent(milestone.retention)}</dd>
        </div>)}
      </dl>
      <dl>
        <div className="flex justify-between pb-2 text-sm font-semibold"><dt>Clicou no checkout</dt><dd className="text-xs font-normal text-muted-foreground">Taxa</dd></div>
        {checkoutRows.map(({ key, label }) => <div key={key} className="flex justify-between border-t py-2 text-xs">
          <dt>{label}</dt><dd className="tabular-nums">{vslPercent(group.checkout[key])}</dd>
        </div>)}
      </dl>
    </div>
  );
}

function Comparison({ versions, total }: {
  versions: { id: VslVersion; group: VslGroup }[];
  total: VslGroup;
}) {
  const columns = [...versions.map(({ id, group }) => ({ ...vslVersions[id], group })), { label: 'Somado', group: total }];
  const rows: { label: string; value: (group: VslGroup) => string }[] = [
    { label: 'Visitas', value: (g) => count(g.visits) },
    { label: 'Tocou para assistir', value: (g) => vslPercent(vslPlayRate(g)) },
    { label: 'Retenção média', value: (g) => vslPercent(g.averageRetention) },
    { label: 'Até o fim', value: (g) => vslPercent(g.finish) },
    ...['3 s', '10 s', '25%', '50%', '75%', 'Fim'].map((point) => ({
      label: point === 'Fim' ? 'Retenção no marco final' : `Retenção em ${point}`,
      value: (g: VslGroup) => vslPercent(g.milestones.find(({ label }) => label === point)?.retention ?? null),
    })),
    ...checkoutRows.map(({ key, label }) => ({
      label: `Checkout · ${label}`,
      value: (g: VslGroup) => vslPercent(g.checkout[key]),
    })),
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[440px] text-xs">
        <thead>
          <tr>
            <th scope="col" className="py-2 pr-3 text-left text-sm font-semibold">Comparação</th>
            {columns.map((item) => <th scope="col" key={item.label} className="whitespace-nowrap px-2 py-2 text-right">
              {'color' in item && <span aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />}
              {item.label}
            </th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, value }) => <tr key={label} className="border-t">
            <th scope="row" className="py-2 pr-3 text-left font-medium">{label}</th>
            {columns.map((item) => <td key={item.label} className="px-2 py-2 text-right tabular-nums">{value(item.group)}</td>)}
          </tr>)}
        </tbody>
      </table>
    </div>
  );
}
