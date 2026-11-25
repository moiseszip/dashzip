import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import * as Popover from '@radix-ui/react-popover';
import { ArrowDown, ArrowUp, History, Layers, SlidersHorizontal, X } from 'lucide-react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { NoWorkspace } from '@/components/NoWorkspace';
import { BudgetDialog } from '@/components/campaigns/BudgetDialog';
import {
  CampaignActionsMenu, CampaignStatusIcon, StatusConfirmDialog, budgetText, type ControlRow,
} from '@/components/campaigns/CampaignRowControls';
import { ResultDatePicker } from '@/components/summary/ResultDatePicker';
import { ColumnResizeHandle } from '@/components/table/ColumnResizeHandle';
import { TablePagination } from '@/components/table/TablePagination';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { useMask } from '@/contexts/StreamingModeContext';
import { Masked, StreamingHidden } from '@/components/Masked';
import { useColumnWidth } from '@/hooks/useColumnWidth';
import { useToast } from '@/hooks/use-toast';
import { actionErrorMessage, campaignsApi, formatCurrency, type ActionItem, type RowPatch } from '@/lib/campaigns';
import { displayDate, formatBRL, newId } from '@/lib/costs';
import { presetSelection, type ResultDateSelection } from '@/lib/resultDates';
import { formatUnit, summaryApi } from '@/lib/summary';
import {
  DEFAULT_FILTERS, MAX_SORT_RULES, METRICS, PAGE_SIZE, SORT_FIELDS, SORT_PRESETS, UNASSIGNED,
  activeFilterCount, addCells, cleanFilters, filterItems, groupByOffer, metricOf, paginate, sortItems, toggleHeaderSort,
  type Condition, type MetricKey, type Operator, type SortKey, type SortRule, type TestFilters, type TestItem,
} from '@/lib/testFilters';
import { groupDays, sumTestCells, testsApi, type TestCell, type TestChange, type TestOffer, type TestRow } from '@/lib/testTracking';
import { cn } from '@/lib/utils';

import { GRID_TABLE } from '@/components/table/gridTable';
import { getActiveTimezone } from '@/lib/timezone';
import { testChangesQuery, testMatrixQuery } from '@/lib/pageQueries';
const selectClass = 'h-9 rounded-md border border-input bg-background px-2 text-sm';
/** Data e hora no fuso do painel ativo. */
const dateFormatter = { format: (date: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: getActiveTimezone(), dateStyle: 'short', timeStyle: 'short' }).format(date) };
const OPERATORS: Operator[] = ['>=', '>', '=', '<', '<='];
const OPERATOR_LABEL: Record<Operator, string> = { '>=': '≥', '>': '>', '=': '=', '<': '<', '<=': '≤' };
/** Larguras fixas das colunas grudadas à esquerda (desktop): ⋮ e Status. */
const MENU_W = 44;
const STATUS_W = 44;
/** Colunas travadas depois da Campanha: Lucro e ROI. */
const PROFIT_W = 120;
const ROI_W = 80;

type MatrixData = Awaited<ReturnType<typeof testsApi.matrix>>;

function controlRow(row: TestRow): ControlRow {
  return { ...row, level: 'campaign' };
}

/** Quem fez a mudança: "Meta" e "dash.zip" não são pessoas e ficam à mostra. */
const SYSTEM_ACTORS = new Set(['Meta', 'dash.zip']);
type ChangeLevel = 'campaign' | 'adset' | 'ad';
/** "Sem oferta" e "Oferta removida" não são nomes de oferta. */
const GENERIC_OFFERS = new Set(['Sem oferta', 'Oferta removida', 'Sem oferta (código não cadastrado)']);

function changeLabel(change: TestChange, currency: string) {
  if (change.kind === 'budget') return `Orçamento ${formatCurrency(change.from ?? null, currency)} → ${formatCurrency(change.to ?? null, currency)}`;
  return change.kind === 'paused' ? 'Pausou' : 'Ativou';
}

function filtersKey(workspaceId: string) {
  return `dashzip:tests:filters:${workspaceId}`;
}

function readFilters(workspaceId: string): TestFilters {
  try {
    const raw = localStorage.getItem(filtersKey(workspaceId));
    return raw ? cleanFilters(JSON.parse(raw)) : DEFAULT_FILTERS;
  } catch {
    return DEFAULT_FILTERS;
  }
}

function writeFilters(workspaceId: string, filters: TestFilters) {
  // A ordenação por coluna de período depende das datas e não fica salva.
  const sort = filters.sort.filter((rule) => !rule.key.startsWith('period:'));
  try { localStorage.setItem(filtersKey(workspaceId), JSON.stringify({ ...filters, sort })); } catch { /* sem storage */ }
}

