import { useQuery } from '@tanstack/react-query';
import { MonitorPlay } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VslReport } from '@/components/vsl/VslReport';
import { useMask } from '@/contexts/StreamingModeContext';
import { getVslReportRange, vslMarkets, type VslMarket, type VslVersion } from '@/lib/vsl';
import type { SummaryDateRange } from '@/lib/summary';

/** Retenção da VSL da página (a antiga aba VSL), no mesmo período da aba. */
export function VslSection({ workspaceId, market, version, range }: {
  workspaceId: string;
  market: VslMarket;
  version: VslVersion;
  range: SummaryDateRange;
}) {
  const { mask, scrub } = useMask();
  const report = useQuery({
    queryKey: ['vsl-report-range', workspaceId, range.since, range.until, market, version],
    queryFn: () => getVslReportRange(workspaceId, range, market, [version]),
    retry: false,
    gcTime: 0,
  });
  const group = report.data?.versions[version];

  return (
    <section aria-label="VSL" className="min-w-0 space-y-3">
      <header>
        <h2 className="flex items-center gap-2 text-base font-semibold"><MonitorPlay className="h-4 w-4 text-muted-foreground" /> VSL</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Retenção do vídeo: quem tocou para assistir e até onde assistiu</p>
      </header>
      {report.isPending && <p role="status" className="text-sm text-muted-foreground">Carregando retenção…</p>}
      {report.isError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-destructive">{scrub(report.error.message)}</span>
          {![401, 403].includes((report.error as Error & { status?: number }).status ?? 0) && (
            <Button size="sm" variant="outline" onClick={() => void report.refetch()}>Tentar novamente</Button>
          )}
        </div>
      )}
      {group && <VslReport label={mask('offer', vslMarkets[market].label)} total={null} versions={[{ id: version, group }]} />}
    </section>
  );
}
