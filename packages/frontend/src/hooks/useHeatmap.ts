import { useQuery } from '@tanstack/react-query';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { api } from '@/lib/api';

/**
 * Token do link que abre a página real com o mapa de calor por cima (aba
 * Hotjar). Vale 12 horas; renova sozinho.
 */
export function useHeatmapToken() {
  const { activeWorkspaceId } = useWorkspaceContext();
  const query = useQuery<{ token: string; until: string }, Error>({
    queryKey: ['heatmap-token', activeWorkspaceId],
    enabled: !!activeWorkspaceId,
    retry: false,
    staleTime: 30 * 60_000,
    refetchInterval: 60 * 60_000,
    queryFn: () => api.post('/heatmap/token', { workspace_id: activeWorkspaceId }),
  });
  return { token: query.data?.token ?? null, error: query.error?.message ?? null };
}
