import { useQuery } from '@tanstack/react-query';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { api } from '@/lib/api';

export const UTM_KEYS = ['source', 'medium', 'campaign', 'content', 'term'] as const;
export type UtmKey = (typeof UTM_KEYS)[number];

export type CapiStatus = 'sent' | 'failed' | 'pending';

/** Um envio à CAPI da Meta. */
export interface LiveCapiEvent {
  id: string;
  eventName: string;
  status: CapiStatus;
  error: string | null;
  createdAt: string;
  sessionId: string | null;
  value: number | null;
  currency: string | null;
  page: string | null;
  country: string | null;
}

export interface LiveMetaEvent {
  name: string;
  count: number;
  status: CapiStatus;
}

export interface LiveVisit {
  sessionId: string;
  visitorId: string;
  startedAt: string;
  lastSeenAt: string;
  online: boolean;
  /** O último evento foi uma saída: fechou a página ou trocou de aba. */
  exited: boolean;
  page: string;
  /** utm_source; sem ele, o site de onde veio. */
  source: string | null;
  /** Os UTMs do link da entrada, só os que vieram preenchidos. */
  utm: Partial<Record<UtmKey, string>>;
  /** Clique em anúncio: fbclid (Meta) ou gclid (Google). */
  clickId: 'fbclid' | 'gclid' | null;
  adId: string | null;
  device: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  pageviews: number;
  checkoutClick: boolean;
  /** Ausente quando o backend ainda é da versão anterior. */
  metaEvents?: LiveMetaEvent[];
}

export interface LiveSnapshot {
  online: number;
  visits: number;
  countries: { country: string | null; visits: number; online: number }[];
  list: LiveVisit[];
  capi?: LiveCapiEvent[];
  capiSummary?: { sent: number; failed: number; pending: number };
  generatedAt: string;
}

const POLL_MS = 5_000;

/** Acessos dos últimos 30 minutos. Só consulta com a aba do painel visível. */
export function useLive() {
  const { activeWorkspaceId } = useWorkspaceContext();
  const query = useQuery<LiveSnapshot, Error>({
    queryKey: ['live', activeWorkspaceId],
    enabled: !!activeWorkspaceId,
    retry: false,
    refetchInterval: () => (document.visibilityState === 'visible' ? POLL_MS : false),
    refetchIntervalInBackground: false,
    queryFn: () => api.get<LiveSnapshot>(`/live?workspace_id=${activeWorkspaceId}`),
  });
  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error?.message ?? null,
  };
}
