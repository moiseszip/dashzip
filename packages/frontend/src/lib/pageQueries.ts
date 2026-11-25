import { api } from '@/lib/api';
import { campaignsApi, type DateRange, type Level } from '@/lib/campaigns';
import { queryClient } from '@/lib/queryClient';
import { registerDataPrefetch } from '@/lib/routes';
import { presetSelection } from '@/lib/resultDates';
import { summaryApi, type SummaryDateRange, type SummaryFilters } from '@/lib/summary';
import { testsApi } from '@/lib/testTracking';
import type { SalesResponse } from '@/hooks/useSales';

/**
 * Chave e busca de cada tela num lugar só. A tela usa estas definições e o menu
 * usa as mesmas para buscar os dados antes do toque: ao abrir, já estão no cache.
 */
export const EMPTY_SUMMARY_FILTERS: SummaryFilters = { accountIds: [], products: [], platforms: [] };

export const summaryQuery = (id: string, range: SummaryDateRange, filters: SummaryFilters, compare: boolean) => ({
  queryKey: ['summary', id, range, filters, compare] as const,
  queryFn: () => summaryApi.get(id, range, filters, compare),
  staleTime: 60_000,
});

export const summaryLayoutQuery = (id: string) => ({
  queryKey: ['summary-layout', id] as const,
  queryFn: () => summaryApi.layout(id),
});

export const campaignsQuery = (id: string, level: Level, period: DateRange) => ({
  queryKey: ['campaigns', id, level, period.since, period.until] as const,
  queryFn: () => campaignsApi.objects(id, level, period),
  staleTime: 60_000,
});

export const campaignColumnsQuery = (id: string) => ({
  queryKey: ['campaign-columns', id] as const,
  queryFn: () => campaignsApi.columns(id),
  staleTime: Infinity,
});

export const salesQuery = (id: string, range: DateRange) => ({
  queryKey: ['sales', id, range.since, range.until] as const,
  queryFn: () => api.get<SalesResponse>(`/sales?workspace_id=${id}&since=${range.since}&until=${range.until}`),
});

export const testMatrixQuery = (id: string, period: DateRange) => ({
  queryKey: ['test-matrix', id, period.since, period.until] as const,
  queryFn: () => testsApi.matrix(id, period),
  staleTime: 60_000,
});

export const testChangesQuery = (id: string) => ({
  queryKey: ['test-changes', id] as const,
  queryFn: () => testsApi.changes(id),
  staleTime: 60_000,
});

let activeWorkspace: string | null = null;

/** Painel ativo, definido pelo WorkspaceProvider (o menu não precisa conhecê-lo). */
export function setPrefetchWorkspace(id: string | null) {
  activeWorkspace = id;
}

/** Busca os dados da tela no período padrão dela. Se já estão frescos no cache, não faz nada. */
export function prefetchPageData(path: string, workspaceId: string | null = activeWorkspace) {
  if (!workspaceId) return;
  const prefetch = (options: { queryKey: readonly unknown[]; queryFn: () => Promise<unknown>; staleTime?: number }) =>
    void queryClient.prefetchQuery(options).catch(() => undefined);
  switch (path) {
    case '/finance':
      prefetch(summaryQuery(workspaceId, presetSelection('today').range, EMPTY_SUMMARY_FILTERS, false));
      prefetch(summaryLayoutQuery(workspaceId));
      break;
    case '/campaigns/meta':
      prefetch(campaignsQuery(workspaceId, 'campaign', presetSelection('today').range));
      prefetch(campaignColumnsQuery(workspaceId));
      break;
    case '/sales':
      prefetch(salesQuery(workspaceId, presetSelection('last7').range));
      break;
    case '/tests':
      prefetch(testMatrixQuery(workspaceId, presetSelection('last7').range));
      prefetch(testChangesQuery(workspaceId));
      break;
  }
}

registerDataPrefetch((path) => prefetchPageData(path));
