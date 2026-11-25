/**
 * Filtro do Acompanhamento de testes:
 * busca com vírgula = OU e "-termo" exclui, oferta e conta em múltipla escolha,
 * status, condições sobre os totais do período, ordenação em até três níveis
 * (inclusive pelo lucro de um dia/semana/mês) e agrupamento por oferta.
 * Tudo roda no navegador sobre a matriz que já veio da API; nada é gravado no servidor.
 */
import { dashboardRoi } from '@/lib/dashboardFinance';
import type { TestCell, TestOffer, TestRow } from '@/lib/testTracking';

export { PAGE_SIZE, paginate } from '@/lib/pagination';
export const UNASSIGNED = ':unassigned';

export type MetricKey = 'profit' | 'spend' | 'grossRevenue' | 'sales' | 'roi' | 'margin' | 'cpa' | 'cpc' | 'cpm';
/** `period:<chave>` ordena pelo lucro de uma coluna de dia/semana/mês. */
export type SortKey = MetricKey | 'name' | 'status' | `period:${string}`;
export type SortDir = 'asc' | 'desc';
export interface SortRule { key: SortKey; dir: SortDir }

export type Operator = '>=' | '>' | '=' | '<' | '<=';
export interface Condition { id: string; metric: MetricKey; op: Operator; value: string }
export type StatusFilter = 'all' | 'active' | 'paused';

export interface TestFilters {
  search: string;
  offers: string[];
  accounts: string[];
  status: StatusFilter;
  conditions: Condition[];
  sort: SortRule[];
  groupByOffer: boolean;
}

export const METRICS: { key: MetricKey; label: string }[] = [
  { key: 'profit', label: 'Lucro' },
  { key: 'spend', label: 'Gasto' },
  { key: 'grossRevenue', label: 'Faturamento' },
  { key: 'sales', label: 'Vendas' },
  { key: 'roi', label: 'ROI' },
  { key: 'margin', label: 'Margem' },
  { key: 'cpa', label: 'CPA' },
  { key: 'cpc', label: 'CPC' },
  { key: 'cpm', label: 'CPM' },
];

export const SORT_FIELDS: { key: MetricKey | 'name' | 'status'; label: string }[] = [
  ...METRICS,
  { key: 'name', label: 'Nome' },
  { key: 'status', label: 'Status' },
];

/** Atalhos de ordenação; cada um vira uma regra. */
export const SORT_PRESETS: { id: string; label: string; sort: SortRule[] }[] = [
  { id: 'profit-desc', label: 'Mais lucro', sort: [{ key: 'profit', dir: 'desc' }] },
  { id: 'profit-asc', label: 'Mais prejuízo', sort: [{ key: 'profit', dir: 'asc' }] },
  { id: 'roi-desc', label: 'Maior ROI', sort: [{ key: 'roi', dir: 'desc' }] },
  { id: 'spend-desc', label: 'Mais gasto', sort: [{ key: 'spend', dir: 'desc' }] },
  { id: 'sales-desc', label: 'Mais vendas', sort: [{ key: 'sales', dir: 'desc' }] },
  { id: 'name-asc', label: 'Nome (A-Z)', sort: [{ key: 'name', dir: 'asc' }] },
];

export const MAX_SORT_RULES = 3;

export const DEFAULT_FILTERS: TestFilters = {
  search: '', offers: [], accounts: [], status: 'all', conditions: [],
  sort: [{ key: 'profit', dir: 'desc' }], groupByOffer: false,
};

export interface TestItem {
  row: TestRow;
  total: TestCell;
  /** Célula de cada coluna de dia/semana/mês, pela chave do grupo. */
  cells: Record<string, TestCell>;
}

export interface OfferGroup {
  offerId: string;
  name: string;
  items: TestItem[];
  total: TestCell;
  cells: Record<string, TestCell>;
}

const divide = (value: number | null, base: number | null, factor = 1) =>
  value !== null && base ? (value * factor) / base : null;

export function metricOf(cell: TestCell, key: MetricKey): number | null {
  switch (key) {
    case 'profit': return cell.profit;
    case 'spend': return cell.spend;
    case 'grossRevenue': return cell.grossRevenue;
    case 'sales': return cell.sales;
    case 'roi': return dashboardRoi(cell.netRevenue, cell.salesTax, cell.spend, cell.mediaTax);
    case 'margin': return divide(cell.profit, cell.netRevenue);
    case 'cpa': return cell.sales > 0 ? divide(cell.spend, cell.sales) : null;
    case 'cpc': return divide(cell.spend, cell.clicks);
    case 'cpm': return divide(cell.spend, cell.impressions, 1000);
  }
}

