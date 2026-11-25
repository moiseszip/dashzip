import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { useWorkspaces, type Workspace } from '@/hooks/useWorkspaces';
import { useAuth } from '@/contexts/AuthContext';
import { setPrefetchWorkspace } from '@/lib/pageQueries';
import { cachedTimezone, DEFAULT_TIMEZONE, normalizeTimezone, setActiveTimezone } from '@/lib/timezone';

interface WorkspaceContextType {
  activeWorkspaceId: string | null;
  activeWorkspace: Workspace | null;
  workspaces: Workspace[];
  setActiveWorkspace: (id: string) => void;
  /** Fuso IANA do painel ativo: define "hoje" nos seletores de data. */
  timezone: string;
  /** A lista de painéis ainda está carregando. */
  loading: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextType>({
  activeWorkspaceId: null,
  activeWorkspace: null,
  workspaces: [],
  setActiveWorkspace: () => {},
  timezone: DEFAULT_TIMEZONE,
  loading: true,
});

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { workspaces, isPending } = useWorkspaces();
  const userId = user?.id;
  const storageKey = userId ? `dashzip_active_workspace:${userId}` : null;
  const [selection, setSelection] = useState<{ key: string; id: string } | null>(null);
  const selectedId = storageKey
    ? selection?.key === storageKey
      ? selection.id
      : localStorage.getItem(storageKey)
    : null;
  const activeWorkspace = workspaces.find(({ id }) => id === selectedId) ?? workspaces[0] ?? null;
  // Antes da lista chegar, usa o último fuso visto deste painel (localStorage):
  // as telas calculam o "hoje" do seletor de datas já no primeiro render.
  const timezone = activeWorkspace
    ? normalizeTimezone(activeWorkspace.timezone)
    : cachedTimezone(selectedId) ?? DEFAULT_TIMEZONE;
  // Módulo, e não só contexto: as funções puras de data (resultPresetRange) leem daqui.
  setActiveTimezone(timezone, activeWorkspace?.id);
  setPrefetchWorkspace(activeWorkspace?.id ?? null);

  const setActiveWorkspace = useCallback((id: string) => {
    if (!storageKey) return;
    setSelection({ key: storageKey, id });
    localStorage.setItem(storageKey, id);
  }, [storageKey]);

  return (
    <WorkspaceContext.Provider
      value={{
        activeWorkspaceId: activeWorkspace?.id ?? null,
        activeWorkspace,
        workspaces,
        setActiveWorkspace,
        timezone,
        loading: isPending,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspaceContext() {
  return useContext(WorkspaceContext);
}
