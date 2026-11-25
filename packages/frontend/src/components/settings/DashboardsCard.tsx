import { useEffect, useRef, useState } from 'react';
import { EmojiPicker } from '@/components/settings/EmojiPicker';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { useMask } from '@/contexts/StreamingModeContext';
import { MaskedInput } from '@/components/Masked';
import { useWorkspaces, type Workspace } from '@/hooks/useWorkspaces';
import { Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';

/**
 * Gestão dos painéis (os "containers" do GTM): criar, renomear, excluir e
 * escolher o ativo. A barra lateral só seleciona; o resto mora aqui.
 */
export function DashboardsCard() {
  const { activeWorkspaceId, workspaces, setActiveWorkspace } = useWorkspaceContext();
  const { isLoading, createWorkspace, updateWorkspace, updateWorkspaceEmoji, deleteWorkspace } = useWorkspaces();
  const { mask } = useMask();

  const [createOpen, setCreateOpen] = useState(false);
  const [newEmoji, setNewEmoji] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [renaming, setRenaming] = useState(false);

  // O alvo fica guardado depois de fechar para o título não piscar vazio na animação.
  const [toDelete, setToDelete] = useState<Workspace | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Refs para devolver o foco a quem usa teclado depois de renomear ou fechar a exclusão.
  const newNameRef = useRef<HTMLInputElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const pencilRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const trashRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const renameFocusId = useRef<string | null>(null);
  const deletedRef = useRef(false);
  const afterDeleteFocusId = useRef<string | null>(null);

  // Ao sair da edição (Enter, Esc ou Cancelar), o foco volta para o lápis da mesma linha.
  useEffect(() => {
    if (editingId !== null || !renameFocusId.current) return;
    pencilRefs.current[renameFocusId.current]?.focus();
    renameFocusId.current = null;
  }, [editingId]);

  const criar = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    const ws = await createWorkspace(name, newEmoji);
    setCreating(false);
    if (ws) {
      setActiveWorkspace(ws.id);
      setCreateOpen(false);
    }
  };

  const startRename = (ws: Workspace) => {
    renameFocusId.current = ws.id;
    setEditingId(ws.id);
    setEditName(ws.name);
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditName('');
  };

  const renomear = async () => {
    const id = editingId;
    const name = editName.trim();
    if (!id || !name) return;
    const current = workspaces.find((ws) => ws.id === id);
    if (current?.name === name) {
      cancelRename();
      return;
    }
    setRenaming(true);
    const ok = await updateWorkspace(id, name);
    setRenaming(false);
    // Fecha só o editor da linha salva, se ele ainda estiver aberto.
    if (ok) setEditingId((cur) => (cur === id ? null : cur));
  };

  const excluir = async () => {
    if (!toDelete) return;
    const { id } = toDelete;
    const wasActive = id === activeWorkspaceId;
    const next = workspaces.find((ws) => ws.id !== id);
    const index = workspaces.findIndex((ws) => ws.id === id);
    const neighbor = workspaces[index + 1] ?? workspaces[index - 1];
    setDeleting(true);
    const ok = await deleteWorkspace(id);
    setDeleting(false);
    if (!ok) return;
    deletedRef.current = true;
    afterDeleteFocusId.current = neighbor?.id ?? null;
    // Excluir o painel ativo passa a seleção para o primeiro que sobrou.
    if (wasActive && next) setActiveWorkspace(next.id);
    if (editingId === id) cancelRename();
    setDeleteOpen(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Painéis</CardTitle>
        <CardDescription>
          Cada painel tem o próprio snippet, pixel, webhooks e preview. O painel ativo é o que aparece nas telas; troque por aqui ou pela barra lateral.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Dialog
          open={createOpen}
          onOpenChange={(open) => {
            if (creating) return;
            if (open) {
              setNewName('');
              setNewEmoji(null);
            }
            setCreateOpen(open);
          }}
        >
          <DialogTrigger asChild>
            <Button ref={createButtonRef} type="button" className="gap-2">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Novo painel
            </Button>
          </DialogTrigger>
          <DialogContent
            className="sm:max-w-md"
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              newNameRef.current?.focus();
            }}
          >
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void criar();
              }}
            >
              <DialogHeader>
                <DialogTitle>Novo painel</DialogTitle>
              </DialogHeader>
              <div className="flex items-end gap-3">
                <div className="space-y-1">
                  <span className="block text-sm font-medium">Emoji</span>
                  <EmojiPicker value={newEmoji} onChange={setNewEmoji} disabled={creating} label="Escolher emoji do novo painel" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <Label htmlFor="new-dashboard-name">Nome</Label>
                  <Input
                    ref={newNameRef}
                    id="new-dashboard-name"
                    autoComplete="off"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    disabled={creating}
                  />
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" disabled={creating}>Cancelar</Button>
                </DialogClose>
                <Button type="submit" disabled={creating || !newName.trim()}>
                  {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                  Criar painel
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando...
          </div>
        ) : workspaces.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum painel ainda. Crie o primeiro acima.</p>
        ) : (
          <div className="divide-y divide-border/60">
            {workspaces.map((ws) => {
              const active = ws.id === activeWorkspaceId;
              const editing = ws.id === editingId;

              return (
                <div key={ws.id} className="flex items-center gap-2 py-3 first:pt-0 last:pb-0">
                  {editing ? (
                    <form
                      className="flex min-w-0 flex-1 items-center gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        renomear();
                      }}
                    >
                      <MaskedInput
                        kind="workspace"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape' && !renaming) cancelRename();
                        }}
                        placeholder="Novo nome"
                        aria-label={`Novo nome para ${mask('workspace', ws.name)}`}
                        className="h-9 min-w-0 flex-1"
                        autoFocus
                      />
                      <Button
                        type="submit"
                        size="icon"
                        variant="ghost"
                        className="h-9 w-9 shrink-0"
                        disabled={renaming || !editName.trim()}
                        aria-label="Salvar nome"
                        title="Salvar"
                      >
                        {renaming ? <Loader2 className="animate-spin" /> : <Check />}
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-9 w-9 shrink-0"
                        onClick={cancelRename}
                        disabled={renaming}
                        aria-label="Cancelar"
                        title="Cancelar"
                      >
                        <X />
                      </Button>
                    </form>
                  ) : (
                    <>
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <EmojiPicker value={ws.emoji} onChange={(emoji) => updateWorkspaceEmoji(ws.id, emoji)} label={`Emoji do painel ${mask('workspace', ws.name)}`} />
                        <span className="truncate text-sm font-medium text-foreground">{mask('workspace', ws.name)}</span>
                        {active && (
                          <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-accent-readable">
                            Ativo
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {!active && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-3 text-xs"
                            onClick={() => setActiveWorkspace(ws.id)}
                            aria-label={`Usar o painel ${mask('workspace', ws.name)}`}
                          >
                            Usar
                          </Button>
                        )}
                        <Button
                          ref={(el) => {
                            pencilRefs.current[ws.id] = el;
                          }}
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => startRename(ws)}
                          disabled={renaming}
                          aria-label={`Renomear ${mask('workspace', ws.name)}`}
                          title="Renomear"
                        >
                          <Pencil strokeWidth={1.5} />
                        </Button>
                        <Button
                          ref={(el) => {
                            trashRefs.current[ws.id] = el;
                          }}
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 hover:text-destructive"
                          onClick={() => {
                            deletedRef.current = false;
                            setToDelete(ws);
                            setDeleteOpen(true);
                          }}
                          aria-label={`Excluir ${mask('workspace', ws.name)}`}
                          title="Excluir"
                        >
                          <Trash2 strokeWidth={1.5} />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open && deleting) return;
          setDeleteOpen(open);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(e) => {
            // Sem AlertDialogTrigger o Radix não sabe para onde voltar o foco.
            e.preventDefault();
            if (!deletedRef.current) {
              if (toDelete) trashRefs.current[toDelete.id]?.focus();
            } else if (afterDeleteFocusId.current) {
              trashRefs.current[afterDeleteFocusId.current]?.focus();
            } else {
              createButtonRef.current?.focus();
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir o painel "{mask('workspace', toDelete?.name)}"?</AlertDialogTitle>
            <AlertDialogDescription>
              O snippet desta área para de rastrear, os webhooks deixam de ser aceitos e o pixel e o token da API de
              Conversões são apagados. Não dá para desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Mantém o diálogo aberto até a exclusão terminar.
                e.preventDefault();
                excluir();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Excluindo...' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