function ProfitCell({ cell, scale, strong }: { cell: TestCell; scale: number; strong?: boolean }) {
  const roi = metricOf(cell, 'roi');
  const hue = (cell.profit ?? 0) < 0 ? 'var(--destructive)' : 'var(--success)';
  const strength = Math.min(1, Math.abs(cell.profit ?? 0) / scale);
  const detail = [
    `Gasto ${formatBRL(cell.spend)}`, `Custo de mídia ${formatBRL(cell.mediaTax)}`, `Faturamento ${formatBRL(cell.grossRevenue)}`,
    `Vendas ${cell.sales}`, `ROI ${formatRoi(roi)}`, `Margem ${formatUnit(metricOf(cell, 'margin'), 'pct')}`,
    `CPC ${formatBRL(metricOf(cell, 'cpc'))}`, `CPM ${formatBRL(metricOf(cell, 'cpm'))}`,
    `CPA ${formatBRL(metricOf(cell, 'cpa'))}`, `IC ${cell.initiateCheckouts ?? '—'}`,
  ].join('\n');
  return (
    <td className={cn('whitespace-nowrap border-b border-l border-border px-4 py-3 text-right tabular-nums', strong && 'font-medium')}
      style={strength ? { backgroundColor: `hsl(${hue} / ${0.08 + 0.24 * strength})` } : undefined}
      title={detail}>
      {formatBRL(cell.profit)}
    </td>
  );
}

/** Lucro e ROI, travados à esquerda junto da Campanha. */
function FrozenTotals({ cell, left, className }: { cell: TestCell; left: number; className?: string }) {
  const profit = cell.profit ?? 0;
  return <>
    <td className={cn('whitespace-nowrap border-b border-border px-4 py-3 text-right font-medium tabular-nums sm:sticky z-10 bg-background', profit > 0 && 'text-success', profit < 0 && 'text-destructive', className)}
      style={{ left, width: PROFIT_W, minWidth: PROFIT_W }}>{formatBRL(cell.profit)}</td>
    <td className={cn('whitespace-nowrap border-b border-r border-border px-4 py-3 text-right tabular-nums sm:sticky z-10 bg-background', roiClass(metricOf(cell, 'roi')), className)}
      style={{ left: left + PROFIT_W, width: ROI_W, minWidth: ROI_W }}>{formatRoi(metricOf(cell, 'roi'))}</td>
  </>;
}

/** Gasto e vendas, na parte que rola. */
function ScrollTotals({ cell }: { cell: TestCell }) {
  return <>
    <td className="whitespace-nowrap border-b border-border px-4 py-3 text-right tabular-nums">{formatBRL(cell.spend)}</td>
    <td className="whitespace-nowrap border-b border-border px-4 py-3 text-right tabular-nums">{cell.sales}</td>
  </>;
}

function SortHeader({ label, sortKey, sort, onSort, align = 'right', hint }: {
  label: string; sortKey: SortKey; sort: SortRule[]; onSort: (key: SortKey) => void; align?: 'left' | 'right'; hint?: string;
}) {
  const index = sort.findIndex((rule) => rule.key === sortKey);
  const rule = sort[index];
  const Icon = rule?.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button type="button" onClick={() => onSort(sortKey)} title={hint ?? `Ordenar por ${label}`}
      className={cn('inline-flex items-center gap-1 whitespace-nowrap hover:text-foreground', align === 'right' && 'flex-row-reverse', rule && 'text-foreground')}
      aria-label={`Ordenar por ${label}${rule ? (rule.dir === 'asc' ? ', crescente' : ', decrescente') : ''}`}>
      {label}
      {rule && <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />}
      {rule && sort.length > 1 && <span className="text-[10px] tabular-nums text-muted-foreground">{index + 1}</span>}
    </button>
  );
}

export default function TestTracking() {
  const { activeWorkspace } = useWorkspaceContext();
  return (
    <DashboardLayout wide>
      <div className="space-y-5">
        <header>
          <h1 className="text-xl font-semibold">Acompanhamento de testes</h1>
          {activeWorkspace && <p className="mt-1 text-sm text-muted-foreground"><Masked kind="workspace" value={activeWorkspace.name} /></p>}
        </header>
        {activeWorkspace ? <TestPanel key={activeWorkspace.id} id={activeWorkspace.id} /> : <NoWorkspace />}
      </div>
    </DashboardLayout>
  );
}

