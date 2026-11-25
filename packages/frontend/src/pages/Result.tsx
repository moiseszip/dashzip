import { useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Download, Pencil, Plus, RefreshCw, RotateCcw, Trash2, Upload } from 'lucide-react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { NoWorkspace } from '@/components/NoWorkspace';
import { ResultDatePicker } from '@/components/summary/ResultDatePicker';
import { BarList, ColumnChart, LineChart, useBox, type Series } from '@/components/summary/Charts';
import { FunnelFlow } from '@/components/summary/FunnelFlow';
import { GeoCard } from '@/components/summary/GeoCard';
import { ApprovalCard } from '@/components/summary/ApprovalCard';
import { MetricInfo } from '@/components/summary/MetricInfo';
import { AddCardDialog } from '@/components/summary/AddCardDialog';
import { EditFrame, EditGrid, StaticGrid, useIsMobile } from '@/components/summary/SummaryGrid';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RouteFallback } from '@/components/RouteFallback';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { useMask } from '@/contexts/StreamingModeContext';
import { Masked } from '@/components/Masked';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { findTrackingPlatform } from '@/lib/trackingPlatforms';
import { resultPresetRange, type ResultDateSelection } from '@/lib/resultDates';
import {
  LOWER_IS_BETTER,
  TONE_CLASS,
  formatCardValue,
  formatUnit,
  gainTone,
  summaryApi,
  variation,
  type ChartKey,
  type LayoutItem,
  type SeriesPoint,
  type SummaryCard,
  type SummaryFilters,
  type SummaryLayout,
  type SummaryLayoutV1,
} from '@/lib/summary';
import {
  appendItem, cleanLayout, compactItems, defaultSize, moveToSection, newSectionKey, normalizeLayout, nudgeItem, resizeItem,
} from '@/lib/summaryLayout';
import { EMPTY_SUMMARY_FILTERS, summaryLayoutQuery, summaryQuery } from '@/lib/pageQueries';

const shortDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : iso);

export default function Result() {
  const { activeWorkspace } = useWorkspaceContext();
  const [headerActions, setHeaderActions] = useState<HTMLDivElement | null>(null);
  return (
    <DashboardLayout wide>
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">Resultado</h1>
            {activeWorkspace && <p className="mt-1 truncate text-sm text-muted-foreground"><Masked kind="workspace" value={activeWorkspace.name} /></p>}
          </div>
          {/* Celular: o Atualizar do painel vem para cá, na linha do título. */}
          <div ref={setHeaderActions} className="shrink-0 empty:hidden" />
        </div>
        {activeWorkspace ? <SummaryPanel key={activeWorkspace.id} id={activeWorkspace.id} headerActions={headerActions} /> : <NoWorkspace />}
      </div>
    </DashboardLayout>
  );
}