const EMPTY: TestCell = {
  spend: 0, mediaTax: 0, grossRevenue: 0, netRevenue: 0, salesTax: 0, profit: 0, sales: 0, impressions: 0, clicks: 0, initiateCheckouts: 0,
};

/** Soma com a mesma regra de sumTestCells: um valor desconhecido deixa o total desconhecido. */
export function addCells(cells: TestCell[]): TestCell {
  const sum = (key: keyof TestCell) => cells.reduce<number | null>(
    (total, cell) => (total === null || cell[key] === null ? null : total + (cell[key] as number)), 0,
  );
  if (!cells.length) return EMPTY;
  return {
    spend: sum('spend'), mediaTax: sum('mediaTax'), grossRevenue: sum('grossRevenue'), netRevenue: sum('netRevenue'), salesTax: sum('salesTax'),
    profit: sum('profit'), sales: sum('sales') ?? 0, impressions: sum('impressions'), clicks: sum('clicks'),
    initiateCheckouts: sum('initiateCheckouts'),
  };
}

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');

/** Termos separados por vírgula = OU; termo com "-" na frente exclui. Procura no nome e no ID. */
export function matchesSearch(haystack: string, search: string): boolean {
  const terms = search.split(',').map((term) => fold(term.trim())).filter(Boolean);
  if (!terms.length) return true;
  const text = fold(haystack);
  const exclude = terms.filter((term) => term.startsWith('-') && term.length > 1).map((term) => term.slice(1));
  const include = terms.filter((term) => !term.startsWith('-'));
  if (exclude.some((term) => text.includes(term))) return false;
  return include.length === 0 || include.some((term) => text.includes(term));
}

