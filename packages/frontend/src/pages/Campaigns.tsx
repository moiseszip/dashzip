import { dashboardRoi } from '@/lib/dashboardFinance';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, CornerDownRight, Pencil, RefreshCw, Search, SlidersHorizontal, X, Zap } from 'lucide-react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { NoWorkspace } from '@/components/NoWorkspace';
import { BudgetDialog } from '@/components/campaigns/BudgetDialog';
import {
  CampaignActionsMenu, CampaignStatusBadge, StatusConfirmDialog, type ControlRow,
} from '@/components/campaigns/CampaignRowControls';
import {
  BulkActionBar, CampaignCard, CampaignTotalsCard, cardColumnsFrom, type CardFormat,
} from '@/components/campaigns/CampaignCards';
import { ResultDatePicker } from '@/components/summary/ResultDatePicker';
import { RouteFallback } from '@/components/RouteFallback';
import { Segmented } from '@/components/ui/segmented';
import { useIsPhone } from '@/hooks/useMediaQuery';
import { ColumnResizeHandle } from '@/components/table/ColumnResizeHandle';
import { TablePagination } from '@/components/table/TablePagination';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { useMask } from '@/contexts/StreamingModeContext';
import { Masked } from '@/components/Masked';
import { useColumnWidth, useColumnWidths } from '@/hooks/useColumnWidth';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { presetSelection, type ResultDateSelection } from '@/lib/resultDates';
import { PAGE_SIZE, paginate } from '@/lib/pagination';
import { cn } from '@/lib/utils';
import {
  COLUMNS,
  accountStatusLabel,
  actionErrorMessage,
  campaignsApi,
  formatCurrency,
  formatMetric,
  isActive,
  type ActionItem,
  type ActionResult,
  type Level,
  type MetricKey,
  type Metrics,
  type ObjectRow,
  type ObjectsResponse,
  type RowPatch,
  type SavedColumns,
} from '@/lib/campaigns';

import { GRID_TABLE } from '@/components/table/gridTable';
import { formatCreated, statusLabel, type ColumnDef, type ColumnKey, type ViewCurrency } from '@/lib/campaigns';
import { campaignColumnsQuery, campaignsQuery } from '@/lib/pageQueries';
const LEVELS: { value: Level; label: string; noun: string }[] = [
  { value: 'account', label: 'Contas', noun: 'conta' },
  { value: 'campaign', label: 'Campanhas', noun: 'campanha' },
  { value: 'adset', label: 'Conjuntos', noun: 'conjunto' },
  { value: 'ad', label: 'Anúncios', noun: 'anúncio' },
];

const NEXT_LEVEL: Partial<Record<Level, Level>> = { account: 'campaign', campaign: 'adset', adset: 'ad' };

type StatusFilter = 'all' | 'active' | 'paused';
type SortState = { key: ColumnKey | 'name'; dir: 'asc' | 'desc' };
type Selection = Record<Level, string[]>;

const PREFS_KEY = 'dashzip:campaigns:prefs';
const DEFAULT_COLUMNS = COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);
const EMPTY_SELECTION: Selection = { account: [], campaign: [], adset: [], ad: [] };

const ADDITIVE: MetricKey[] = [
  'spend', 'mediaTax', 'sales', 'grossRevenue', 'netRevenue', 'salesTax', 'profit', 'impressions', 'clicks',
  'landingPageViews', 'initiateCheckouts', 'videoPlays', 'video3s', 'video75',
];

const selectClass = 'h-9 rounded-md border border-input bg-background px-3 text-sm';

type LevelPrefs = { columns: ColumnKey[]; sort: SortState };
type AllPrefs = Record<Level, LevelPrefs>;

const KNOWN_COLUMNS = new Set<string>(COLUMNS.map((c) => c.key));
const DEFAULT_PREFS: LevelPrefs = { columns: DEFAULT_COLUMNS, sort: { key: 'spend', dir: 'desc' } };
const LEVEL_KEYS: Level[] = ['account', 'campaign', 'adset', 'ad'];

/** Aceita o formato salvo no painel e o antigo do localStorage (um só para todos os níveis). */
function cleanLevel(raw: unknown): LevelPrefs | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as { columns?: unknown; sort?: { key?: unknown; dir?: unknown } | null };
  const columns = Array.isArray(value.columns) ? value.columns.filter((k): k is ColumnKey => typeof k === 'string' && KNOWN_COLUMNS.has(k)) : [];
  const sortKey = value.sort?.key;
  const sort: SortState = typeof sortKey === 'string' && (sortKey === 'name' || KNOWN_COLUMNS.has(sortKey))
    ? { key: sortKey as SortState['key'], dir: value.sort?.dir === 'asc' ? 'asc' : 'desc' }
    : DEFAULT_PREFS.sort;
  return { columns: columns.length ? columns : DEFAULT_PREFS.columns, sort };
}

function fromSaved(saved: SavedColumns | Record<string, unknown>, base: AllPrefs): AllPrefs {
  const next = { ...base };
  for (const level of LEVEL_KEYS) {
    const clean = cleanLevel((saved as Record<string, unknown>)[level]);
    if (clean) next[level] = clean;
  }
  return next;
}

function readLocal(): AllPrefs {
  const base = Object.fromEntries(LEVEL_KEYS.map((l) => [l, DEFAULT_PREFS])) as AllPrefs;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    const legacy = cleanLevel(parsed);
    if (legacy && Array.isArray(parsed.columns)) return Object.fromEntries(LEVEL_KEYS.map((l) => [l, legacy])) as AllPrefs;
    return fromSaved(parsed, base);
  } catch {
    return base;
  }
}

function writeLocal(prefs: AllPrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* navegação privada */ }
}

const accountKey = (id: string) => id.replace(/^act_/, '');

