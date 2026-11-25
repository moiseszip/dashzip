import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { api } from '@/lib/api';

/** Conexão OAuth da Wiapy do painel. O token nunca chega ao navegador. */
export interface WiapyStatus {
  connected: boolean;
  /** A Wiapy recusou a renovação do acesso: conectar de novo. */
  needsReconnect: boolean;
  accountName: string | null;
  connectedAt: string | null;
}

export function useWiapy() {
  const { activeWorkspaceId } = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = ['wiapy', activeWorkspaceId];

  const status = useQuery<WiapyStatus, Error>({
    queryKey: key,
    enabled: !!activeWorkspaceId,
    retry: false,
    queryFn: () => api.get(`/integrations/wiapy?workspace_id=${activeWorkspaceId}`),
  });

  /**
   * Abre a autorização da Wiapy numa aba nova. A Wiapy só devolve para
   * http://localhost/dashzip-wiapy (recusa o domínio do dash.zip), então a aba
   * termina numa página que não carrega e o endereço dela é colado no card.
   * A aba é aberta antes da chamada para o Safari do iPhone não bloquear.
   */
  const connect = useMutation({
    mutationFn: async () => {
      const tab = window.open('about:blank', '_blank');
      try {
        const { url } = await api.post<{ url: string }>('/integrations/wiapy/connect', { workspace_id: activeWorkspaceId });
        if (tab) tab.location.href = url;
        else window.location.assign(url);
      } catch (error) {
        tab?.close();
        throw error;
      }
    },
  });

  /** Conclui com o endereço colado (http://localhost/dashzip-wiapy?code=...&state=...). */
  const complete = useMutation({
    mutationFn: (url: string) => api.post('/integrations/wiapy/complete', { workspace_id: activeWorkspaceId, url }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      for (const k of ['summary', 'sales', 'campaigns']) queryClient.invalidateQueries({ queryKey: [k] });
    },
  });

  const disconnect = useMutation({
    mutationFn: () => api.delete(`/integrations/wiapy?workspace_id=${activeWorkspaceId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      // Resultado, Vendas e Campanhas voltam a mostrar só o webhook.
      for (const k of ['summary', 'sales', 'campaigns']) queryClient.invalidateQueries({ queryKey: [k] });
    },
  });

  return { status: status.data ?? null, loading: status.isLoading, error: status.error?.message ?? null, connect, complete, disconnect };
}
