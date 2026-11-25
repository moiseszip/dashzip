import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Monitor, Smartphone } from 'lucide-react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { NoWorkspace } from '@/components/NoWorkspace';
import { ResultDatePicker } from '@/components/summary/ResultDatePicker';
import { Segmented } from '@/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { HeatmapSection } from '@/components/hotjar/HeatmapSection';
import { RetentionSection } from '@/components/hotjar/RetentionSection';
import { PurchaseTimingSection } from '@/components/hotjar/PurchaseTimingSection';
import { QuizSection } from '@/components/hotjar/QuizSection';
import { VslSection } from '@/components/hotjar/VslSection';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { useMask } from '@/contexts/StreamingModeContext';
import { useHeatmapToken } from '@/hooks/useHeatmap';
import { presetSelection, type ResultDateSelection } from '@/lib/resultDates';
import {
  campaignName,
  getHotjarPage,
  getHotjarPages,
  pagePath,
  type HotjarDevice,
  type HotjarFilterOption,
  type HotjarFilters,
  type HotjarPage,
} from '@/lib/hotjar';

const ALL = '__all__';
const PAGE_KEY = 'hotjar:page:';

function readSaved(workspaceId: string): string | null {
  try {
    return localStorage.getItem(PAGE_KEY + workspaceId);
  } catch {
    return null;
  }
}

function save(workspaceId: string, url: string) {
  try {
    localStorage.setItem(PAGE_KEY + workspaceId, url);
  } catch {
    // Navegador sem armazenamento: a página escolhida só não fica lembrada.
  }
}

/**
 * Aba Hotjar: por página do painel, o mapa de calor (cliques e rolagem), a
 * retenção da página, o tempo até a compra, o funil do quiz e a retenção da
 * VSL. Doc:
 * docs/features/27-hotjar.
 */
export default function Hotjar() {
  const { activeWorkspace } = useWorkspaceContext();
  return (
    <DashboardLayout wide>
      <div className="space-y-5 animate-dash-in">
        <header>
          <h1 className="text-xl font-semibold text-foreground">Hotjar</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Comportamento nas páginas: onde clicam, até onde rolam, o quiz e a VSL
          </p>
        </header>
        {activeWorkspace ? <HotjarPanel workspaceId={activeWorkspace.id} /> : <NoWorkspace />}
      </div>
    </DashboardLayout>
  );
}

function HotjarPanel({ workspaceId }: { workspaceId: string }) {
  const { mask, scrub } = useMask();
  const [date, setDate] = useState<ResultDateSelection>(() => presetSelection('last7'));
  const [device, setDevice] = useState<HotjarDevice>('mobile');
  const [source, setSource] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(() => readSaved(workspaceId));
  const range = date.range;
  const filters = useMemo<HotjarFilters>(() => ({ device, source, campaign }), [device, source, campaign]);
  const { token, error: tokenError } = useHeatmapToken();

  const pages = useQuery({
    queryKey: ['hotjar-pages', workspaceId, range.since, range.until, filters],
    queryFn: () => getHotjarPages(workspaceId, range, filters),
    retry: false,
    placeholderData: (previous) => previous,
  });
  const list = pages.data?.pages;

  // Sem a página escolhida nos dados do filtro, cai na mais visitada.
  const current = list?.find((p) => p.url === selected) ?? list?.[0] ?? null;
  useEffect(() => {
    if (current && current.url !== selected) setSelected(current.url);
  }, [current, selected]);

  const choose = (url: string) => {
    setSelected(url);
    save(workspaceId, url);
  };

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
        <Field label="Página" className="sm:col-span-2 lg:col-span-1">
          <PageSelect pages={list ?? []} value={current?.url ?? null} onChange={choose} loading={pages.isPending} />
        </Field>
        <Field label="Data">
          <ResultDatePicker value={date} onApply={setDate} showCompare={false} align="end" />
        </Field>
        <Field label="Aparelho">
          <Segmented<HotjarDevice>
            value={device}
            onChange={setDevice}
            label="Aparelho"
            fill
            options={[
              { value: 'mobile', label: 'Celular', icon: Smartphone },
              { value: 'desktop', label: 'Computador', icon: Monitor },
            ]}
            className="sm:h-10 sm:items-center"
          />
        </Field>
        <Field label="Origem">
          <FilterSelect
            label="Origem"
            value={source}
            onChange={setSource}
            options={pages.data?.filters.sources ?? []}
            render={(v) => v}
          />
        </Field>
        <Field label="Campanha" className="lg:col-span-2">
          <FilterSelect
            label="Campanha"
            value={campaign}
            onChange={setCampaign}
            options={pages.data?.filters.campaigns ?? []}
            render={(v) => mask('campaign', campaignName(v))}
          />
        </Field>
      </div>

      {pages.isPending ? (
        <Spinner />
      ) : pages.isError ? (
        <p role="alert" className="text-sm text-destructive">{scrub(pages.error.message)}</p>
      ) : !current ? (
        <div className="rounded-lg border border-foreground/10 px-6 py-10 text-center text-sm text-muted-foreground">
          <p className="text-foreground">Nenhuma visita medida {device === 'mobile' ? 'no celular' : 'no computador'} com esses filtros.</p>
          <p className="mt-2">O código da página (Integrações) já coleta sozinho: os dados aparecem a partir das próximas visitas.</p>
        </div>
      ) : (
        <PageReport workspaceId={workspaceId} page={current} range={range} filters={filters} token={token} tokenError={tokenError} />
      )}
    </>
  );
}