const COLUMN_BY_KEY = new Map<ColumnKey, ColumnDef>(COLUMNS.map((c) => [c.key, c]));
/** Largura inicial de cada coluna (px), até o usuário arrastar a borda. */
const DEFAULT_WIDTH: Record<string, number> = { money: 128, int: 96, pct: 104, ratio: 96, decimal: 96, date: 116 };
const STATUS_WIDTH = 132;
const BUDGET_WIDTH = 148;
const fixed = (width: number) => ({ width, minWidth: width, maxWidth: width });
/** Colunas travadas à esquerda: seleção, ações, status e nome. */
const CHECK_W = 44;
const MENU_W = 48;
const STICKY = 'sticky z-[1] bg-background';
/** Cabeçalho travado acima das alças de largura das colunas que rolam por baixo. */
const STICKY_HEAD = 'sticky z-20 bg-background';
const CURRENCY_KEY = 'dashzip:campaigns-currency';
// Colunas novas (Margem e Criação) entram uma vez nas preferências já salvas.
const NEW_COLUMNS_FLAG = 'dashzip:campaigns-cols-v2';

function readCurrency(): ViewCurrency {
  try { return localStorage.getItem(CURRENCY_KEY) === 'USD' ? 'USD' : 'BRL'; } catch { return 'BRL'; }
}

/** Liga uma coluna mantendo a ordem escolhida; Criação continua por último se já estiver lá. */
function withColumn(columns: ColumnKey[], key: ColumnKey): ColumnKey[] {
  if (columns.includes(key)) return columns;
  const last = columns[columns.length - 1];
  return last === 'createdTime' && key !== 'createdTime' ? [...columns.slice(0, -1), key, last] : [...columns, key];
}

/** Move a coluna `from` para a posição de `to`. */
function moveColumn(columns: ColumnKey[], from: ColumnKey, to: ColumnKey): ColumnKey[] {
  if (from === to) return columns;
  const without = columns.filter((k) => k !== from);
  const index = without.indexOf(to);
  if (index < 0) return columns;
  const target = columns.indexOf(from) < columns.indexOf(to) ? index + 1 : index;
  return [...without.slice(0, target), from, ...without.slice(target)];
}

/** Cor de ganho/perda: lucro e margem pelo sinal; ROI acima ou abaixo de 1 (cobertura de mídia). */
function signClass(key: ColumnKey, value: number | null | undefined) {
  if (value === null || value === undefined) return '';
  if (key === 'profit' || key === 'margin') return profitClass(value);
  if (key === 'roi') return profitClass(value - 1);
  return '';
}

