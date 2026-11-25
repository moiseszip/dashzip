import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Box, Check, Settings2 } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { useMask } from '@/contexts/StreamingModeContext';
import { cn } from '@/lib/utils';

const MANAGE_PATH = '/settings?tab=dashboards';

/**
 * Atalho "Painéis" da barra inferior: mostra o emoji do painel ativo e abre,
 * de baixo para cima, a lista de painéis para trocar com um toque.
 */
export function PanelSheet({ itemClass }: { itemClass: string }) {
  const [open, setOpen] = useState(false);
  const { activeWorkspace, workspaces, setActiveWorkspace } = useWorkspaceContext();
  const { mask } = useMask();

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={activeWorkspace ? `Painéis: ${mask('workspace', activeWorkspace.name)}` : 'Painéis'}
          className={cn(itemClass, open ? 'text-foreground' : 'text-muted-foreground')}
        >
          <span className={cn('flex h-7 w-12 items-center justify-center rounded-full transition-[background-color,transform] duration-150 group-active:scale-90 motion-reduce:group-active:scale-100', open && 'bg-foreground/10')}>
            {activeWorkspace?.emoji
              ? <span className="text-lg leading-none" aria-hidden="true">{activeWorkspace.emoji}</span>
              : <Box className="h-[18px] w-[18px]" strokeWidth={1.6} aria-hidden="true" />}
          </span>
          Painéis
        </button>
      </DialogPrimitive.Trigger>
      <DialogContent aria-describedby={undefined} className="gap-3">
        <DialogTitle className="pr-10 text-base font-semibold">Painéis</DialogTitle>
        {workspaces.length > 0 ? (
          <ul className="-mx-1 flex flex-col gap-1" role="listbox" aria-label="Trocar de painel">
            {workspaces.map((ws) => {
              const selected = ws.id === activeWorkspace?.id;
              return (
                <li key={ws.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => { setActiveWorkspace(ws.id); setOpen(false); }}
                    className={cn(
                      'flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors hover:bg-foreground/5',
                      selected && 'bg-foreground/10 font-medium',
                    )}
                  >
                    <span className="flex w-6 shrink-0 justify-center text-lg leading-none" aria-hidden="true">
                      {ws.emoji || <Box className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{mask('workspace', ws.name)}</span>
                    {selected && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum painel ainda.</p>
        )}
        <Link
          to={MANAGE_PATH}
          onClick={() => setOpen(false)}
          className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <Settings2 className="h-4 w-4" aria-hidden="true" />
          {workspaces.length > 0 ? 'Gerenciar painéis' : 'Criar painel em Configurações'}
        </Link>
      </DialogContent>
    </DialogPrimitive.Root>
  );
}