function TestPanel({ id }: { id: string }) {
  const { toast } = useToast();
  // Modo streaming: nomes de campanha, conta e oferta viram apelido (inclusive em filtros, diálogos e toasts).
  const { mask, scrub } = useMask();
  const offerName = (name: string | undefined) => (name && GENERIC_OFFERS.has(name) ? name : mask('offer', name));
  const client = useQueryClient();
  const [date, setDate] = useState<ResultDateSelection>(() => presetSelection('last7'));
  const [grain, setGrain] = useState<'day' | 'week' | 'month'>('day');
  const [filters, setFiltersState] = useState<TestFilters>(() => readFilters(id));
  const [pageState, setPageState] = useState({ key: '', page: 1 });
  const [offersOpen, setOffersOpen] = useState(false);
  const [budget, setBudget] = useState<ControlRow | null>(null);
  const [statusTarget, setStatusTarget] = useState<{ row: ControlRow; action: 'pause' | 'activate' } | null>(null);
  const [history, setHistory] = useState<TestRow | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const column = useColumnWidth('tests:campaign', 280);

  const setFilters = (next: Partial<TestFilters>) => setFiltersState((current) => {
    const merged = { ...current, ...next };
    writeFilters(id, merged);
    return merged;
  });

  const period = date.range;
  const matrixOptions = testMatrixQuery(id, period);
  const matrixKey = matrixOptions.queryKey;
  // Trocar o período mantém a matriz na tela enquanto chega a nova.
  const matrix = useQuery({ ...matrixOptions, placeholderData: (previous) => previous });
  const changes = useQuery(testChangesQuery(id));
  const data = matrix.data;
  const singleOffer = filters.offers.length === 1 ? data?.offers.find((item) => item.id === filters.offers[0]) : undefined;
  const products = singleOffer?.products ?? [];
  const health = useQuery({
    queryKey: ['test-checkout-health', id, period, products],
    queryFn: () => summaryApi.get(id, period, { accountIds: [], platforms: [], products }, false),
    enabled: products.length > 0,
  });

  const groups = useMemo(() => groupDays(data?.days ?? [], grain), [data?.days, grain]);
  const allItems = useMemo<TestItem[]>(() => (data?.rows ?? []).map((row) => ({
    row,
    total: sumTestCells(row, data?.days ?? []),
    cells: Object.fromEntries(groups.map((group) => [group.key, sumTestCells(row, group.dates)])),
  })), [data, groups]);
  const filtered = useMemo(() => sortItems(filterItems(allItems, filters), filters.sort), [allItems, filters]);
  const offerGroups = useMemo(
    () => (filters.groupByOffer ? groupByOffer(filtered, data?.offers ?? [], filters.sort) : null),
    [filtered, filters.groupByOffer, filters.sort, data?.offers],
  );
  const ordered = offerGroups ? offerGroups.flatMap((group) => group.items) : filtered;
  const groupOf = new Map(offerGroups?.map((group) => [group.offerId, group]) ?? []);
  const pageKey = JSON.stringify([filters, period, grain]);
  const page = paginate(ordered, pageState.key === pageKey ? pageState.page : 1);
  const totals = useMemo(() => ({
    total: addCells(filtered.map((item) => item.total)),
    cells: Object.fromEntries(groups.map((group) => [group.key, addCells(filtered.map((item) => item.cells[group.key]))])),
  }), [filtered, groups]);
  const scale = filtered.reduce((max, item) => Object.values(item.cells).reduce((current, cell) => Math.max(current, Math.abs(cell.profit ?? 0)), max), 1);
  const historyItems = history ? (changes.data?.changes[history.id] ?? []).slice(0, 5) : [];
  const onSort = (key: SortKey) => setFilters({ sort: toggleHeaderSort(filters.sort, key) });

  const offerCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of allItems) counts.set(item.row.offerId ?? UNASSIGNED, (counts.get(item.row.offerId ?? UNASSIGNED) ?? 0) + 1);
    return counts;
  }, [allItems]);

  const action = useMutation({
    mutationFn: async ({ item }: { item: ActionItem; label: string }) => {
      const response = await campaignsApi.actions(id, [item]);
      const result = response.results[0];
      if (!result?.ok) throw new Error(actionErrorMessage(result?.code, result?.message));
      return result.row;
    },
    onMutate: ({ item }) => setPendingId(item.objectId),
    onSettled: () => setPendingId(null),
    onSuccess: (patch: RowPatch | undefined, { item, label }) => {
      if (patch) {
        client.setQueryData<MatrixData>(matrixKey, (current) => current && ({
          ...current, rows: current.rows.map((row) => (row.id === item.objectId ? { ...row, ...patch } : row)),
        }));
      }
      setBudget(null);
      setStatusTarget(null);
      void client.invalidateQueries({ queryKey: ['test-matrix', id] });
      void client.invalidateQueries({ queryKey: ['test-changes', id] });
      void client.invalidateQueries({ queryKey: ['campaigns', id] });
      toast({ title: label });
    },
    onError: (error: Error & { body?: { code?: string } }) =>
      toast({ title: 'Alteração não concluída', description: actionErrorMessage(error.body?.code, error.message), variant: 'destructive' }),
  });

  const leftCols = 3;
  // Posições das colunas travadas: menu, status, Campanha (largura ajustável), Lucro e ROI.
  const nameLeft = MENU_W + STATUS_W;
  const profitLeft = nameLeft + column.width;
  const periodColumns = groups.length;
  const stickyHead = 'z-30 bg-background';
  const stickyCell = 'sm:sticky z-10 bg-background';

  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-full min-w-[9rem] space-y-1 sm:w-56">
          <p className="text-xs font-medium text-muted-foreground">Data</p>
          <ResultDatePicker value={date} onApply={setDate} showCompare={false} />
        </div>
        <label className="space-y-1">
          <span className="block text-xs font-medium text-muted-foreground">Colunas</span>
          <select aria-label="Colunas por" className={selectClass} value={grain} onChange={(e) => setGrain(e.target.value as typeof grain)}>
            <option value="day">Dia</option><option value="week">Semana</option><option value="month">Mês</option>
          </select>
        </label>
        <label className="order-last w-full min-w-0 space-y-1 sm:order-none sm:w-auto sm:min-w-[14rem] sm:max-w-xs sm:flex-1">
          <span className="block text-xs font-medium text-muted-foreground">Busca</span>
          <Input aria-label="Buscar campanha" placeholder="Nome ou ID · vírgula = ou · -termo exclui" value={filters.search}
            onChange={(e) => setFilters({ search: e.target.value })} className="h-9" />
        </label>
        <FiltersPopover
          filters={filters}
          setFilters={setFilters}
          offers={(data?.offers ?? []).map((offer) => ({ ...offer, name: offerName(offer.name) ?? offer.name }))}
          offerCounts={offerCounts}
          accounts={(data?.accounts ?? []).map((account) => ({ ...account, name: mask('account', account.name) }))}
          periodOptions={groups.map((group) => ({ key: `period:${group.key}` as SortKey, label: `Lucro de ${group.label}` }))}
          resultCount={filtered.length}
        />
        <Button type="button" size="sm" variant="outline" aria-pressed={filters.groupByOffer}
          className={cn('h-9', filters.groupByOffer && 'border-primary bg-primary/10')}
          onClick={() => setFilters({ groupByOffer: !filters.groupByOffer })}>
          <Layers className="mr-1.5 h-4 w-4" aria-hidden="true" />Agrupar por oferta
        </Button>
        <Button variant="outline" size="sm" className="h-9" disabled={!data} onClick={() => setOffersOpen(true)}>Editar ofertas</Button>
      </div>

      {matrix.isPending && <p role="status" className="text-sm text-muted-foreground">Carregando acompanhamento…</p>}
      {matrix.isError && <p role="alert" className="text-sm text-destructive">{scrub(matrix.error.message)}</p>}
      {changes.isError && <p role="alert" className="text-sm text-muted-foreground">Histórico de alterações indisponível.</p>}
      {[...new Set([...(data?.warnings ?? []), ...(changes.data?.warnings ?? [])])].map((warning) =>
        <p key={warning} className="text-sm text-muted-foreground">{scrub(warning)}</p>,
      )}
      {data && <p className="text-xs text-muted-foreground">
        {displayDate(data.since)} a {displayDate(data.until)} · {filtered.length} de {allItems.length} campanhas
        {offerGroups && ` em ${offerGroups.length} ${offerGroups.length === 1 ? 'oferta' : 'ofertas'}`}
        {data.untrackedSales.count > 0 && ` · ${data.untrackedSales.count} vendas sem atribuição`}.
        O lucro considera as vendas recebidas desde a integração de cada checkout.
      </p>}
      {data?.accounts.length === 0 && <Button asChild variant="outline"><Link to="/integrations">Vincular contas em Integrações</Link></Button>}
      {data && data.accounts.length > 0 && filtered.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma campanha no período com esses filtros.</p>}

      {filtered.length > 0 && <div className="space-y-2">
        <div className="max-h-[70vh] max-w-full overflow-auto overscroll-x-contain rounded-xl border border-border">
          <table className={cn('w-max min-w-full border-separate border-spacing-0 text-sm', GRID_TABLE)}>
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className={cn('sticky top-0 border-b border-border px-1 py-2 sm:left-0', stickyHead)} style={{ width: MENU_W, minWidth: MENU_W }}>
                  <span className="sr-only">Ações</span>
                </th>
                <th className={cn('sticky top-0 border-b border-border px-1 py-3 text-center', stickyHead)} style={{ left: MENU_W, width: STATUS_W, minWidth: STATUS_W }}>
                  <SortHeader label="●" sortKey="status" sort={filters.sort} onSort={onSort} align="left" hint="Ordenar por status" />
                </th>
                <th className={cn('sticky top-0 border-b border-border px-4 py-3', stickyHead)}
                  style={{ left: nameLeft, width: column.width, minWidth: column.width, maxWidth: column.width }}>
                  <div className="relative">
                    <SortHeader label="Campanha" sortKey="name" sort={filters.sort} onSort={onSort} align="left" />
                    <ColumnResizeHandle label="Largura da coluna Campanha" width={column.width} min={column.min} max={column.max}
                      fallback={column.fallback} onPreview={column.preview} onCommit={column.commit} />
                  </div>
                </th>
                <th className={cn('sticky top-0 border-b border-border px-4 py-3 text-right', stickyHead)} style={{ left: profitLeft, width: PROFIT_W, minWidth: PROFIT_W }}>
                  <SortHeader label="Lucro" sortKey="profit" sort={filters.sort} onSort={onSort} />
                </th>
                <th className={cn('sticky top-0 border-b border-r border-border px-4 py-3 text-right', stickyHead)} style={{ left: profitLeft + PROFIT_W, width: ROI_W, minWidth: ROI_W }}>
                  <SortHeader label="ROI" sortKey="roi" sort={filters.sort} onSort={onSort} />
                </th>
                <th className="sticky top-0 z-20 whitespace-nowrap border-b border-border bg-background px-4 py-3">Última mudança</th>
                <th className="sticky top-0 z-20 border-b border-border bg-background px-4 py-3 text-right"><SortHeader label="Gasto" sortKey="spend" sort={filters.sort} onSort={onSort} /></th>
                <th className="sticky top-0 z-20 border-b border-border bg-background px-4 py-3 text-right"><SortHeader label="Vendas" sortKey="sales" sort={filters.sort} onSort={onSort} /></th>
                {groups.map((group) => (
                  <th key={group.key} className="sticky top-0 z-20 min-w-24 border-b border-border bg-background px-4 py-3 text-right">
                    <SortHeader label={group.label} sortKey={`period:${group.key}`} sort={filters.sort} onSort={onSort}
                      hint={`Ordenar pelo lucro de ${group.dates.map(displayDate).join(' · ')}`} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="bg-secondary font-medium">
                <td className={cn('border-b border-border bg-secondary sm:left-0', stickyCell)} />
                <td className={cn('border-b border-border bg-secondary', stickyCell)} style={{ left: MENU_W }} />
                <td className={cn('border-b border-border bg-secondary px-4 py-3', stickyCell)} style={{ left: nameLeft, maxWidth: column.width }}>
                  Total <span className="text-xs font-normal text-muted-foreground">({filtered.length})</span>
                </td>
                <FrozenTotals cell={totals.total} left={profitLeft} className="bg-secondary" />
                <td className="border-b border-border bg-secondary" />
                <ScrollTotals cell={totals.total} />
                {groups.map((group) => <ProfitCell key={group.key} cell={totals.cells[group.key]} scale={scale * Math.max(1, filtered.length / 3)} strong />)}
              </tr>
              {page.items.map((item, index) => {
                const { row, total } = item;
                const offerKey = row.offerId ?? UNASSIGNED;
                const previous = page.items[index - 1];
                const group = offerGroups && (!previous || (previous.row.offerId ?? UNASSIGNED) !== offerKey) ? groupOf.get(offerKey) : undefined;
                const latest = changes.data?.changes[row.id]?.[0];
                const busy = pendingId === row.id;
                const budgetLabel = row.budgetLevel === 'campaign' ? budgetText(row) : row.budgetLevel === 'adset' ? 'Orçamento nos conjuntos' : null;
                return [
                  group && (
                    <tr key={`group-${offerKey}`} className="bg-secondary">
                      <th scope="rowgroup" colSpan={leftCols} className={cn('border-b border-border px-4 py-3 text-left sm:left-0', stickyCell, 'bg-secondary')}>
                        <span className="font-semibold">{offerName(group.name)}</span>
                        <span className="ml-2 text-xs font-normal text-muted-foreground">{group.items.length} {group.items.length === 1 ? 'campanha' : 'campanhas'}</span>
                      </th>
                      <FrozenTotals cell={group.total} left={profitLeft} className="bg-secondary" />
                      <td className="border-b border-border" />
                      <ScrollTotals cell={group.total} />
                      {groups.map((col) => <ProfitCell key={col.key} cell={group.cells[col.key] ?? addCells([])} scale={scale * Math.max(1, group.items.length / 2)} strong />)}
                    </tr>
                  ),
                  <tr key={row.id} className="group/row">
                    <td className={cn('border-b border-border px-1 py-2 align-middle sm:left-0', stickyCell)}>
                      <CampaignActionsMenu
                        row={controlRow(row)}
                        busy={busy}
                        onStatus={(target, kind) => setStatusTarget({ row: target, action: kind })}
                        onBudget={setBudget}
                        extra={(changes.data?.changes[row.id]?.length ?? 0) > 0 && (
                          <DropdownMenuItem onSelect={() => setHistory(row)}><History className="mr-2 h-4 w-4" aria-hidden="true" />Últimas mudanças</DropdownMenuItem>
                        )}
                      />
                    </td>
                    <td className={cn('border-b border-border px-1 py-3 text-center', stickyCell)} style={{ left: MENU_W, width: STATUS_W, maxWidth: STATUS_W }}>
                      <CampaignStatusIcon status={row.status} effectiveStatus={row.effectiveStatus} busy={busy} />
                    </td>
                    <th scope="row" className={cn('border-b border-border px-4 py-3 text-left font-normal', stickyCell)}
                      style={{ left: nameLeft, width: column.width, minWidth: column.width, maxWidth: column.width }}>
                      <p className="truncate font-medium" title={mask('campaign', row.name)}>{mask('campaign', row.name)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {mask('account', row.accountName)}{budgetLabel && ` · ${budgetLabel}`}
                      </p>
                    </th>
                    <FrozenTotals cell={total} left={profitLeft} />
                    <td className="whitespace-nowrap border-b border-border px-4 py-3 text-xs">
                      {latest ? <button type="button" className="text-left text-primary hover:underline" onClick={() => setHistory(row)}>
                        {changeLabel(latest, row.accountCurrency)}<br />{dateFormatter.format(new Date(latest.at))}
                      </button> : changes.isPending ? 'Carregando…' : '—'}
                    </td>
                    <ScrollTotals cell={total} />
                    {groups.map((col) => <ProfitCell key={col.key} cell={item.cells[col.key]} scale={scale} />)}
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
        <TablePagination page={page.page} pages={page.pages} total={page.total} size={PAGE_SIZE} noun="campanhas"
          onPage={(next) => setPageState({ key: pageKey, page: next })} />
        {periodColumns > 0 && <p className="text-xs text-muted-foreground">
          Clique no cabeçalho para ordenar (de novo inverte, na terceira volta ao padrão). Arraste a borda da coluna Campanha para ajustar a largura.
        </p>}
      </div>}

      {products.length > 0 && <section className="space-y-3">
        <h2 className="text-sm font-semibold">Saúde do checkout · {offerName(singleOffer?.name)}</h2>
        {health.isPending && <p role="status" className="text-sm text-muted-foreground">Consultando vendas…</p>}
        {health.isError && <p role="alert" className="text-sm text-destructive">{scrub(health.error.message)}</p>}
        {health.data && <>
          <dl className="flex flex-wrap gap-5">{health.data.cards.filter((card) => ['pixConversion', 'refundRate', 'chargebackRate', 'avgTicket', 'pendingSales'].includes(card.key))
            .map((card) => <div key={card.key}><dt className="text-xs text-muted-foreground">{card.label}</dt><dd>{formatUnit(card.value, card.unit)}</dd></div>)}</dl>
          <ul className="space-y-1 text-xs text-muted-foreground">{health.data.charts.byPaymentMethod?.map((method) =>
            <li key={method.label}>{method.label} · {formatUnit(Number(method.approved ?? 0), 'int')} aprovadas · {formatUnit(Number(method.pending ?? 0), 'int')} pendentes</li>)}</ul>
        </>}
      </section>}

      {data && offersOpen && <OffersEditor id={id} offers={data.offers} onClose={() => setOffersOpen(false)} />}
      <BudgetDialog row={budget} busy={action.isPending} onClose={() => setBudget(null)} onConfirm={(row, kind, value) =>
        action.mutate({
          item: { objectId: row.id, level: 'campaign', action: kind === 'daily' ? 'set_daily_budget' : 'set_lifetime_budget', value },
          label: `Orçamento alterado para ${formatCurrency(value, row.accountCurrency)}${kind === 'daily' ? '/dia' : ''}`,
        })} />
      <StatusConfirmDialog target={statusTarget} busy={action.isPending} onCancel={() => setStatusTarget(null)} onConfirm={() => statusTarget && action.mutate({
        item: { objectId: statusTarget.row.id, level: 'campaign', action: statusTarget.action },
        label: statusTarget.action === 'pause' ? 'Campanha pausada na Meta' : 'Campanha ativada na Meta',
      })} />
      <Dialog open={!!history} onOpenChange={(open) => { if (!open) setHistory(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Últimas mudanças</DialogTitle></DialogHeader>
          <p className="break-words text-sm text-muted-foreground">{mask('campaign', history?.name)}</p>
          <ul className="space-y-3">{historyItems.map((change, index) => <li key={`${change.at}-${index}`} className="text-sm">
            {changeLabel(change, history?.accountCurrency ?? 'BRL')}{change.objectName && ` · ${mask((change as TestChange & { level?: ChangeLevel }).level ?? 'campaign', change.objectName)}`}
            <p className="text-xs text-muted-foreground">{dateFormatter.format(new Date(change.at))} · {SYSTEM_ACTORS.has(change.actor) ? change.actor : mask('person', change.actor)}</p>
          </li>)}</ul>
          {historyItems.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma mudança nos últimos 14 dias.</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}

function FiltersPopover({ filters, setFilters, offers, offerCounts, accounts, periodOptions, resultCount }: {
  filters: TestFilters;
  setFilters: (next: Partial<TestFilters>) => void;
  offers: TestOffer[];
  offerCounts: Map<string, number>;
  accounts: { id: string; name: string }[];
  periodOptions: { key: SortKey; label: string }[];
  resultCount: number;
}) {
  const count = activeFilterCount(filters);
  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  const offerOptions = [
    ...offers.map((offer) => ({ id: offer.id, name: offer.name, count: offerCounts.get(offer.id) ?? 0 })),
    ...((offerCounts.get(UNASSIGNED) ?? 0) > 0 || filters.offers.includes(UNASSIGNED)
      ? [{ id: UNASSIGNED, name: 'Sem oferta (código não cadastrado)', count: offerCounts.get(UNASSIGNED) ?? 0 }] : []),
  ];
  const sortFields = [...SORT_FIELDS.map((field) => ({ key: field.key as SortKey, label: field.label })), ...periodOptions];
  const updateRule = (index: number, next: Partial<SortRule>) =>
    setFilters({ sort: filters.sort.map((rule, position) => (position === index ? { ...rule, ...next } : rule)) });
  const updateCondition = (conditionId: string, next: Partial<Condition>) =>
    setFilters({ conditions: filters.conditions.map((condition) => (condition.id === conditionId ? { ...condition, ...next } : condition)) });
  const presetId = SORT_PRESETS.find((preset) => JSON.stringify(preset.sort) === JSON.stringify(filters.sort))?.id;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button type="button" size="sm" variant="outline" className="h-9">
          <SlidersHorizontal className="mr-1.5 h-4 w-4" aria-hidden="true" />Filtros e ordem
          <span className="ml-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-foreground/10 px-1.5 text-[11px] font-semibold tabular-nums">{count}</span>
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="bottom" align="end" sideOffset={6} collisionPadding={12}
          aria-label="Filtros e ordenação"
          className="z-50 flex max-h-[var(--radix-popover-content-available-height)] w-[560px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4">
            <section>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">Oferta</p>
                {filters.offers.length > 0 && <button type="button" className="text-xs text-primary hover:underline" onClick={() => setFilters({ offers: [] })}>Todas</button>}
              </div>
              {offerOptions.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma oferta cadastrada.</p> : (
                <ul className="grid gap-0.5 rounded-md border border-border p-1 sm:grid-cols-2">
                  {offerOptions.map((offer) => (
                    <li key={offer.id}>
                      <label className={cn('flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-foreground/5', offer.count === 0 && 'opacity-60')}>
                        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={filters.offers.includes(offer.id)}
                          onChange={() => setFilters({ offers: toggle(filters.offers, offer.id) })} />
                        <span className="min-w-0">
                          <span className="block break-words">{offer.name}</span>
                          <span className="block text-xs text-muted-foreground">{offer.count ? `${offer.count} ${offer.count === 1 ? 'campanha' : 'campanhas'} no período` : 'sem campanha no período'}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <label className="mt-2 inline-flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={filters.groupByOffer} onChange={(e) => setFilters({ groupByOffer: e.target.checked })} />
                Agrupar a tabela por oferta (subtotal de cada uma)
              </label>
            </section>

            <section className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-xs font-medium text-muted-foreground">Status
                <select className={selectClass} value={filters.status} onChange={(e) => setFilters({ status: e.target.value as TestFilters['status'] })}>
                  <option value="all">Todas</option><option value="active">Ativas</option><option value="paused">Pausadas e outras</option>
                </select>
              </label>
              <div className="grid gap-1">
                <p className="text-xs font-medium text-muted-foreground">Conta</p>
                <div className="flex flex-wrap gap-1">
                  {accounts.map((account) => {
                    const on = filters.accounts.includes(account.id);
                    return <button key={account.id} type="button" aria-pressed={on} onClick={() => setFilters({ accounts: toggle(filters.accounts, account.id) })}
                      className={cn('rounded-full border border-border px-2.5 py-1 text-xs hover:bg-foreground/5', on && 'border-primary bg-primary/10 text-foreground')}>{account.name}</button>;
                  })}
                  {accounts.length === 0 && <span className="text-xs text-muted-foreground">Nenhuma conta</span>}
                </div>
              </div>
            </section>

            <section>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Ordenar</p>
              <div className="mb-2 flex flex-wrap gap-1">
                {SORT_PRESETS.map((preset) => (
                  <button key={preset.id} type="button" aria-pressed={presetId === preset.id} onClick={() => setFilters({ sort: preset.sort })}
                    className={cn('rounded-full border border-border px-2.5 py-1 text-xs hover:bg-foreground/5', presetId === preset.id && 'border-primary bg-primary/10 text-foreground')}>
                    {preset.label}
                  </button>
                ))}
              </div>
              <ol className="space-y-1.5">
                {filters.sort.map((rule, index) => (
                  <li key={index} className="grid grid-cols-[4.5rem_minmax(0,1fr)_8.75rem_2rem] items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">{index === 0 ? 'Por' : 'Depois por'}</span>
                    <select aria-label={`Critério ${index + 1}`} className={cn(selectClass, 'min-w-0')} value={rule.key} onChange={(e) => updateRule(index, { key: e.target.value as SortKey })}>
                      {sortFields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
                    </select>
                    <select aria-label={`Direção do critério ${index + 1}`} className={cn(selectClass, 'min-w-0')} value={rule.dir} onChange={(e) => updateRule(index, { dir: e.target.value as SortRule['dir'] })}>
                      <option value="desc">Maior → menor</option><option value="asc">Menor → maior</option>
                    </select>
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label={`Remover critério ${index + 1}`} disabled={filters.sort.length === 1}
                      onClick={() => setFilters({ sort: filters.sort.filter((_, position) => position !== index) })}>
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ol>
              {filters.sort.length < MAX_SORT_RULES && (
                <button type="button" className="mt-1.5 text-xs font-medium text-primary hover:underline"
                  onClick={() => setFilters({ sort: [...filters.sort, { key: filters.sort.some((rule) => rule.key === 'spend') ? 'name' : 'spend', dir: 'desc' }] })}>
                  + Adicionar critério de desempate
                </button>
              )}
            </section>

            <section>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Condições sobre o total do período</p>
              <div className="space-y-1.5">
                {filters.conditions.map((condition) => (
                  <div key={condition.id} className="grid grid-cols-[minmax(0,1fr)_3.5rem_minmax(4.5rem,0.7fr)_2rem] items-center gap-1.5">
                    <select aria-label="Métrica da condição" className={cn(selectClass, 'min-w-0')} value={condition.metric} onChange={(e) => updateCondition(condition.id, { metric: e.target.value as MetricKey })}>
                      {METRICS.map((metric) => <option key={metric.key} value={metric.key}>{metric.label}{metric.key === 'margin' ? ' (%)' : ['sales', 'roi'].includes(metric.key) ? '' : ' (R$)'}</option>)}
                    </select>
                    <select aria-label="Operador" className={cn(selectClass, 'min-w-0 px-1 text-center')} value={condition.op} onChange={(e) => updateCondition(condition.id, { op: e.target.value as Operator })}>
                      {OPERATORS.map((op) => <option key={op} value={op}>{OPERATOR_LABEL[op]}</option>)}
                    </select>
                    <Input aria-label="Valor da condição" inputMode="decimal" placeholder="Valor" className="h-9 min-w-0" value={condition.value}
                      onChange={(e) => updateCondition(condition.id, { value: e.target.value })} />
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Remover condição"
                      onClick={() => setFilters({ conditions: filters.conditions.filter((item) => item.id !== condition.id) })}>
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              </div>
              <button type="button" className="mt-1.5 text-xs font-medium text-primary hover:underline"
                onClick={() => setFilters({ conditions: [...filters.conditions, { id: newId(), metric: 'sales', op: '>=', value: '' }] })}>
                + Adicionar condição
              </button>
            </section>
          </div>
          <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-2.5">
            <Button type="button" size="sm" variant="ghost" onClick={() => setFilters({ ...DEFAULT_FILTERS, search: filters.search })}>Limpar filtros</Button>
            <span className="text-xs tabular-nums text-muted-foreground">{resultCount} campanhas</span>
          </footer>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function OffersEditor({ id, offers, onClose }: { id: string; offers: TestOffer[]; onClose: () => void }) {
  const { enabled: streaming } = useMask();
  const [draft, setDraft] = useState(offers.map((item) => ({
    id: item.id, name: item.name, codes: item.codes.join(', '), accountIds: item.accountIds.join(', '), products: item.products.join('\n'),
  })));
  const client = useQueryClient();
  const { toast } = useToast();
  const split = (value: string, separator: string) => value.split(separator).map((item) => item.trim()).filter(Boolean);
  const save = useMutation({
    mutationFn: () => testsApi.saveOffers(id, draft.map((item) => ({
      id: item.id, name: item.name.trim(), codes: split(item.codes, ','), accountIds: split(item.accountIds, ','), products: split(item.products, '\n'),
    }))),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['test-matrix', id] });
      toast({ title: 'Ofertas salvas' });
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !save.isPending) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Ofertas do painel</DialogTitle></DialogHeader>
        {streaming ? <StreamingHidden>As ofertas trazem nomes, códigos de campanha e IDs de conta: desligue o modo streaming para editar.</StreamingHidden> : <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
          {draft.map((item, index) => {
            const update = (key: 'name' | 'codes' | 'accountIds' | 'products', value: string) =>
              setDraft((current) => current.map((entry, position) => position === index ? { ...entry, [key]: value } : entry));
            return <fieldset className="space-y-2 rounded-lg border border-border p-3" key={item.id}>
              <label className="grid gap-1 text-xs">Nome<Input required maxLength={80} value={item.name} onChange={(e) => update('name', e.target.value)} /></label>
              <label className="grid gap-1 text-xs">Códigos da campanha, separados por vírgula<Input required value={item.codes} onChange={(e) => update('codes', e.target.value)} /></label>
              <label className="grid gap-1 text-xs">IDs das contas, separados por vírgula<Input value={item.accountIds} onChange={(e) => update('accountIds', e.target.value)} placeholder="Todas as contas" /></label>
              <label className="grid gap-1 text-xs">Produtos do checkout, um por linha<textarea className="min-h-16 rounded-md border border-input bg-background p-2 text-sm" value={item.products} onChange={(e) => update('products', e.target.value)} /></label>
              <Button type="button" variant="ghost" size="sm" onClick={() => setDraft((current) => current.filter((entry) => entry.id !== item.id))}>Remover oferta</Button>
            </fieldset>;
          })}
          {save.isError && <p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setDraft((current) => [...current, { id: newId(), name: '', codes: '', accountIds: '', products: '' }])}>Adicionar oferta</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar ofertas'}</Button>
          </div>
        </form>}
      </DialogContent>
    </Dialog>
  );
}

/** ROI sem o "x": 1 indica que o líquido após o imposto cobre anúncios e IOF. */
function formatRoi(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function roiClass(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 1) return '';
  return value > 1 ? 'text-success' : 'text-destructive';
}
