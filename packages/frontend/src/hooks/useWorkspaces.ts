import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { CACHE_PREFIX, readCachedWorkspaces } from '@/lib/workspaceCache';

export interface Workspace {
  id: string;
  user_id: string;
  name: string;
  /** Fuso IANA do painel (padrão America/Sao_Paulo). Ausente em respostas antigas. */
  timezone?: string;
  /** Emoji mostrado antes do nome (seletor e menu recolhido). */
  emoji?: string | null;
  created_at: string;
  updated_at: string;
}

export function useWorkspaces() {
  const { user, mfaRequired } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const effectiveUserId = user?.id;

  const { data: workspaces = [], isLoading, isPending } = useQuery<Workspace[]>({
    queryKey: ['workspaces', effectiveUserId],
    queryFn: async () => {
      const list = await api.get<Workspace[]>('/workspaces');
      try {
        if (effectiveUserId) localStorage.setItem(CACHE_PREFIX + effectiveUserId, JSON.stringify(list ?? []));
      } catch { /* armazenamento cheio ou bloqueado: segue sem cache */ }
      return list;
    },
    // Enquanto a lista chega, usa a última vista: o painel abre direto, sem o aviso de "Nenhum painel".
    placeholderData: () => readCachedWorkspaces(effectiveUserId),
    // Sessão aal1 de quem tem 2FA: o backend recusaria até o código ser confirmado.
    enabled: !!effectiveUserId && !mfaRequired,
    staleTime: 5 * 60 * 1000,
  });

  const createWorkspace = useCallback(async (name: string, emoji?: string | null) => {
    try {
      const data = await api.post<Workspace>('/workspaces', { name, ...(emoji && { emoji }) });
      if (data) {
        queryClient.setQueryData<Workspace[]>(['workspaces', effectiveUserId], (current = []) => [
          ...current.filter(({ id }) => id !== data.id),
          data,
        ]);
      }
      queryClient.invalidateQueries({ queryKey: ['workspaces', effectiveUserId] });
      toast({ title: 'Painel criado' });
      return data || null;
    } catch (err: any) {
      toast({ title: 'Erro ao criar painel', description: err.message, variant: 'destructive' });
      return null;
    }
  }, [effectiveUserId, queryClient, toast]);

  // Renomear e excluir valem para qualquer painel da lista, não só o ativo.
  // A lista em cache é ajustada na hora para a tela não esperar o refetch.
  const updateWorkspace = useCallback(async (workspaceId: string, name: string) => {
    try {
      await api.patch(`/workspaces/${workspaceId}`, { name });
      queryClient.setQueryData<Workspace[]>(['workspaces', effectiveUserId], (current) =>
        current?.map((ws) => (ws.id === workspaceId ? { ...ws, name } : ws)),
      );
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      return true;
    } catch {
      toast({ title: 'Erro ao renomear painel', variant: 'destructive' });
      return false;
    }
  }, [effectiveUserId, queryClient, toast]);

  const updateWorkspaceTimezone = useCallback(async (workspaceId: string, timezone: string) => {
    try {
      await api.patch(`/workspaces/${workspaceId}`, { timezone });
      queryClient.setQueryData<Workspace[]>(['workspaces', effectiveUserId], (current) =>
        current?.map((ws) => (ws.id === workspaceId ? { ...ws, timezone } : ws)),
      );
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      return true;
    } catch (err: any) {
      toast({ title: 'Não foi possível salvar o fuso', description: err?.message, variant: 'destructive' });
      return false;
    }
  }, [effectiveUserId, queryClient, toast]);

  const updateWorkspaceEmoji = useCallback(async (workspaceId: string, emoji: string | null) => {
    try {
      await api.patch(`/workspaces/${workspaceId}`, { emoji: emoji ?? '' });
      queryClient.setQueryData<Workspace[]>(['workspaces', effectiveUserId], (current) =>
        current?.map((ws) => (ws.id === workspaceId ? { ...ws, emoji } : ws)),
      );
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      return true;
    } catch (err: any) {
      toast({ title: 'Não foi possível salvar o emoji', description: err?.message, variant: 'destructive' });
      return false;
    }
  }, [effectiveUserId, queryClient, toast]);

  const deleteWorkspace = useCallback(async (workspaceId: string) => {
    try {
      await api.delete(`/workspaces/${workspaceId}`);
      queryClient.setQueryData<Workspace[]>(['workspaces', effectiveUserId], (current) =>
        current?.filter(({ id }) => id !== workspaceId),
      );
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      toast({ title: 'Painel excluído' });
      return true;
    } catch {
      toast({ title: 'Erro ao excluir painel', variant: 'destructive' });
      return false;
    }
  }, [effectiveUserId, queryClient, toast]);

  return {
    workspaces,
    isLoading,
    /** Lista ainda não chegou (nem do cache): não dá para dizer que não há painel. */
    isPending,
    createWorkspace,
    updateWorkspace,
    updateWorkspaceTimezone,
    updateWorkspaceEmoji,
    deleteWorkspace,
  };
}