function normalize(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function ratio(a: number | null, b: number | null, factor = 1) {
  return a !== null && b !== null && b !== 0 ? (a / b) * factor : null;
}

/**
 * Totais da seleção filtrada na tela, com as mesmas fórmulas do servidor. Alcance e
 * frequência não somam entre objetos e ficam vazios. ctr, hook e hold são frações.
 */
function sumRows(rows: ObjectRow[]): Partial<Metrics> {
  const totals: Partial<Metrics> = {};
  for (const key of ADDITIVE) {
    let sum = 0;
    let known = false;
    for (const row of rows) {
      const value = row[key];
      if (value !== null && Number.isFinite(value)) { sum += value; known = true; }
    }
    totals[key] = known ? sum : null;
  }
  const t = (k: MetricKey) => totals[k] ?? null;
  totals.roas = ratio(t('grossRevenue'), t('spend'));
  totals.cpa = ratio(t('spend'), t('sales'));
  totals.cpc = ratio(t('spend'), t('clicks'));
  totals.ctr = ratio(t('clicks'), t('impressions'));
  totals.cpm = ratio(t('spend'), t('impressions'), 1000);
  totals.hook = ratio(t('video3s'), t('impressions'));
  totals.hold = ratio(t('video75'), t('impressions'));
  const complete = (key: MetricKey) => rows.every((row) => Number.isFinite(row[key])) ? t(key) : null;
  totals.roi = dashboardRoi(complete('netRevenue'), complete('salesTax'), complete('spend'), complete('mediaTax'));
  totals.margin = ratio(complete('profit'), complete('netRevenue'));
  totals.reach = null;
  totals.frequency = null;
  return totals;
}

export default function Campaigns() {
  const { activeWorkspace } = useWorkspaceContext();
  return (
    <DashboardLayout wide>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Meta Ads</h1>
            {activeWorkspace && <p className="mt-1 text-sm text-muted-foreground"><Masked kind="workspace" value={activeWorkspace.name} /></p>}
          </div>
          {activeWorkspace && (
            <Button asChild size="sm" variant="outline">
              <Link to="/rules"><Zap className="mr-1.5 h-4 w-4" aria-hidden="true" />Regras</Link>
            </Button>
          )}
        </div>
        {activeWorkspace ? <CampaignsPanel key={activeWorkspace.id} id={activeWorkspace.id} /> : <NoWorkspace />}
      </div>
    </DashboardLayout>
  );
}

function CampaignsPanel({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { enabled: streaming, mask, scrub } = useMask();
  const [level, setLevel] = useState<Level>('campaign');
  const [date, setDate] = useState<ResultDateSelection>(() => presetSelection('today'));
  const period = date.range;
  const nameColumn = useColumnWidth('campaigns:name', 320);
  const colWidths = useColumnWidths('campaigns');
  const [pageState, setPageState] = useState({ key: '', page: 1 });
  const [statusTarget, setStatusTarget] = useState<{ row: ControlRow; action: 'pause' | 'activate' } | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [allPrefs, setAllPrefs] = useState<AllPrefs>(readLocal);
  const [currency, setCurrencyState] = useState<ViewCurrency>(readCurrency);
  const setCurrency = (next: ViewCurrency) => {
    setCurrencyState(next);
    try { localStorage.setItem(CURRENCY_KEY, next); } catch { /* navegação privada */ }
  };
  const prefs = allPrefs[level];
  const saveTimer = useRef<number>();
  const loadedFromServer = useRef(false);

  // As colunas ficam salvas no painel (dashboard_preferences.campaign_columns);
  // o localStorage só cobre o carregamento e a falta de rede.
  const savedColumns = useQuery(campaignColumnsQuery(id));
  useEffect(() => {
    if (!savedColumns.data || loadedFromServer.current) return;
    loadedFromServer.current = true;
    if (Object.keys(savedColumns.data.columns).length) setAllPrefs((current) => fromSaved(savedColumns.data.columns, current));
  }, [savedColumns.data]);
  useEffect(() => () => window.clearTimeout(saveTimer.current), []);
  useEffect(() => {
    if (savedColumns.isLoading) return;
    try { if (localStorage.getItem(NEW_COLUMNS_FLAG)) return; } catch { return; }
    setAllPrefs((current) => {
      const next = Object.fromEntries(LEVEL_KEYS.map((l) => {
        let columns = current[l].columns;
        if (!columns.includes('margin')) {
          const at = columns.indexOf('roi') >= 0 ? columns.indexOf('roi') + 1 : columns.indexOf('profit') + 1 || columns.length;
          columns = [...columns.slice(0, at), 'margin' as ColumnKey, ...columns.slice(at)];
        }
        if (!columns.includes('createdTime')) columns = [...columns, 'createdTime'];
        return [l, { ...current[l], columns }];
      })) as AllPrefs;
      writeLocal(next);
      campaignsApi.saveColumns(id, next).catch(() => { /* fica no localStorage */ });
      return next;
    });
    try { localStorage.setItem(NEW_COLUMNS_FLAG, '1'); } catch { /* navegação privada */ }
  }, [savedColumns.isLoading, id]);
  const phone = useIsPhone();
  const [filtersOpen, setFiltersOpen] = useState(false);
  // No celular, trocar de nível (ou descer pelo card) volta a lista para o topo.
  useEffect(() => {
    if (phone) window.scrollTo({ top: 0 });
  }, [level, phone]);
  const [budgetRow, setBudgetRow] = useState<ControlRow | null>(null);
  const [bulkAction, setBulkAction] = useState<'pause' | 'activate' | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const campaigns = campaignsQuery(id, level, period);
  const queryKey = campaigns.queryKey;
  const query = useQuery({
    ...campaigns,
    // Trocar o período mantém a tabela na tela enquanto chega o novo (no mesmo nível).
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[2] === level ? previous : undefined),
  });

  const updatePrefs = (next: Partial<LevelPrefs>) => {
    setAllPrefs((current) => {
      const merged = { ...current, [level]: { ...current[level], ...next } };
      writeLocal(merged);
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        campaignsApi.saveColumns(id, merged).catch(() => { /* fica no localStorage até a próxima mudança */ });
      }, 800);
      return merged;
    });
  };

  const visibleColumns = prefs.columns.map((k) => COLUMN_BY_KEY.get(k)).filter((c): c is ColumnDef => !!c);
  const [dragColumn, setDragColumn] = useState<ColumnKey | null>(null);

  const rows = useMemo(() => {
    let list = query.data?.rows ?? [];
    const accounts = new Set(selection.account.map(accountKey));
    const campaigns = new Set(selection.campaign);
    const adsets = new Set(selection.adset);
    if (level !== 'account') {
      if (level === 'ad' && adsets.size) list = list.filter((r) => r.adsetId && adsets.has(r.adsetId));
      else if ((level === 'ad' || level === 'adset') && campaigns.size) list = list.filter((r) => r.campaignId && campaigns.has(r.campaignId));
      else if (accounts.size) list = list.filter((r) => accounts.has(accountKey(r.accountId)));
    }
    if (statusFilter !== 'all' && level !== 'account') {
      list = list.filter((r) => (statusFilter === 'active' ? isActive(r) : !isActive(r)));
    }
    if (search.trim()) {
      const needle = normalize(search.trim());
      // No modo streaming a busca também acha pelo apelido ("campanha 3").
      list = list.filter((r) => normalize(r.name).includes(needle) || r.id.includes(needle) || (streaming && normalize(mask(r.level, r.name)).includes(needle)));
    }
    const { key, dir } = prefs.sort;
    const factor = dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      if (key === 'name') return a.name.localeCompare(b.name, 'pt-BR') * factor;
      const av = key === 'createdTime' ? (a.createdTime ? Date.parse(a.createdTime) : null) : a[key];
      const bv = key === 'createdTime' ? (b.createdTime ? Date.parse(b.createdTime) : null) : b[key];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * factor;
    });
  }, [query.data, level, selection, statusFilter, search, prefs.sort, streaming, mask]);

  const filtered = !!query.data && rows.length !== query.data.rows.length;
  const totals = query.data ? (filtered ? sumRows(rows) : query.data.totals) : {};

  const patchRows = (patches: Map<string, RowPatch>) => {
    queryClient.setQueryData<ObjectsResponse>(queryKey, (current) => current && ({
      ...current,
      rows: current.rows.map((row) => (patches.has(row.id) ? { ...row, ...patches.get(row.id) } : row)),
    }));
  };

  const markPending = (ids: string[], on: boolean) => {
    setPending((current) => {
      const next = new Set(current);
      ids.forEach((objectId) => (on ? next.add(objectId) : next.delete(objectId)));
      return next;
    });
  };

  const single = useMutation({
    mutationFn: async (item: ActionItem): Promise<ActionResult> => {
      const { results } = await campaignsApi.actions(id, [item]);
      return results[0] ?? { objectId: item.objectId, ok: false };
    },
    onMutate: (item) => markPending([item.objectId], true),
    onSettled: (_data, _error, item) => markPending([item.objectId], false),
    onSuccess: (result, item) => {
      if (!result.ok) {
        toast({ title: 'A Meta recusou a alteração', description: actionErrorMessage(result.code, result.message), variant: 'destructive' });
        return;
      }
      if (result.row) patchRows(new Map([[item.objectId, result.row]]));
      setBudgetRow(null);
      setStatusTarget(null);
      toast({
        title: item.action === 'pause' ? 'Pausado na Meta' : item.action === 'activate' ? 'Ativado na Meta' : 'Orçamento alterado na Meta',
      });
      queryClient.invalidateQueries({ queryKey: ['campaigns', id] });
      queryClient.invalidateQueries({ queryKey: ['test-matrix', id] });
    },
    onError: (error: Error & { body?: { code?: string } }) => {
      toast({ title: 'Não foi possível alterar', description: actionErrorMessage(error.body?.code, error.message), variant: 'destructive' });
    },
  });

  const bulk = useMutation({
    mutationFn: (items: ActionItem[]) => campaignsApi.actions(id, items),
    onMutate: (items) => markPending(items.map((i) => i.objectId), true),
    onSettled: (_data, _error, items) => markPending(items.map((i) => i.objectId), false),
    onSuccess: ({ results }) => {
      const patches = new Map<string, RowPatch>();
      const failed: ActionResult[] = [];
      for (const result of results) {
        if (result.ok && result.row) patches.set(result.objectId, result.row);
        if (!result.ok) failed.push(result);
      }
      patchRows(patches);
      setBulkAction(null);
      const ok = results.length - failed.length;
      toast({
        title: failed.length ? `${ok} de ${results.length} alterados` : `${ok} alterados`,
        description: failed.length ? actionErrorMessage(failed[0].code, failed[0].message) : undefined,
        variant: failed.length ? 'destructive' : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['campaigns', id] });
    },
    onError: (error: Error) => toast({ title: 'Não foi possível alterar', description: error.message, variant: 'destructive' }),
  });

  const selectedHere = selection[level];
  const selectedRows = rows.filter((r) => selectedHere.includes(r.id));
  const allChecked = rows.length > 0 && rows.every((r) => selectedHere.includes(r.id));

  const setLevelSelection = (target: Level, ids: string[]) => {
    setSelection((current) => {
      const next = { ...current, [target]: ids };
      // Mudar a seleção de cima invalida a de baixo, que pode não pertencer mais ao filtro.
      const order: Level[] = ['account', 'campaign', 'adset', 'ad'];
      for (const lower of order.slice(order.indexOf(target) + 1)) next[lower] = [];
      return next;
    });
  };

  const toggleRow = (rowId: string, on: boolean) => {
    setLevelSelection(level, on ? [...selectedHere, rowId] : selectedHere.filter((x) => x !== rowId));
  };

  const drillDown = (row: ObjectRow) => {
    const next = NEXT_LEVEL[row.level];
    if (!next) return;
    setLevelSelection(row.level, [row.id]);
    setLevel(next);
  };

  const sortBy = (key: SortState['key']) => {
    const dir = prefs.sort.key === key && prefs.sort.dir === 'desc' ? 'asc' : 'desc';
    updatePrefs({ sort: { key, dir } });
  };

  const levelInfo = LEVELS.find((l) => l.value === level)!;
  const data = query.data;
  const accountsById = new Map((data?.accounts ?? []).map((a) => [accountKey(a.id), a]));
  // O servidor manda as métricas em BRL; em dólar, divide pela PTAX média do período.
  const periodRate = data?.usdBrl?.period ?? null;
  const latestRate = data?.usdBrl?.latest ?? periodRate;
  const money = (value: number | null | undefined) => {
    if (value === null || value === undefined) return null;
    if (currency === 'BRL') return value;
    return periodRate ? value / periodRate : null;
  };
  // Orçamento e saldo do ciclo vêm na moeda da conta; convertem pela PTAX do último dia.
  const budget = (value: number | null | undefined, accountCurrency: string) => {
    if (value === null || value === undefined) return null;
    if (accountCurrency === currency) return value;
    if (!latestRate) return null;
    if (accountCurrency === 'USD' && currency === 'BRL') return value * latestRate;
    if (accountCurrency === 'BRL' && currency === 'USD') return value / latestRate;
    return null;
  };
  const noAccounts = data && data.accounts.length === 0;
  const pageKey = JSON.stringify([level, period, search, statusFilter, selection, prefs.sort]);
  const statusWidth = colWidths.widthOf('status', STATUS_WIDTH);
  const nameLeft = CHECK_W + MENU_W + statusWidth;
  const page = paginate(rows, pageState.key === pageKey ? pageState.page : 1);
  const asControl = (row: ObjectRow): ControlRow | null => (row.level === 'account' ? null : { ...row, level: row.level });
  const fmt: CardFormat = { currency, money, budget };
  const { card: cardColumns, extra: extraColumns } = cardColumnsFrom(COLUMN_BY_KEY, visibleColumns);
  // No celular a lista cresce com "Mostrar mais" em vez de trocar de página.
  const shownRows = rows.slice(0, page.page * PAGE_SIZE);
  const nextLabelOf = (row: ObjectRow) => {
    const next = NEXT_LEVEL[row.level];
    return next ? LEVELS.find((l) => l.value === next)!.label.toLowerCase() : null;
  };
  const sortChanged = prefs.sort.key !== DEFAULT_PREFS.sort.key || prefs.sort.dir !== DEFAULT_PREFS.sort.dir;
  const activeFilters = (statusFilter !== 'all' && level !== 'account' ? 1 : 0) + (currency !== 'BRL' ? 1 : 0) + (sortChanged ? 1 : 0);
  // Filtro herdado de cima (campanha → conjuntos → anúncios), com o nome que já está no cache.
  const parentChips = LEVEL_KEYS.slice(0, LEVEL_KEYS.indexOf(level)).flatMap((upper) => {
    const ids = selection[upper];
    if (!ids.length) return [];
    const cached = queryClient.getQueryData<ObjectsResponse>(['campaigns', id, upper, period.since, period.until]);
    const first = cached?.rows.find((r) => r.id === ids[0]);
    const noun = LEVELS.find((l) => l.value === upper)!;
    const label = ids.length === 1 && first ? mask(upper, first.name) : `${ids.length} ${noun.label.toLowerCase()}`;
    return [{ level: upper, noun: noun.noun, label }];
  });

  const levelTabs = (
    <Tabs value={level} onValueChange={(value) => setLevel(value as Level)}>
      <TabsList className={cn(phone && 'grid h-11 w-full grid-cols-4')}>
        {LEVELS.map((l) => (
          <TabsTrigger key={l.value} value={l.value} className={cn(phone && 'h-9 px-1 text-[13px]')}>
            {l.label}
            {selection[l.value].length > 0 && (phone ? (
              <span className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label={`${selection[l.value].length} selecionado(s)`} />
            ) : (
              <span className="ml-1.5 rounded-full bg-foreground/10 px-1.5 text-[11px] tabular-nums">{selection[l.value].length}</span>
            ))}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );

  const chips = parentChips.length > 0 && (
    <div className="flex flex-wrap items-center gap-2">
      {parentChips.map((chip) => (
        <span key={chip.level} className="inline-flex max-w-full items-center rounded-full border border-border bg-foreground/[0.04] text-xs">
          <button type="button" className="min-h-[2.25rem] min-w-0 truncate py-1 pl-3 pr-1 text-left" onClick={() => setLevel(chip.level)}
            title={`Voltar para ${chip.noun}`}>
            <span className="text-muted-foreground">{chip.noun[0].toUpperCase() + chip.noun.slice(1)}:</span> {chip.label}
          </button>
          <button type="button" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-foreground/10"
            aria-label={`Tirar o filtro de ${chip.noun}`} onClick={() => setLevelSelection(chip.level, [])}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </span>
      ))}
    </div>
  );

  return (
    <>
      {phone ? (
        <>
          <div className="sticky top-[var(--app-header-h)] z-20 -mx-4 space-y-2 border-b border-border bg-background/95 px-4 pb-2 pt-2 backdrop-blur-md">
            {levelTabs}
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <ResultDatePicker value={date} onApply={setDate} showCompare={false} />
              </div>
              <Button type="button" variant="outline" className="relative h-10 w-10 shrink-0 px-0" onClick={() => setFiltersOpen(true)}
                aria-label={`Filtros e ordem${activeFilters ? ` (${activeFilters} ativos)` : ''}`}>
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                {activeFilters > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">{activeFilters}</span>
                )}
              </Button>
              <Button type="button" variant="outline" className="h-10 w-10 shrink-0 px-0" onClick={() => query.refetch()} disabled={query.isFetching} aria-label="Atualizar">
                <RefreshCw className={cn('h-4 w-4', query.isFetching && 'animate-spin')} aria-hidden="true" />
              </Button>
            </div>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              enterKeyHint="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Buscar ${levelInfo.noun} por nome ou ID`}
              className="h-11 pl-9"
              aria-label="Buscar"
            />
          </div>
          {chips}
        </>
      ) : (
      <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        {levelTabs}
        <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
          <div className="min-w-[9rem] flex-1 space-y-1 sm:w-56 sm:flex-none">
            <p className="text-xs font-medium text-muted-foreground">Data</p>
            <ResultDatePicker value={date} onApply={setDate} showCompare={false} align="end" />
          </div>
          <Button size="sm" variant="outline" onClick={() => query.refetch()} disabled={query.isFetching} aria-label="Atualizar">
            <RefreshCw className={cn('h-4 w-4', query.isFetching && 'animate-spin')} />
          </Button>

        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Buscar ${levelInfo.noun} por nome ou ID`}
          className="h-9 w-full sm:w-72"
          aria-label="Buscar"
        />
        {level !== 'account' && (
          <select aria-label="Status" className={selectClass} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="all">Todos os status</option>
            <option value="active">Ativos</option>
            <option value="paused">Pausados</option>
          </select>
        )}
        <select aria-label="Moeda" title="Moeda em que os valores aparecem" className={selectClass} value={currency} onChange={(e) => setCurrency(e.target.value as ViewCurrency)}>
          <option value="BRL">R$ · Real</option>
          <option value="USD">US$ · Dólar</option>
        </select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline"><Columns3 className="mr-1.5 h-4 w-4" /> Colunas</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-96 w-56 overflow-y-auto">
            <DropdownMenuLabel>Colunas visíveis</DropdownMenuLabel>
            {COLUMNS.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.key}
                checked={prefs.columns.includes(c.key)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(on) => updatePrefs({
                  columns: on ? withColumn(prefs.columns, c.key) : prefs.columns.filter((k) => k !== c.key),
                })}
              >
                {c.label}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Ordem (ou arraste o cabeçalho)</DropdownMenuLabel>
            {visibleColumns.map((c, i) => (
              <div key={c.key} className="flex items-center gap-1 px-2 py-1 text-sm">
                <span className="flex-1 truncate">{c.label}</span>
                <button type="button" aria-label={`Mover ${c.label} para a esquerda`} disabled={i === 0} className="rounded p-1 hover:bg-foreground/5 disabled:opacity-30"
                  onClick={() => updatePrefs({ columns: moveColumn(prefs.columns, c.key, visibleColumns[i - 1].key) })}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" aria-label={`Mover ${c.label} para a direita`} disabled={i === visibleColumns.length - 1} className="rounded p-1 hover:bg-foreground/5 disabled:opacity-30"
                  onClick={() => updatePrefs({ columns: moveColumn(prefs.columns, c.key, visibleColumns[i + 1].key) })}>
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => updatePrefs({ columns: DEFAULT_COLUMNS })}>Restaurar padrão</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {(selection.account.length + selection.campaign.length + selection.adset.length > 0) && (
          <Button size="sm" variant="ghost" onClick={() => setSelection(EMPTY_SELECTION)}>Limpar seleção</Button>
        )}
        {level !== 'account' && selectedRows.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{selectedRows.length} selecionado(s)</span>
            <Button size="sm" variant="outline" onClick={() => setBulkAction('activate')}>Ativar</Button>
            <Button size="sm" variant="outline" onClick={() => setBulkAction('pause')}>Pausar</Button>
          </div>
        )}
      </div>
      {chips}
      </>
      )}

      {data?.warnings.map((warning) => (
        <p key={warning} className="rounded-lg border border-border bg-foreground/5 px-3 py-2 text-sm">{scrub(warning)}</p>
      ))}
      {data && data.untrackedSales.count > 0 && (
        <p className="rounded-lg border border-border bg-foreground/5 px-3 py-2 text-sm">
          {data.untrackedSales.count} {data.untrackedSales.count === 1 ? 'venda não rastreada' : 'vendas não rastreadas'} no período selecionado ({formatMetric(money(data.untrackedSales.grossRevenue), 'money', currency)})
        </p>
      )}

      {query.isLoading && <RouteFallback label="Carregando dados da Meta" />}
      {query.error && (
        <p className="text-sm text-destructive">
          {(query.error as Error & { status?: number }).status === 404
            ? 'A API de Campanhas ainda não está publicada neste ambiente.'
            : scrub((query.error as Error).message)}
        </p>
      )}

      {noAccounts && (
        <div className="rounded-xl border border-border p-6 text-center">
          <p className="text-sm">Nenhuma conta de anúncio vinculada a este painel.</p>
          <Button asChild className="mt-3" size="sm"><Link to="/integrations">Vincular contas em Integrações</Link></Button>
        </div>
      )}

      {data && !noAccounts && phone && (
        <div className={cn('space-y-3', level !== 'account' && selectedRows.length > 0 && 'pb-20')}>
          <CampaignTotalsCard count={rows.length} totals={totals} filtered={filtered} columns={cardColumns} fmt={fmt} />
          {shownRows.map((row) => (
            <CampaignCard
              key={row.id}
              row={row}
              level={level}
              checked={selectedHere.includes(row.id)}
              busy={pending.has(row.id)}
              nextLabel={nextLabelOf(row)}
              cardColumns={cardColumns}
              extraColumns={extraColumns}
              fmt={fmt}
              accountStatus={row.level === 'account' ? accountsById.get(accountKey(row.id))?.accountStatus : undefined}
              cycleSpend={row.level === 'account' ? accountsById.get(accountKey(row.id))?.cycleSpend : undefined}
              onSelect={(on) => toggleRow(row.id, on)}
              onDrill={() => drillDown(row)}
              onStatus={(target, kind) => setStatusTarget({ row: target, action: kind })}
              onBudget={setBudgetRow}
            />
          ))}
          {rows.length === 0 && <p className="rounded-xl border border-border p-6 text-center text-sm text-muted-foreground">Nada encontrado para este filtro e período.</p>}
          {shownRows.length < rows.length && (
            <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setPageState({ key: pageKey, page: page.page + 1 })}>
              Mostrar mais ({rows.length - shownRows.length})
            </Button>
          )}
        </div>
      )}

      {data && !noAccounts && !phone && (
        <div className="space-y-2">
        <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-border">
          <table className={cn('w-max min-w-full text-sm', GRID_TABLE)}>
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className={cn('px-4 py-3', STICKY_HEAD)} style={{ ...fixed(CHECK_W), left: 0 }}>
                  <input
                    type="checkbox"
                    aria-label="Selecionar todos"
                    className="accent-primary"
                    checked={allChecked}
                    onChange={(e) => setLevelSelection(level, e.target.checked ? rows.map((r) => r.id) : [])}
                  />
                </th>
                <th className={cn('px-2 py-3', STICKY_HEAD)} style={{ ...fixed(MENU_W), left: CHECK_W }}><span className="sr-only">Ações</span></th>
                <th className={cn('relative px-4 py-3', STICKY_HEAD)} style={{ ...fixed(statusWidth), left: CHECK_W + MENU_W }}>
                  {level === 'account' ? 'Situação' : 'Status'}
                  <ColumnResizeHandle label="Largura da coluna Status" width={colWidths.widthOf('status', STATUS_WIDTH)} min={colWidths.min} max={colWidths.max}
                    fallback={STATUS_WIDTH} onPreview={(w) => colWidths.preview('status', w)} onCommit={(w) => colWidths.commit('status', w)} />
                </th>
                <th className={cn('relative border-r border-border px-4 py-3', STICKY_HEAD)} style={{ ...fixed(nameColumn.width), left: nameLeft }}>
                  <SortButton label="Nome" active={prefs.sort.key === 'name'} dir={prefs.sort.dir} onClick={() => sortBy('name')} />
                  <ColumnResizeHandle label="Largura da coluna Nome" width={nameColumn.width} min={nameColumn.min} max={nameColumn.max}
                    fallback={nameColumn.fallback} onPreview={nameColumn.preview} onCommit={nameColumn.commit} />
                </th>
                {(level === 'account' || level === 'campaign' || level === 'adset') && (
                  <th className="relative px-4 py-3 text-right" style={fixed(colWidths.widthOf('budget', BUDGET_WIDTH))}>
                    {level === 'account' ? 'Gasto do ciclo' : 'Orçamento'}
                    <ColumnResizeHandle label="Largura da coluna de orçamento" width={colWidths.widthOf('budget', BUDGET_WIDTH)} min={colWidths.min} max={colWidths.max}
                      fallback={BUDGET_WIDTH} onPreview={(w) => colWidths.preview('budget', w)} onCommit={(w) => colWidths.commit('budget', w)} />
                  </th>
                )}
                {visibleColumns.map((c) => (
                  <th
                    key={c.key}
                    className={cn('relative cursor-grab whitespace-nowrap px-4 py-3 text-right', dragColumn && dragColumn !== c.key && 'hover:bg-foreground/5', dragColumn === c.key && 'opacity-50')}
                    style={fixed(colWidths.widthOf(c.key, DEFAULT_WIDTH[c.kind] ?? 112))}
                    title={c.hint ? `${c.hint} · arraste para mudar a ordem` : 'Arraste para mudar a ordem'}
                    draggable
                    onDragStart={(e) => {
                      if ((e.target as HTMLElement).closest('[data-resize-handle]')) { e.preventDefault(); return; }
                      setDragColumn(c.key); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.key);
                    }}
                    onDragOver={(e) => { if (dragColumn) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
                    onDrop={(e) => { e.preventDefault(); if (dragColumn) updatePrefs({ columns: moveColumn(prefs.columns, dragColumn, c.key) }); setDragColumn(null); }}
                    onDragEnd={() => setDragColumn(null)}
                  >
                    <SortButton label={c.label} active={prefs.sort.key === c.key} dir={prefs.sort.dir} onClick={() => sortBy(c.key)} align="right" />
                    <ColumnResizeHandle label={`Largura da coluna ${c.label}`} width={colWidths.widthOf(c.key, DEFAULT_WIDTH[c.kind] ?? 112)} min={colWidths.min} max={colWidths.max}
                      fallback={DEFAULT_WIDTH[c.kind] ?? 112} onPreview={(w) => colWidths.preview(c.key, w)} onCommit={(w) => colWidths.commit(c.key, w)} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border bg-secondary font-medium">
                <td className={cn('px-4 py-3', STICKY, 'bg-secondary')} style={{ left: 0 }} />
                <td className={cn('px-2 py-3', STICKY, 'bg-secondary')} style={{ left: CHECK_W }} />
                <td className={cn('px-4 py-3', STICKY, 'bg-secondary')} style={{ left: CHECK_W + MENU_W }} />
                <td className={cn('border-r border-border px-4 py-3', STICKY, 'bg-secondary')} style={{ left: nameLeft }}>Total ({rows.length}){filtered && <span className="ml-1 text-xs font-normal text-muted-foreground">filtrado</span>}</td>
                {(level === 'account' || level === 'campaign' || level === 'adset') && <td className="px-4 py-3" />}
                {visibleColumns.map((c) => (
                  <td key={c.key} className={cn('whitespace-nowrap px-4 py-3 text-right tabular-nums', c.key !== 'createdTime' && signClass(c.key, totals[c.key]))}>
                    {c.key === 'createdTime' ? '' : formatMetric(c.kind === 'money' ? money(totals[c.key] ?? null) : totals[c.key] ?? null, c.kind, currency)}
                  </td>
                ))}
              </tr>
              {page.items.map((row) => {
                const busy = pending.has(row.id);
                const checked = selectedHere.includes(row.id);
                const control = asControl(row);
                return (
                  <tr key={row.id} className={cn('border-b border-border/60', checked && 'bg-foreground/[0.03]')}>
                    <td className={cn('px-4 py-3', STICKY)} style={{ left: 0 }}>
                      <input type="checkbox" aria-label={`Selecionar ${mask(row.level, row.name)}`} className="accent-primary" checked={checked} onChange={(e) => toggleRow(row.id, e.target.checked)} />
                    </td>
                    <td className={cn('px-2 py-3', STICKY)} style={{ left: CHECK_W }}>
                      {control ? (
                        <CampaignActionsMenu
                          row={control}
                          busy={busy}
                          onStatus={(target, kind) => setStatusTarget({ row: target, action: kind })}
                          onBudget={setBudgetRow}
                          extra={NEXT_LEVEL[row.level] && (
                            <DropdownMenuItem onSelect={() => drillDown(row)}>
                              <CornerDownRight className="mr-2 h-4 w-4" aria-hidden="true" />
                              Ver {LEVELS.find((l) => l.value === NEXT_LEVEL[row.level])?.label.toLowerCase()}
                            </DropdownMenuItem>
                          )}
                        />
                      ) : NEXT_LEVEL[row.level] && (
                        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label={`Ver campanhas de ${mask(row.level, row.name)}`} onClick={() => drillDown(row)}>
                          <CornerDownRight className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      )}
                    </td>
                    <td className={cn('overflow-hidden px-4 py-3', STICKY)} style={{ ...fixed(statusWidth), left: CHECK_W + MENU_W }}>
                      {row.level === 'account' ? (
                        <span className="text-xs">{accountStatusLabel(accountsById.get(accountKey(row.id))?.accountStatus)}</span>
                      ) : control && (row.status === 'ACTIVE' || row.status === 'PAUSED') ? (
                        <span className="flex items-center gap-2" title={statusLabel(row.effectiveStatus ?? row.status)}>
                          <Switch
                            checked={row.status === 'ACTIVE'}
                            disabled={busy}
                            onCheckedChange={(on) => setStatusTarget({ row: control, action: on ? 'activate' : 'pause' })}
                            aria-label={row.status === 'ACTIVE' ? `Pausar ${mask(row.level, row.name)}` : `Ativar ${mask(row.level, row.name)}`}
                          />
                          {busy ? (
                            <span className="truncate text-xs text-muted-foreground">Aplicando…</span>
                          ) : row.effectiveStatus && row.effectiveStatus !== row.status && (
                            <span className="truncate text-xs text-muted-foreground">{statusLabel(row.effectiveStatus)}</span>
                          )}
                        </span>
                      ) : (
                        <CampaignStatusBadge status={row.status} effectiveStatus={row.effectiveStatus} busy={busy} />
                      )}
                    </td>
                    <td className={cn('border-r border-border px-4 py-3', STICKY)} style={{ ...fixed(nameColumn.width), left: nameLeft }}>
                      {NEXT_LEVEL[row.level] ? (
                        <button type="button" className="block max-w-full truncate text-left hover:underline" title={`Ver ${LEVELS.find((l) => l.value === NEXT_LEVEL[row.level])?.label.toLowerCase()} de ${mask(row.level, row.name)}`} onClick={() => drillDown(row)}>
                          {mask(row.level, row.name)}
                        </button>
                      ) : (
                        <span className="block truncate" title={mask(row.level, row.name)}>{mask(row.level, row.name)}</span>
                      )}
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.level === 'account' ? `${row.accountCurrency} · ${mask('id', accountKey(row.id))}` : mask('id', row.id)}
                        {row.accountCurrency !== 'BRL' && row.spendNative !== null && ` · ${formatCurrency(row.spendNative, row.accountCurrency)} na conta`}
                      </span>
                    </td>
                    {level === 'account' && (
                      <td className="overflow-hidden text-ellipsis whitespace-nowrap px-4 py-3 text-right tabular-nums" style={fixed(colWidths.widthOf('budget', BUDGET_WIDTH))} title="Saldo a cobrar no ciclo atual">
                        {formatCurrency(budget(accountsById.get(accountKey(row.id))?.cycleSpend ?? null, row.accountCurrency), currency)}
                      </td>
                    )}
                    {(level === 'campaign' || level === 'adset') && (
                      <td className="overflow-hidden text-ellipsis whitespace-nowrap px-4 py-3 text-right tabular-nums" style={fixed(colWidths.widthOf('budget', BUDGET_WIDTH))}>
                        {row.budgetLevel === row.level && (row.dailyBudget != null || row.lifetimeBudget != null) ? (
                          <button
                            type="button"
                            className="group/budget inline-flex max-w-full items-center justify-end gap-1.5 rounded px-1 -mx-1 hover:bg-foreground/5 disabled:opacity-50"
                            disabled={busy}
                            onClick={() => setBudgetRow(control)}
                            title="Alterar orçamento"
                            aria-label={`Alterar orçamento de ${mask(row.level, row.name)}`}
                          >
                            {/* Lápis aparece ao passar o mouse; clicar nele ou no valor abre o orçamento. */}
                            <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/budget:opacity-100 group-focus-visible/budget:opacity-100" aria-hidden="true" />
                            <span className="truncate">
                              {row.dailyBudget != null
                                ? `${formatCurrency(budget(row.dailyBudget, row.accountCurrency), currency)}/dia`
                                : `${formatCurrency(budget(row.lifetimeBudget, row.accountCurrency), currency)} total`}
                            </span>
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {row.budgetLevel === 'campaign' ? 'Na campanha' : row.budgetLevel === 'adset' ? 'Nos conjuntos' : '—'}
                          </span>
                        )}
                      </td>
                    )}
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={cn('overflow-hidden text-ellipsis whitespace-nowrap px-4 py-3 text-right tabular-nums', c.key !== 'createdTime' && signClass(c.key, row[c.key]))} style={fixed(colWidths.widthOf(c.key, DEFAULT_WIDTH[c.kind] ?? 112))}>
                        {c.key === 'createdTime' ? formatCreated(row.createdTime) : formatMetric(c.kind === 'money' ? money(row[c.key]) : row[c.key], c.kind, currency)}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={5 + visibleColumns.length} className="p-6 text-center text-sm text-muted-foreground">Nada encontrado para este filtro e período.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePagination page={page.page} pages={page.pages} total={page.total} size={PAGE_SIZE} noun={levelInfo.label.toLowerCase()}
          onPage={(next) => setPageState({ key: pageKey, page: next })} />
        </div>
      )}

      {phone && level !== 'account' && selectedRows.length > 0 && (
        <BulkActionBar
          count={selectedRows.length}
          onActivate={() => setBulkAction('activate')}
          onPause={() => setBulkAction('pause')}
          onClear={() => setLevelSelection(level, [])}
        />
      )}

      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Filtros e ordem</DialogTitle>
            <DialogDescription>{levelInfo.label} · {rows.length} no filtro atual</DialogDescription>
          </DialogHeader>
          {level !== 'account' && (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-xs font-medium text-muted-foreground">Status</legend>
              <Segmented
                fill
                label="Status"
                value={statusFilter}
                onChange={(value) => setStatusFilter(value as StatusFilter)}
                options={[{ value: 'all', label: 'Todos' }, { value: 'active', label: 'Ativos' }, { value: 'paused', label: 'Pausados' }]}
              />
            </fieldset>
          )}
          <fieldset className="space-y-2">
            <legend className="mb-2 text-xs font-medium text-muted-foreground">Moeda</legend>
            <Segmented
              fill
              label="Moeda"
              value={currency}
              onChange={(value) => setCurrency(value as ViewCurrency)}
              options={[{ value: 'BRL', label: 'R$ · Real' }, { value: 'USD', label: 'US$ · Dólar' }]}
            />
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-xs font-medium text-muted-foreground">Ordenar por</legend>
            <select aria-label="Ordenar por" className={cn(selectClass, 'h-11 w-full')} value={prefs.sort.key}
              onChange={(e) => updatePrefs({ sort: { key: e.target.value as SortState['key'], dir: prefs.sort.dir } })}>
              <option value="name">Nome</option>
              {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <Segmented
              fill
              label="Direção"
              value={prefs.sort.dir}
              onChange={(value) => updatePrefs({ sort: { key: prefs.sort.key, dir: value as 'asc' | 'desc' } })}
              options={[{ value: 'desc', label: prefs.sort.key === 'name' ? 'Z → A' : 'Maior primeiro' }, { value: 'asc', label: prefs.sort.key === 'name' ? 'A → Z' : 'Menor primeiro' }]}
            />
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={!activeFilters}
              onClick={() => { setStatusFilter('all'); setCurrency('BRL'); updatePrefs({ sort: DEFAULT_PREFS.sort }); }}>
              Restaurar
            </Button>
            <Button type="button" onClick={() => setFiltersOpen(false)}>Ver {rows.length} {rows.length === 1 ? levelInfo.noun : levelInfo.label.toLowerCase()}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <StatusConfirmDialog
        target={statusTarget}
        busy={single.isPending}
        onCancel={() => setStatusTarget(null)}
        onConfirm={() => statusTarget && single.mutate({ objectId: statusTarget.row.id, level: statusTarget.row.level, action: statusTarget.action })}
      />

      <BudgetDialog
        row={budgetRow}
        busy={single.isPending}
        onClose={() => setBudgetRow(null)}
        onConfirm={(row, kind, value) => {
          single.mutate({ objectId: row.id, level: row.level, action: kind === 'daily' ? 'set_daily_budget' : 'set_lifetime_budget', value });
        }}
      />

      <Dialog open={bulkAction !== null} onOpenChange={(open) => { if (!open && !bulk.isPending) setBulkAction(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{bulkAction === 'pause' ? 'Pausar' : 'Ativar'} {selectedRows.length} {levelInfo.label.toLowerCase()}?</DialogTitle>
            <DialogDescription>A alteração vai direto para a Meta, um item por vez.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
            {selectedRows.slice(0, 40).map((r) => <li key={r.id} className="truncate">{mask(r.level, r.name)}</li>)}
          </ul>
          {selectedRows.length > 40 && <p className="text-xs text-muted-foreground">Só os primeiros 40 entram neste lote.</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkAction(null)} disabled={bulk.isPending}>Cancelar</Button>
            <Button
              disabled={bulk.isPending}
              onClick={() => {
                if (!bulkAction || level === 'account') return;
                bulk.mutate(selectedRows.slice(0, 40).map((r) => ({ objectId: r.id, level, action: bulkAction })));
              }}
            >
              {bulk.isPending ? 'Enviando...' : bulkAction === 'pause' ? 'Pausar' : 'Ativar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function profitClass(value: number | null) {
  if (value === null || value === 0) return '';
  return value > 0 ? 'text-success' : 'text-destructive';
}

function SortButton({ label, active, dir, onClick, align }: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
  align?: 'right';
}) {
  // Clique ordena decrescente; de novo, crescente. A seta mostra a ordem atual; nas outras colunas fica o ícone neutro.
  const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={onClick}
      title={active ? (dir === 'desc' ? 'Ordenado do maior para o menor · clique para inverter' : 'Ordenado do menor para o maior · clique para inverter') : 'Clique para ordenar'}
      className={cn('group inline-flex items-center gap-1 hover:text-foreground', align === 'right' && 'flex-row-reverse', active && 'font-medium text-foreground')}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      {label}
      <Icon className={cn('h-3.5 w-3.5 shrink-0', active ? 'text-primary' : 'opacity-40 group-hover:opacity-80')} aria-hidden="true" />
    </button>
  );
}