function PageReport({ workspaceId, page, range, filters, token, tokenError }: {
  workspaceId: string;
  page: HotjarPage;
  range: ResultDateSelection['range'];
  filters: HotjarFilters;
  token: string | null;
  tokenError: string | null;
}) {
  const { scrub } = useMask();
  const detail = useQuery({
    queryKey: ['hotjar-page', workspaceId, page.url, range.since, range.until, filters],
    queryFn: () => getHotjarPage(workspaceId, page.url, range, filters),
    retry: false,
  });
  const showQuiz = page.quiz || /\/quiz(\/|$)/i.test(new URL(page.url).pathname) || !!detail.data?.quiz;
  const vsl = detail.data?.vsl ?? page.vsl;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <HeatmapSection
          url={page.url}
          token={token}
          tokenError={tokenError ? scrub(tokenError) : null}
          range={range}
          filters={filters}
          clicks={detail.data?.clicks.total ?? page.clicks}
          topElements={detail.data?.clicks.topElements ?? []}
        />
        <div className="min-w-0 space-y-4">
          {detail.isPending ? (
            <Spinner />
          ) : detail.isError ? (
            <p role="alert" className="text-sm text-destructive">{scrub(detail.error.message)}</p>
          ) : (
            <RetentionSection retention={detail.data.retention} />
          )}
          <PurchaseTimingSection workspaceId={workspaceId} url={page.url} range={range} filters={filters} />
        </div>
      </div>
      {showQuiz && detail.data && <QuizSection quiz={detail.data.quiz} />}
      {vsl && <VslSection workspaceId={workspaceId} market={vsl.market} version={vsl.version} range={range} />}
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className ? `min-w-0 space-y-1 ${className}` : 'min-w-0 space-y-1'}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-12" role="status" aria-label="Carregando">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function PageSelect({ pages, value, onChange, loading }: {
  pages: HotjarPage[];
  value: string | null;
  onChange: (url: string) => void;
  loading: boolean;
}) {
  // Modo streaming: domínio e caminho viram "Página N".
  const { mask } = useMask();
  const label = (p: HotjarPage) => mask('page', pagePath(p.url));
  return (
    <Select value={value ?? ''} onValueChange={onChange} disabled={loading || pages.length === 0}>
      <SelectTrigger aria-label="Página">
        <SelectValue placeholder={loading ? 'Carregando…' : 'Sem páginas no período'} />
      </SelectTrigger>
      <SelectContent>
        {pages.map((p) => (
          <SelectItem key={p.url} value={p.url}>
            {label(p)}
            <span className="ml-2 tabular-nums text-muted-foreground">
              {p.views.toLocaleString('pt-BR')} {p.views === 1 ? 'visita' : 'visitas'}
              {p.quiz ? ' · quiz' : ''}
              {p.vsl ? ' · VSL' : ''}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FilterSelect({ label, value, onChange, options, render }: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  options: HotjarFilterOption[];
  render: (value: string) => string;
}) {
  // O valor escolhido continua na lista mesmo quando some das opções do período.
  const all = value && !options.some((o) => o.value === value) ? [{ value, sessions: 0 }, ...options] : options;
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? null : v)}>
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Todas</SelectItem>
        {all.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {render(o.value)}
            {o.sessions > 0 && <span className="ml-2 tabular-nums text-muted-foreground">{o.sessions.toLocaleString('pt-BR')}</span>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
