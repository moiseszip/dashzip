import { useQuery } from '@tanstack/react-query';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { api } from '@/lib/api';
import { salesQuery } from '@/lib/pageQueries';

/** Intervalo do seletor de datas, em dias de São Paulo (YYYY-MM-DD). */
export interface SalesRange { since: string; until: string }
export type PurchaseStatus = 'sent' | 'failed' | 'pending' | null;

export interface SaleOrder {
  id: string;
  orderId: string;
  lineIds: string[];
  soldAt: string;
  status: string;
  amount: number;
  currency: string;
  paymentMethod: string | null;
  platform: string | null;
  products: { name: string; amount: number; isOrderBump: boolean }[];
  customer: { name: string | null; email: string | null; phone: string | null };
  utm: { source: string | null; medium: string | null; campaign: string | null; content: string | null; term: string | null };
  adId: string | null;
  matched: boolean;
  matchMethod: string | null;
  purchase: PurchaseStatus;
  purchaseError: string | null;
  /** 'wiapy': pedido lido na hora da Wiapy, sem webhook (sem visita nem Purchase no dash.zip). Ausente em API antiga. */
  source?: 'webhook' | 'wiapy';
}

export interface MethodSummary {
  approved: number;
  approvedAmount: number;
  generated: number;
  /** Pagos (inclui estornados depois) ÷ gerados. */
  approvalRate: number | null;
}

export interface SalesSummary {
  orders: number;
  revenue: number;
  /** Depois das taxas do checkout, como no Resultado. Ausente em API antiga. */
  netRevenue?: number | null;
  refunded: number;
  pending: number;
  pendingAmount?: number;
  matched: number;
  purchaseSent: number;
  pix?: MethodSummary;
  card?: MethodSummary;
  currency: string;
}

export interface SalesResponse {
  summary: SalesSummary;
  orders: SaleOrder[];
  truncated: boolean;
  /** 'wiapy': o período veio da Wiapy (unido ao webhook). */
  source?: 'wiapy' | 'webhook';
  warnings?: string[];
}

export interface PurchaseEvent {
  id: string;
  event_id: string;
  sale_id: string | null;
  status: 'sent' | 'failed' | 'pending' | string;
  attempts: number;
  payload: unknown;
  response: unknown;
  fbtrace_id: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

/** O Purchase do pedido como saiu para o Meta. Só busca com o detalhe aberto. */
export function usePurchaseEvents(lineIds: string[], enabled: boolean) {
  const { activeWorkspaceId } = useWorkspaceContext();
  // Só linhas gravadas (uuid): as lidas da Wiapy não têm Purchase no dash.zip.
  const ids = lineIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 20).join(',');
  const query = useQuery<{ events: PurchaseEvent[] }, Error>({
    queryKey: ['sale-purchase', activeWorkspaceId, ids],
    enabled: enabled && !!activeWorkspaceId && !!ids,
    retry: false,
    queryFn: () => api.get(`/sales/purchase?workspace_id=${activeWorkspaceId}&sale_ids=${ids}`),
  });
  return { events: query.data?.events ?? null, loading: query.isLoading, error: query.error?.message ?? null };
}

/** Vendas da área no período. Atualiza sozinho a cada 30 segundos. */
export function useSales(range: SalesRange) {
  const { activeWorkspaceId } = useWorkspaceContext();
  const query = useQuery<SalesResponse, Error>({
    ...salesQuery(activeWorkspaceId ?? '', range),
    enabled: !!activeWorkspaceId,
    retry: false,
    refetchInterval: 30_000,
    // Trocar o período mantém a lista na tela enquanto chega a nova (no mesmo painel).
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === activeWorkspaceId ? previous : undefined),
  });
  return {
    data: query.data ?? null,
    loading: query.isLoading,
    fetching: query.isFetching,
    error: query.error?.message ?? null,
  };
}
