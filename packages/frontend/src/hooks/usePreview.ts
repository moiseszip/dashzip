import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { api } from '@/lib/api';

export interface PreviewStatus {
  active: boolean;
  until: string | null;
  /** Vai na URL do site (?stl_debug=) para o navegador entrar em modo debug. */
  token: string | null;
}

export type TraceStatus = 'ok' | 'warning' | 'error';
export type TagStatus = 'fired' | 'failed' | 'not_fired';

export interface DebugTag {
  name: string;
  status: TagStatus;
  detail?: string | null;
  httpIndex?: number;
}

/** Uma mensagem do navegador em preview (source = web). */
export interface WebTraceData {
  url: string;
  t: number;
  vid?: string;
  sid?: string;
  vars?: Record<string, unknown>;
  tags?: DebugTag[];
  event?: Record<string, unknown>;
  level?: 'warning' | 'error';
  aviso?: string;
}

export interface DebugHttpCall {
  method: string;
  url: string;
  requestBody: unknown;
  status: number | null;
  responseBody: unknown;
  durationMs: number;
  error?: string | null;
}

/** Uma gravação no banco: tabela, o que foi escrito e o que o banco devolveu. */
export interface DebugDbWrite {
  table: string;
  operation: 'insert' | 'upsert' | 'update' | 'rpc';
  data: unknown;
  result: unknown;
  error?: string | null;
  durationMs: number;
}

export interface DebugLogLine {
  level: 'log' | 'warn' | 'error' | 'debug';
  message: string;
  context?: string | null;
  at: number;
}

/** Uma requisição atendida pelo servidor (source = server). */
export interface ServerTraceData {
  client: string;
  request: { method: string; path: string; query: Record<string, unknown>; headers: Record<string, unknown>; body: unknown };
  response: { status: number; body: unknown } | null;
  events: string[];
  variables: Record<string, unknown>;
  tags: DebugTag[];
  http: DebugHttpCall[];
  /** Rastros gravados antes desta versão não têm. */
  db?: DebugDbWrite[];
  logs: DebugLogLine[];
  durationMs: number;
}

interface TraceBase {
  id: string;
  kind: string;
  title: string;
  status: TraceStatus;
  browser_token: string | null;
  page_id: string | null;
  created_at: string;
}

export type WebTrace = TraceBase & { source: 'web'; data: WebTraceData };
export type ServerTrace = TraceBase & { source: 'server'; data: ServerTraceData };
export type Trace = WebTrace | ServerTrace;

const POLL_MS = 2_000;
/** Renova o preview quando faltar menos que isso: com o painel aberto, ele não expira. */
const RENEW_BEFORE_MS = 30 * 60_000;
const MAX_TRACES = 1_000;

export function usePreview() {
  const { activeWorkspaceId } = useWorkspaceContext();
  const queryClient = useQueryClient();
  const statusKey = ['preview-status', activeWorkspaceId];

  const statusQuery = useQuery<PreviewStatus, Error>({
    queryKey: statusKey,
    enabled: !!activeWorkspaceId,
    retry: false,
    refetchInterval: 60_000,
    queryFn: () => api.get<PreviewStatus>(`/debug/status?workspace_id=${activeWorkspaceId}`),
  });
  const status = statusQuery.data ?? null;

  const start = useMutation<PreviewStatus, Error>({
    mutationFn: () => api.post<PreviewStatus>('/debug/start', { workspace_id: activeWorkspaceId }),
    onSuccess: (data) => queryClient.setQueryData(statusKey, data),
  });
  const stop = useMutation<PreviewStatus, Error>({
    mutationFn: () => api.post<PreviewStatus>('/debug/stop', { workspace_id: activeWorkspaceId }),
    onSuccess: (data) => queryClient.setQueryData(statusKey, data),
  });

  // Com o painel aberto, o preview não expira no meio do teste.
  const renew = start.mutate;
  useEffect(() => {
    if (!status?.active || !status.until || start.isPending) return;
    if (new Date(status.until).getTime() - Date.now() < RENEW_BEFORE_MS) renew();
  }, [status?.active, status?.until, start.isPending, renew]);

  // Mensagens: a primeira busca traz as recentes; as seguintes, só as novas.
  const [traces, setTraces] = useState<Trace[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const cursor = useRef<string | null>(null);
  const busy = useRef(false);
  // A área pode mudar enquanto uma busca está no ar: a resposta velha é descartada.
  const workspaceRef = useRef(activeWorkspaceId);
  workspaceRef.current = activeWorkspaceId;

  const fetchTraces = useCallback(async () => {
    if (!activeWorkspaceId || busy.current) return;
    busy.current = true;
    const workspace = activeWorkspaceId;
    try {
      const after = cursor.current ? `&after=${encodeURIComponent(cursor.current)}` : '';
      const rows = await api.get<Trace[]>(`/debug/traces?workspace_id=${workspace}${after}`);
      if (workspace !== workspaceRef.current) return;
      if (rows.length) {
        cursor.current = rows[rows.length - 1].created_at;
        setTraces((prev) => {
          const seen = new Set(prev.map((t) => t.id));
          const next = [...prev, ...rows.filter((r) => !seen.has(r.id))];
          return next.length > MAX_TRACES ? next.slice(-MAX_TRACES) : next;
        });
      }
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Falha ao buscar as mensagens');
    } finally {
      setLoaded(true);
      busy.current = false;
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    cursor.current = null;
    // Uma busca da área anterior ainda no ar não segura a desta.
    busy.current = false;
    setTraces([]);
    setLoaded(false);
    fetchTraces();
  }, [fetchTraces]);

  // Só consulta a cada 2s com o preview ligado e a aba do painel visível.
  useEffect(() => {
    if (!status?.active) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchTraces();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [status?.active, fetchTraces]);

  const clear = useMutation<unknown, Error>({
    mutationFn: () => api.delete(`/debug/traces?workspace_id=${activeWorkspaceId}`),
    onSuccess: () => {
      setTraces([]);
      // O cursor fica: mensagens antigas não voltam na próxima busca.
    },
  });

  return {
    status,
    statusError: statusQuery.error?.message ?? null,
    statusLoading: statusQuery.isLoading,
    start: start.mutateAsync,
    starting: start.isPending,
    stop: stop.mutateAsync,
    stopping: stop.isPending,
    traces,
    loaded,
    loadError,
    clear: clear.mutateAsync,
    clearing: clear.isPending,
    refresh: fetchTraces,
  };
}