/** Número digitado em pt-BR ("1.234,5" ou "1234.5"); vazio ou inválido não filtra. */
export function parseInputNumber(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

/** Margem é digitada em % (30 = 30%); o resto no valor da coluna (R$, vendas, ROI). */
export function meetsConditions(cell: TestCell, conditions: Condition[]): boolean {
  return conditions.every((condition) => {
    const input = parseInputNumber(condition.value);
    if (input === null) return true;
    const value = metricOf(cell, condition.metric);
    if (value === null) return false;
    const target = condition.metric === 'margin' ? input / 100 : input;
    switch (condition.op) {
      case '>=': return value >= target;
      case '>': return value > target;
      case '=': return Math.abs(value - target) < 1e-9;
      case '<': return value < target;
      case '<=': return value <= target;
    }
  });
}

export function filterItems(items: TestItem[], filters: TestFilters): TestItem[] {
  return items.filter(({ row, total }) =>
    (!filters.offers.length || filters.offers.includes(row.offerId ?? UNASSIGNED))
    && (!filters.accounts.length || filters.accounts.includes(row.accountId))
    && (filters.status === 'all' || (filters.status === 'active' ? row.status === 'ACTIVE' : row.status !== 'ACTIVE'))
    && matchesSearch(`${row.name} ${row.id}`, filters.search)
    && meetsConditions(total, filters.conditions));
}

function valueFor(item: Pick<TestItem, 'total' | 'cells'>, key: SortKey): number | null {
  if (key.startsWith('period:')) return item.cells[key.slice(7)]?.profit ?? null;
  return metricOf(item.total, key as MetricKey);
}

/** Comparação por regras em sequência; vazio fica sempre por último, em qualquer direção. */
export function compareItems(a: TestItem, b: TestItem, rules: SortRule[]): number {
  for (const { key, dir } of rules) {
    const factor = dir === 'asc' ? 1 : -1;
    let result = 0;
    if (key === 'name') result = a.row.name.localeCompare(b.row.name, 'pt-BR') * factor;
    else if (key === 'status') {
      const rank = (item: TestItem) => (item.row.status === 'ACTIVE' ? 0 : item.row.status === 'PAUSED' ? 1 : 2);
      result = (rank(a) - rank(b)) * factor;
    } else {
      const av = valueFor(a, key);
      const bv = valueFor(b, key);
      if (av === null && bv === null) result = 0;
      else if (av === null) return 1;
      else if (bv === null) return -1;
      else result = (av - bv) * factor;
    }
    if (result !== 0) return result;
  }
  return a.row.name.localeCompare(b.row.name, 'pt-BR');
}

export function sortItems(items: TestItem[], rules: SortRule[]): TestItem[] {
  return [...items].sort((a, b) => compareItems(a, b, rules));
}

/**
 * Agrupa por oferta. Os grupos seguem a primeira regra de ordenação aplicada ao total
 * do grupo (nome da oferta quando a regra é nome ou status); "Sem oferta" vai por último.
 * Dentro de cada grupo as campanhas mantêm a ordenação completa.
 */
export function groupByOffer(sorted: TestItem[], offers: Pick<TestOffer, 'id' | 'name'>[], rules: SortRule[]): OfferGroup[] {
  const names = new Map(offers.map((offer) => [offer.id, offer.name]));
  const byOffer = new Map<string, TestItem[]>();
  for (const item of sorted) {
    const id = item.row.offerId ?? UNASSIGNED;
    byOffer.set(id, [...(byOffer.get(id) ?? []), item]);
  }
  const groups: OfferGroup[] = [...byOffer].map(([offerId, items]) => {
    const keys = new Set(items.flatMap((item) => Object.keys(item.cells)));
    return {
      offerId,
      name: offerId === UNASSIGNED ? 'Sem oferta' : names.get(offerId) ?? 'Oferta removida',
      items,
      total: addCells(items.map((item) => item.total)),
      cells: Object.fromEntries([...keys].map((key) => [key, addCells(items.flatMap((item) => item.cells[key] ? [item.cells[key]] : []))])),
    };
  });
  const primary = rules[0] ?? DEFAULT_FILTERS.sort[0];
  return groups.sort((a, b) => {
    if (a.offerId === UNASSIGNED) return 1;
    if (b.offerId === UNASSIGNED) return -1;
    if (primary.key === 'name' || primary.key === 'status') return a.name.localeCompare(b.name, 'pt-BR') * (primary.dir === 'asc' ? 1 : -1);
    const av = valueFor(a, primary.key);
    const bv = valueFor(b, primary.key);
    if (av === null || bv === null) return av === bv ? a.name.localeCompare(b.name, 'pt-BR') : av === null ? 1 : -1;
    return (av - bv) * (primary.dir === 'asc' ? 1 : -1) || a.name.localeCompare(b.name, 'pt-BR');
  });
}

/** Clique no cabeçalho: decrescente → crescente → volta ao padrão. */
export function toggleHeaderSort(current: SortRule[], key: SortKey): SortRule[] {
  const first = current[0];
  if (first?.key !== key) return [{ key, dir: 'desc' }];
  if (first.dir === 'desc') return [{ key, dir: 'asc' }];
  return DEFAULT_FILTERS.sort;
}

export function activeFilterCount(filters: TestFilters): number {
  const defaultSort = JSON.stringify(filters.sort) === JSON.stringify(DEFAULT_FILTERS.sort);
  return Number(filters.offers.length > 0) + Number(filters.accounts.length > 0) + Number(filters.status !== 'all')
    + filters.conditions.filter((condition) => parseInputNumber(condition.value) !== null).length
    + Number(!defaultSort) + Number(filters.groupByOffer);
}

const SORT_KEY = /^(profit|spend|grossRevenue|sales|roi|margin|cpa|cpc|cpm|name|status|period:[\w-]+)$/;
const METRIC_KEYS = new Set<string>(METRICS.map((metric) => metric.key));
const OPERATORS = new Set<string>(['>=', '>', '=', '<', '<=']);

/** Lê o filtro salvo no navegador descartando o que não for reconhecido. */
export function cleanFilters(raw: unknown): TestFilters {
  if (!raw || typeof raw !== 'object') return DEFAULT_FILTERS;
  const value = raw as Record<string, unknown>;
  const strings = (list: unknown) => (Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []);
  const sort = Array.isArray(value.sort)
    ? value.sort.flatMap((rule) => {
      const candidate = rule as Partial<SortRule> | null;
      return candidate && typeof candidate.key === 'string' && SORT_KEY.test(candidate.key) && !candidate.key.startsWith('period:')
        ? [{ key: candidate.key as SortKey, dir: candidate.dir === 'asc' ? 'asc' as const : 'desc' as const }]
        : [];
    }).slice(0, MAX_SORT_RULES)
    : [];
  const conditions = Array.isArray(value.conditions)
    ? value.conditions.flatMap((condition) => {
      const candidate = condition as Partial<Condition> | null;
      return candidate && typeof candidate.id === 'string' && METRIC_KEYS.has(String(candidate.metric)) && OPERATORS.has(String(candidate.op))
        ? [{ id: candidate.id, metric: candidate.metric as MetricKey, op: candidate.op as Operator, value: String(candidate.value ?? '') }]
        : [];
    })
    : [];
  return {
    search: typeof value.search === 'string' ? value.search : '',
    offers: strings(value.offers),
    accounts: strings(value.accounts),
    status: value.status === 'active' || value.status === 'paused' ? value.status : 'all',
    conditions,
    sort: sort.length ? sort : DEFAULT_FILTERS.sort,
    groupByOffer: value.groupByOffer === true,
  };
}
