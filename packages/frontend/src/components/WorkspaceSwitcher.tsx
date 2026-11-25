import { Link } from 'react-router-dom';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { useMask } from '@/contexts/StreamingModeContext';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Box } from 'lucide-react';

const MANAGE_PATH = '/settings?tab=dashboards';

/**
 * O "container": cada área tem o próprio snippet, pixel, webhooks e preview.
 * Fica na barra lateral, acima do menu, como o seletor de container do GTM.
 * Aqui só se escolhe o painel ativo; criar, renomear e excluir ficam em
 * Configurações > Painéis.
 */
export function WorkspaceSwitcher({ collapsed, onNavClick }: { collapsed?: boolean; onNavClick?: () => void }) {
  const { activeWorkspaceId, workspaces, setActiveWorkspace } = useWorkspaceContext();
  const { isLoading } = useWorkspaces();
  const { mask } = useMask();

  const active = workspaces.find((w) => w.id === activeWorkspaceId);
  const activeName = mask('workspace', active?.name || '');
  // Emoji e nome com respiro entre eles (gap), no seletor e na lista.
  const label = (ws: { name: string; emoji?: string | null }) => (
    <span className="inline-flex min-w-0 items-center gap-2">
      {ws.emoji && <span className="shrink-0 text-base leading-none" aria-hidden="true">{ws.emoji}</span>}
      <span className="truncate">{mask('workspace', ws.name)}</span>
    </span>
  );
  const empty = !isLoading && workspaces.length === 0;

  if (collapsed) {
    return (
      <div className="flex shrink-0 justify-center border-b border-foreground/5 px-3 py-3" title={activeName}>
        {workspaces.length > 0 ? (
          <Select value={activeWorkspaceId ?? ''} onValueChange={setActiveWorkspace}>
            <SelectTrigger aria-label="Selecionar painel" className="h-8 w-12 justify-center gap-0 px-1.5 [&>svg:last-child]:hidden">
              {active?.emoji
                ? <span className="text-lg leading-none" aria-hidden="true">{active.emoji}</span>
                : <Box className="h-4 w-4 text-accent-readable" />}
            </SelectTrigger>
            <SelectContent>
              {workspaces.map((ws) => (
                <SelectItem key={ws.id} value={ws.id}>{label(ws)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : empty ? (
          <Link
            to={MANAGE_PATH}
            onClick={onNavClick}
            title="Nenhum painel. Crie um em Configurações."
            aria-label="Criar painel em Configurações"
            className="flex h-8 w-12 items-center justify-center rounded-md text-muted-foreground/80 transition-colors duration-200 hover:text-foreground hover:bg-foreground/5"
          >
            <Box className="h-4 w-4" strokeWidth={1.5} />
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <div className="shrink-0 border-b border-foreground/5 px-3 py-3">
      <p className="mb-1.5 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Painel</p>

      {workspaces.length > 0 ? (
        <Select value={activeWorkspaceId || ''} onValueChange={setActiveWorkspace}>
          <SelectTrigger aria-label="Selecionar painel" className="h-8 w-full min-w-0 text-xs">
            <SelectValue placeholder="Selecionar" />
          </SelectTrigger>
          <SelectContent>
            {workspaces.map((ws) => (
              <SelectItem key={ws.id} value={ws.id} className="text-xs">
                {label(ws)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : empty ? (
        <p className="px-1 text-xs text-muted-foreground">
          Nenhum painel.{' '}
          <Link to={MANAGE_PATH} onClick={onNavClick} className="text-accent-readable underline-offset-4 hover:underline">
            Criar em Configurações
          </Link>
        </p>
      ) : (
        <div className="h-8" aria-hidden="true" />
      )}
    </div>
  );
}
