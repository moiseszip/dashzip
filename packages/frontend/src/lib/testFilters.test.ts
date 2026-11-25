import { describe, expect, it } from 'vitest';
import type { TestCell, TestRow } from '@/lib/testTracking';
import {
  DEFAULT_FILTERS, UNASSIGNED, activeFilterCount, cleanFilters, filterItems, groupByOffer, matchesSearch,
  meetsConditions, paginate, sortItems, toggleHeaderSort, type TestItem,
} from '@/lib/testFilters';

const cell = (over: Partial<TestCell> = {}): TestCell => ({
  spend: 100, mediaTax: 0, grossRevenue: 0, netRevenue: 0, salesTax: 0, profit: -100, sales: 0, impressions: 1000, clicks: 10, initiateCheckouts: 0, ...over,
});

function item(id: string, over: Partial<TestRow> = {}, total: Partial<TestCell> = {}, cells: Record<string, Partial<TestCell>> = {}): TestItem {
  return {
    row: {
      id, name: `Campanha ${id}`, accountId: 'act_1', accountCurrency: 'BRL', accountName: 'CA 01', status: 'ACTIVE',
      effectiveStatus: 'ACTIVE', dailyBudget: 50, lifetimeBudget: null, budgetLevel: 'campaign', offerId: null, byDay: {}, ...over,
    },
    total: cell(total),
    cells: Object.fromEntries(Object.entries(cells).map(([key, value]) => [key, cell(value)])),
  };
}

describe('matchesSearch', () => {
  it('vírgula é OU, "-" exclui e ignora acento e caixa', () => {
    expect(matchesSearch('[BR] ARC Criativo', 'gmd, arc')).toBe(true);
    expect(matchesSearch('[BR] ARC Criativo', 'arc, -criativo')).toBe(false);
    expect(matchesSearch('Campanha São Paulo', 'sao')).toBe(true);
    expect(matchesSearch('Qualquer', '')).toBe(true);
  });
});

describe('meetsConditions', () => {
  it('compara totais e trata margem em %', () => {
    const total = cell({ spend: 100, mediaTax: 5, grossRevenue: 400, netRevenue: 350, salesTax: 35, profit: 120, sales: 4 });
    expect(meetsConditions(total, [{ id: '1', metric: 'sales', op: '>=', value: '4' }])).toBe(true);
    expect(meetsConditions(total, [{ id: '1', metric: 'margin', op: '>', value: '33' }])).toBe(true);
    expect(meetsConditions(total, [{ id: '1', metric: 'roi', op: '=', value: '3' }])).toBe(true);
    expect(meetsConditions(total, [{ id: '1', metric: 'profit', op: '<', value: '100,5' }])).toBe(false);
    expect(meetsConditions(total, [{ id: '1', metric: 'cpa', op: '=', value: '' }])).toBe(true);
  });
});

describe('filterItems', () => {
  it('filtra por oferta (inclusive sem oferta), conta e status', () => {
    const items = [
      item('1', { offerId: 'arc' }),
      item('2', { offerId: null, status: 'PAUSED' }),
      item('3', { offerId: 'gmd', accountId: 'act_2' }),
    ];
    expect(filterItems(items, { ...DEFAULT_FILTERS, offers: ['arc', UNASSIGNED] }).map((i) => i.row.id)).toEqual(['1', '2']);
    expect(filterItems(items, { ...DEFAULT_FILTERS, accounts: ['act_2'] }).map((i) => i.row.id)).toEqual(['3']);
    expect(filterItems(items, { ...DEFAULT_FILTERS, status: 'paused' }).map((i) => i.row.id)).toEqual(['2']);
  });
});

describe('sortItems', () => {
  it('ordena em vários níveis e deixa vazio por último', () => {
    const items = [
      item('a', {}, { profit: 50, spend: 10 }),
      item('b', {}, { profit: 50, spend: 30 }),
      item('c', {}, { profit: null, spend: 99 }),
      item('d', {}, { profit: 80, spend: 5 }),
    ];
    const ids = (rules: Parameters<typeof sortItems>[1]) => sortItems(items, rules).map((i) => i.row.id);
    expect(ids([{ key: 'profit', dir: 'desc' }, { key: 'spend', dir: 'desc' }])).toEqual(['d', 'b', 'a', 'c']);
    expect(ids([{ key: 'profit', dir: 'asc' }, { key: 'spend', dir: 'asc' }])).toEqual(['a', 'b', 'd', 'c']);
  });

  it('ordena pelo lucro de uma coluna de período', () => {
    const items = [item('a', {}, {}, { '2026-11-20': { profit: 5 } }), item('b', {}, {}, { '2026-11-20': { profit: 9 } }), item('c')];
    expect(sortItems(items, [{ key: 'period:2026-11-20', dir: 'desc' }]).map((i) => i.row.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('groupByOffer', () => {
  it('agrupa, soma o total e ordena os grupos pela primeira regra com "Sem oferta" no fim', () => {
    const items = [
      item('1', { offerId: 'arc' }, { profit: 10 }),
      item('2', { offerId: null }, { profit: 500 }),
      item('3', { offerId: 'gmd' }, { profit: 40 }),
      item('4', { offerId: 'arc' }, { profit: 20 }),
    ];
    const groups = groupByOffer(items, [{ id: 'arc', name: 'ARC' }, { id: 'gmd', name: 'GMD' }], [{ key: 'profit', dir: 'desc' }]);
    expect(groups.map((g) => g.name)).toEqual(['GMD', 'ARC', 'Sem oferta']);
    expect(groups[1].total.profit).toBe(30);
    expect(groups[1].items.map((i) => i.row.id)).toEqual(['1', '4']);
  });
});

describe('paginate', () => {
  it('fatia em 25 e corrige a página fora do intervalo', () => {
    const list = Array.from({ length: 60 }, (_, index) => index);
    expect(paginate(list, 1)).toMatchObject({ page: 1, pages: 3, total: 60 });
    expect(paginate(list, 3).items).toEqual(list.slice(50));
    expect(paginate(list, 9).page).toBe(3);
    expect(paginate([], 1)).toMatchObject({ page: 1, pages: 1, items: [] });
  });
});

describe('toggleHeaderSort e filtros salvos', () => {
  it('cabeçalho alterna desc → asc → padrão', () => {
    const first = toggleHeaderSort(DEFAULT_FILTERS.sort, 'spend');
    expect(first).toEqual([{ key: 'spend', dir: 'desc' }]);
    const second = toggleHeaderSort(first, 'spend');
    expect(second).toEqual([{ key: 'spend', dir: 'asc' }]);
    expect(toggleHeaderSort(second, 'spend')).toEqual(DEFAULT_FILTERS.sort);
  });

  it('descarta valores desconhecidos e conta filtros ativos', () => {
    const clean = cleanFilters({ status: 'x', sort: [{ key: 'drop table', dir: 'asc' }, { key: 'roi', dir: 'asc' }], groupByOffer: true, offers: ['arc', 3] });
    expect(clean).toMatchObject({ status: 'all', sort: [{ key: 'roi', dir: 'asc' }], groupByOffer: true, offers: ['arc'] });
    expect(activeFilterCount(clean)).toBe(3);
    expect(cleanFilters(null)).toEqual(DEFAULT_FILTERS);
  });
});