function SummaryPanel({ id, headerActions }: { id: string; headerActions: HTMLDivElement | null }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { mask, scrub } = useMask();
  const mobile = useIsMobile();
  const [date, setDate] = useState<ResultDateSelection>(() => ({ range: resultPresetRange('today'), preset: 'today', compare: false }));
  const [filters, setFilters] = useState<SummaryFilters>(EMPTY_SUMMARY_FILTERS);
  const [draft, setDraft] = useState<SummaryLayout | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const data = useQuery({
    ...summaryQuery(id, date.range, filters, date.compare),
    placeholderData: (previous) => previous,
  });
  const layoutQuery = useQuery(summaryLayoutQuery(id));

  const onLayoutSaved = (title: string) => (next: Awaited<ReturnType<typeof summaryApi.layout>>) => {
    queryClient.setQueryData(['summary-layout', id], next);
    setDraft(null);
    setCollapsed({});
    toast({ title });
  };
  const fail = (error: Error) => toast({ title: 'Layout não salvo', description: error.message, variant: 'destructive' });
  const save = useMutation({
    mutationFn: (layout: SummaryLayout | SummaryLayoutV1) => summaryApi.saveLayout(id, layout.version === 2 ? cleanLayout(layout) : layout),
    onSuccess: onLayoutSaved('Layout salvo'),
    onError: fail,
  });
  const reset = useMutation({ mutationFn: () => summaryApi.resetLayout(id), onSuccess: onLayoutSaved('Layout padrão restaurado'), onError: fail });

  const response = data.data;
  const chartKeys = useMemo(() => new Set((response?.catalog.charts ?? []).map((c) => c.key)), [response]);
  const isChart = (key: string) => chartKeys.has(key);
  const savedLayout = layoutQuery.data?.layout;
  // A API já devolve v2; um layout v1 (servidor antigo, cache) abre convertido do mesmo jeito.
  const normalized = useMemo(
    () => (savedLayout && response ? normalizeLayout(savedLayout as SummaryLayout | SummaryLayoutV1, (k) => chartKeys.has(k)) : null),
    [savedLayout, response, chartKeys],
  );
  const editing = draft !== null;
  const layout = draft ?? normalized;
  const cardsByKey = useMemo(() => new Map((response?.cards ?? []).map((c) => [c.key, c])), [response]);
  const labels = useMemo(() => new Map([
    ...(response?.catalog.cards ?? []).map((c) => [c.key, c.label] as const),
    ...(response?.catalog.charts ?? []).map((c) => [c.key, c.label] as const),
  ]), [response]);
  const hints = useMemo(() => new Map([
    ...(response?.catalog.cards ?? []), ...(response?.catalog.charts ?? []),
  ].map((entry) => [entry.key, entry.hint])), [response]);
  const placedIn = useMemo(() => new Map(
    (layout?.sections ?? []).flatMap((s) => s.items.map((i) => [i.key, { sectionKey: s.key, title: s.title }] as const)),
  ), [layout]);

  const exportLayout = () => {
    if (!layout) return;
    const blob = new Blob([JSON.stringify(cleanLayout(layout), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dashzip-resultado-layout.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  const importLayout = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      // O arquivo pode ser v1 (antigo) ou v2: o servidor valida e grava sempre o v2.
      save.mutate(parsed.layout ?? parsed);
    } catch {
      toast({ title: 'Arquivo inválido', description: 'O arquivo não é um JSON de layout.', variant: 'destructive' });
    }
  };

  const edit = (fn: (l: SummaryLayout) => SummaryLayout) => setDraft((current) => (current ? fn(structuredClone(current)) : current));
  const editSection = (key: string, fn: (items: LayoutItem[]) => LayoutItem[]) =>
    edit((l) => ({ ...l, sections: l.sections.map((s) => (s.key === key ? { ...s, items: fn(s.items) } : s)) }));
  const moveSection = (index: number, delta: number) => edit((l) => {
    const target = index + delta;
    if (target < 0 || target >= l.sections.length) return l;
    [l.sections[index], l.sections[target]] = [l.sections[target], l.sections[index]];
    return l;
  });
  const addSection = () => edit((l) => ({
    ...l, sections: [...l.sections, { key: newSectionKey(l), title: 'Nova seção', collapsed: false, items: [] }],
  }));
  const removeSection = (key: string) => edit((l) => ({ ...l, sections: l.sections.filter((s) => s.key !== key) }));
  const pick = (sectionKey: string, key: string) => {
    edit((l) => {
      if (l.sections.some((s) => s.key !== sectionKey && s.items.some((i) => i.key === key))) return moveToSection(l, key, sectionKey);
      return { ...l, sections: l.sections.map((s) => (s.key === sectionKey ? { ...s, items: appendItem(s.items, key, defaultSize(key, chartKeys.has(key))) } : s)) };
    });
    setAdding(null);
  };
  const addingSection = layout?.sections.find((s) => s.key === adding);

  const renderBody = (item: LayoutItem) => isChart(item.key)
    ? <ChartCard chartKey={item.key as ChartKey} label={labels.get(item.key) ?? item.key} hint={hints.get(item.key)} points={response?.charts[item.key as ChartKey] ?? []} />
    : <MetricCard card={cardsByKey.get(item.key)} label={labels.get(item.key) ?? item.key} hint={hints.get(item.key)} compare={date.compare} />;

  const refreshButton = (
    <Button
      size="sm"
      variant="outline"
      className="h-10 sm:h-9"
      onClick={() => void data.refetch()}
      disabled={data.isFetching}
    >
      <RefreshCw className={cn('h-4 w-4', data.isFetching && 'animate-spin')} aria-hidden="true" />
      Atualizar
    </Button>
  );

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        {/* Celular: grade de 2 colunas (data em largura total); desktop: em linha. */}
        <div className="grid w-full grid-cols-2 items-end gap-2 sm:flex sm:w-auto sm:flex-wrap sm:gap-3">
          <div className="col-span-2 min-w-[9rem] max-w-full space-y-1 sm:col-span-1">
            <p className="text-xs font-medium text-muted-foreground">Data</p>
            <ResultDatePicker value={date} onApply={setDate} />
          </div>
          <FilterPick
            label="Contas" all="Todas as contas" value={filters.accountIds}
            options={(response?.filters.accounts ?? []).map(({ id, name, currency }) => {
              const accountNumber = id.replace(/^act_/, '');
              return {
                id,
                name: mask('account', name ?? accountNumber),
                detail: [name ? mask('id', accountNumber) : null, currency].filter(Boolean).join(' · '),
              };
            })}
            onChange={(accountIds) => setFilters({ ...filters, accountIds })}
          />
          <FilterPick
            label="Produtos" all="Todos os produtos" value={filters.products}
            options={(response?.filters.products ?? []).map((p) => ({ id: p, name: mask('product', p) }))}
            onChange={(products) => setFilters({ ...filters, products })}
          />
          <FilterPick
            label="Checkouts" all="Todos os checkouts" value={filters.platforms}
            options={(response?.filters.platforms ?? []).map((p) => ({ id: p, name: findTrackingPlatform(p)?.name ?? p }))}
            onChange={(platforms) => setFilters({ ...filters, platforms })}
          />
          {!editing && (
            <Button
              size="icon"
              variant="outline"
              className="justify-self-start sm:h-9 sm:w-9"
              disabled={!layout}
              onClick={() => layout && setDraft(structuredClone(layout))}
              aria-label="Personalizar"
              title="Personalizar"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {editing && (
            <>
              <Button size="sm" variant="ghost" onClick={exportLayout}><Download className="mr-1.5 h-4 w-4" /> Exportar</Button>
              <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}><Upload className="mr-1.5 h-4 w-4" /> Importar</Button>
              <input
                ref={fileRef} type="file" accept="application/json,.json" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void importLayout(f); e.target.value = ''; }}
              />
              <Button size="sm" variant="ghost" onClick={() => reset.mutate()} disabled={reset.isPending}><RotateCcw className="mr-1.5 h-4 w-4" /> Restaurar padrão</Button>
              <Button size="sm" variant="outline" onClick={() => setDraft(null)} disabled={save.isPending}>Cancelar</Button>
              <Button size="sm" onClick={() => draft && save.mutate(draft)} disabled={save.isPending}>{save.isPending ? 'Salvando...' : 'Salvar layout'}</Button>
            </>
          )}
          {!(mobile && headerActions) && refreshButton}
        </div>
        {mobile && headerActions && createPortal(refreshButton, headerActions)}
      </div>

      {editing && (
        <p className="text-xs text-muted-foreground">
          {mobile
            ? 'Use o menu de cada card para mover entre linhas e seções. Para arrastar e redimensionar, abra numa tela maior.'
            : 'Arraste o card para mudar de lugar (também para outra seção) e puxe a alça do canto inferior direito para mudar o tamanho. Com o card focado, as setas movem e Shift + setas redimensionam.'}
        </p>
      )}
      {response && (filters.products.length > 0 || filters.platforms.length > 0) && (
        <p className="text-xs text-muted-foreground">Filtro de produto ou checkout não filtra o gasto</p>
      )}
      {response?.warnings.map((w) => <p key={w} className="rounded-lg border border-border bg-foreground/5 px-3 py-2 text-sm">{scrub(w)}</p>)}
      {(data.isPending || layoutQuery.isPending) && <RouteFallback label="Carregando o resultado" />}
      {data.isError && <p role="alert" className="text-sm text-destructive">{scrub(data.error.message)}</p>}
      {layoutQuery.isError && <p role="alert" className="text-sm text-destructive">{layoutQuery.error.message}</p>}

      {response && layout && (
        <div className={cn('space-y-6', data.isFetching && 'opacity-70 transition-opacity')}>
          {layout.sections.map((section, s) => {
            const isCollapsed = editing ? false : (collapsed[section.key] ?? section.collapsed);
            const otherSections = layout.sections.filter((o) => o.key !== section.key).map((o) => ({ key: o.key, title: o.title }));
            const renderEditable = (item: LayoutItem) => (
              <EditFrame
                label={labels.get(item.key) ?? item.key}
                sections={otherSections}
                draggable={!mobile}
                onNudge={(dx, dy) => editSection(section.key, (items) => nudgeItem(items, item.key, dx, dy))}
                onResize={(dw, dh) => editSection(section.key, (items) => resizeItem(items, item.key, dw, dh))}
                onMoveTo={(target) => edit((l) => moveToSection(l, item.key, target))}
                onHide={() => editSection(section.key, (items) => compactItems(items.filter((i) => i.key !== item.key)))}
              >
                {renderBody(item)}
              </EditFrame>
            );
            return (
              <section
                key={section.key} aria-labelledby={`section-${section.key}`} data-section-drop={editing ? section.key : undefined}
                className={cn(editing && 'rounded-xl border border-dashed border-border p-3 transition-colors', dropTarget === section.key && 'border-primary bg-primary/5')}
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {editing ? (
                    <>
                      <Input
                        id={`section-${section.key}`}
                        value={section.title} maxLength={60} className="h-8 max-w-xs" aria-label="Título da seção"
                        onChange={(e) => edit((l) => { l.sections[s].title = e.target.value; return l; })}
                      />
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <input type="checkbox" className="accent-primary" checked={section.collapsed}
                          onChange={(e) => edit((l) => { l.sections[s].collapsed = e.target.checked; return l; })} />
                        Começa recolhida
                      </label>
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Subir seção" disabled={s === 0} onClick={() => moveSection(s, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Descer seção" disabled={s === layout.sections.length - 1} onClick={() => moveSection(s, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="outline" className="h-7" onClick={() => setAdding(section.key)}><Plus className="mr-1 h-3.5 w-3.5" /> Adicionar card</Button>
                      {layout.sections.length > 1 && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Remover seção" title="Remover seção (os cards dela voltam para o catálogo)" onClick={() => removeSection(section.key)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </>
                  ) : (
                    <button
                      type="button" id={`section-${section.key}`} aria-expanded={!isCollapsed}
                      className="-my-2 inline-flex min-h-10 items-center gap-1 text-sm font-semibold"
                      onClick={() => setCollapsed({ ...collapsed, [section.key]: !isCollapsed })}
                    >
                      {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      {section.title}
                    </button>
                  )}
                </div>
                {!isCollapsed && (
                  <>
                    {section.items.length === 0 && (
                      <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
                        {editing ? 'Seção vazia. Arraste um card para cá ou use Adicionar card.' : 'Seção vazia.'}
                      </p>
                    )}
                    {editing && !mobile ? (
                      <EditGrid
                        sectionKey={section.key}
                        items={section.items}
                        render={renderEditable}
                        onHoverSection={(key) => setDropTarget((current) => (current === key ? current : key))}
                        onChange={(next) => editSection(section.key, (items) => {
                          const current = new Set(items.map((i) => i.key));
                          const moved = new Map(next.filter((n) => current.has(n.key)).map((n) => [n.key, n]));
                          return items.map((i) => moved.get(i.key) ?? i);
                        })}
                        onDropElsewhere={(key, target, at) => edit((l) => moveToSection(l, key, target, at))}
                      />
                    ) : section.items.length > 0 && (
                      <StaticGrid items={section.items} mobile={mobile} render={editing ? renderEditable : renderBody} />
                    )}
                  </>
                )}
              </section>
            );
          })}
          {editing && (
            <Button size="sm" variant="outline" onClick={addSection} disabled={layout.sections.length >= 12}>
              <Plus className="mr-1.5 h-4 w-4" /> Nova seção
            </Button>
          )}
        </div>
      )}

      {response && addingSection && (
        <AddCardDialog
          open={!!addingSection}
          onOpenChange={(open) => { if (!open) setAdding(null); }}
          sectionTitle={addingSection.title}
          targetSection={addingSection.key}
          catalog={response.catalog}
          placedIn={placedIn}
          onPick={(key) => pick(addingSection.key, key)}
        />
      )}
    </>
  );
}

function FilterPick({ label, all, options, value, onChange }: {
  label: string;
  all: string;
  options: { id: string; name: string; detail?: string }[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  // Lista vazia = todos (é o que o servidor entende). Na tela, "todos" aparecem marcados;
  // desmarcar um a partir daí deixa os outros, e marcar o último volta a ser "todos".
  const ids = options.map((o) => o.id);
  const active = value.filter((v) => ids.includes(v));
  const allOn = active.length === 0 || active.length === ids.length;
  const isOn = (id: string) => allOn || active.includes(id);
  const selectedCount = allOn ? ids.length : active.length;
  const toggle = (id: string, on: boolean) => {
    const current = allOn ? ids : active;
    const next = on ? [...current, id] : current.filter((v) => v !== id);
    onChange(next.length === 0 || next.length === ids.length ? [] : next);
  };
  return (
    <div className="min-w-0 max-w-full space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="h-10 w-full max-w-full justify-between gap-1.5 font-normal sm:h-9 sm:w-auto" aria-label={label}>
            <span className="min-w-0 truncate">{allOn ? all : `${label}: ${active.length}`}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
          {options.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">Nada no período</p>}
          {options.map((o) => (
            <DropdownMenuCheckboxItem
              key={o.id} checked={isOn(o.id)} onSelect={(e) => e.preventDefault()}
              disabled={isOn(o.id) && selectedCount === 1}
              onCheckedChange={(on) => toggle(o.id, on)}
            >
              <span className="min-w-0">
                <span className="block truncate" title={o.name}>{o.name}</span>
                {o.detail && <span className="block truncate text-xs text-muted-foreground">{o.detail}</span>}
              </span>
            </DropdownMenuCheckboxItem>
          ))}
          {!allOn && <DropdownMenuItem onSelect={() => onChange([])}>Marcar todos</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function MetricCard({ card, label, hint, compare }: { card: SummaryCard | undefined; label: string; hint?: string; compare: boolean }) {
  const value = card?.value ?? null;
  const change = compare && card ? variation(value, card.previous) : null;
  const better = change === null || change === 0 ? null : (change > 0) !== LOWER_IS_BETTER.has(card!.key);
  // Cor do valor: ganho/perda de Lucro, Margem, ROI e ROAS; nos demais, dinheiro negativo em vermelho.
  const tone = card ? gainTone(card.key, value) : null;
  const negativeMoney = !tone && card?.unit === 'BRL' && value !== null && value < 0;
  return (
    <Card className="h-full overflow-hidden">
      <CardContent className="space-y-1 p-4">
        <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <p className="truncate" title={label}>{label}</p>
          {hint && <MetricInfo label={label} hint={hint} />}
        </div>
        <p className={cn('truncate text-lg font-semibold tabular-nums tracking-tight sm:text-xl', tone && TONE_CLASS[tone], negativeMoney && 'text-destructive')}>
          {card ? formatCardValue(card.key, value, card.unit) : '—'}
        </p>
        {compare && card?.previous !== undefined && (
          <p className="truncate text-xs text-muted-foreground">
            {change === null ? (
              <>Anterior {formatCardValue(card.key, card.previous ?? null, card.unit)}</>
            ) : change === 0 ? 'Sem variação' : (
              <span className={cn('inline-flex items-center gap-0.5', better === true && 'text-success', better === false && 'text-destructive')}>
                {change > 0 ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />}
                {formatUnit(Math.abs(change), 'pct')} {change > 0 ? 'acima' : 'abaixo'} do anterior
              </span>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

const REVENUE: Series = { key: 'revenue', label: 'Faturamento', color: 'var(--viz-1)' };
const SPEND: Series = { key: 'spend', label: 'Gasto', color: 'var(--viz-2)' };
const PROFIT: Series = { key: 'profit', label: 'Lucro', color: 'var(--viz-3)' };

function salesDetail(p: SeriesPoint) {
  const n = typeof p.sales === 'number' ? p.sales : 0;
  return `${n} ${n === 1 ? 'venda' : 'vendas'}`;
}

/** Gráfico que ocupa a altura do card na grade (a legenda das linhas fica acima). */
function SizedChart({ children }: { children: (height: number) => ReactNode }) {
  const [ref, box] = useBox<HTMLDivElement>();
  return <div ref={ref} className="h-full min-h-[140px]">{box.height > 0 && children(Math.max(box.height, 140))}</div>;
}

function ChartCard({ chartKey, label, hint, points: rawPoints }: { chartKey: ChartKey; label: string; hint?: string; points: SeriesPoint[] }) {
  const { enabled, mask } = useMask();
  // Modo streaming: o nome do produto é a legenda, o eixo e o tooltip do gráfico.
  const points = enabled && chartKey === 'byProduct' ? rawPoints.map((p) => ({ ...p, label: mask('product', p.label) })) : rawPoints;
  let body: ReactNode;
  let scroll = true;
  switch (chartKey) {
    case 'hourly':
      scroll = false;
      body = (
        <SizedChart>{(h) => (
          <LineChart
            points={points} unit="BRL" height={h - 28}
            series={[{ ...REVENUE, key: 'revenueCum' }, { ...SPEND, key: 'spendCum' }, { ...PROFIT, key: 'profitCum' }]}
          />
        )}</SizedChart>
      );
      break;
    case 'daily':
      scroll = false;
      body = <SizedChart>{(h) => <LineChart points={points} unit="BRL" height={h - 28} series={[REVENUE, SPEND, PROFIT]} formatX={shortDate} />}</SizedChart>;
      break;
    case 'funnelMeta':
    case 'funnelTracking':
      body = <FunnelFlow points={points} />;
      break;
    case 'byHour':
    case 'byDayOfWeek':
      scroll = false;
      body = (
        <SizedChart>{(h) => (
          <ColumnChart
            points={points} valueKey="revenue" unit="BRL" detail={salesDetail} height={h}
            formatX={chartKey === 'byDayOfWeek' ? (l) => l.slice(0, 3) : undefined}
          />
        )}</SizedChart>
      );
      break;
    case 'byCountry':
    case 'byState':
      scroll = false;
      body = <GeoCard kind={chartKey === 'byCountry' ? 'country' : 'state'} points={points} />;
      break;
    case 'approvalRate':
      body = <ApprovalCard points={points} />;
      break;
    case 'byPaymentMethod':
      body = (
        <BarList
          points={points} valueKey="revenue" unit="BRL"
          detail={(p) => `${typeof p.approved === 'number' ? p.approved : 0} aprovados · ${typeof p.pending === 'number' ? p.pending : 0} pendentes`}
        />
      );
      break;
    default:
      body = <BarList points={points} valueKey="revenue" unit="BRL" detail={salesDetail} />;
  }
  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="p-4 pb-2">
        <div className="flex min-w-0 items-center gap-1">
          <CardTitle className="truncate text-sm font-medium" title={label}>{label}</CardTitle>
          {hint && <MetricInfo label={label} hint={hint} />}
        </div>
      </CardHeader>
      <CardContent className={cn('min-h-0 flex-1 px-4 pb-4 pt-0', scroll ? 'overflow-auto' : 'overflow-hidden')}>{body}</CardContent>
    </Card>
  );
}
