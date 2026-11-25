import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { accountStatusLabel, actionErrorMessage, campaignsApi } from '@/lib/campaigns';
import { useMask } from '@/contexts/StreamingModeContext';

/**
 * Lista as contas que o System User enxerga (/me/adaccounts) e marca quais entram
 * neste painel. Uma conta pertence a um único painel: a que já está em outro aparece
 * desabilitada, para não somar o mesmo gasto em dois lugares.
 */
export function AccountsDialog({ dashboardId, open, onOpenChange }: {
  dashboardId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { mask, scrub } = useMask();
  const query = useQuery({
    queryKey: ['campaign-accounts', dashboardId],
    queryFn: () => campaignsApi.availableAccounts(dashboardId),
    enabled: open,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [token, setToken] = useState('');

  useEffect(() => {
    if (query.data) setSelected(new Set(query.data.accounts.filter((a) => a.linked).map((a) => a.id)));
  }, [query.data]);

  // Sem token salvo, o usuário cola um e a Meta lista as contas dele antes de gravar.
  const lookup = useMutation({
    mutationFn: () => campaignsApi.accountsForToken(dashboardId, token.trim()),
    onError: (error: Error) => toast({ title: 'Token recusado pela Meta', description: error.message, variant: 'destructive' }),
  });
  const listing = lookup.data ?? query.data;

  const save = useMutation({
    mutationFn: () => campaignsApi.saveAccounts(dashboardId, [...selected], token.trim() || undefined),
    onSuccess: ({ results }) => {
      queryClient.invalidateQueries({ queryKey: ['campaign-accounts', dashboardId] });
      queryClient.invalidateQueries({ queryKey: ['campaigns', dashboardId] });
      queryClient.invalidateQueries({ queryKey: ['cost-settings', dashboardId] });
      queryClient.invalidateQueries({ queryKey: ['summary', dashboardId] });
      queryClient.invalidateQueries({ queryKey: ['test-matrix', dashboardId] });
      queryClient.invalidateQueries({ queryKey: ['test-changes', dashboardId] });
      setToken('');
      lookup.reset();
      const failed = results.filter((r) => !r.ok);
      if (failed.length) {
        toast({
          title: `${failed.length} conta(s) não foram vinculadas`,
          description: failed.map((r) => `${mask('id', r.accountId)}: ${actionErrorMessage(r.code, r.message)}`).join(' · '),
          variant: 'destructive',
        });
        return;
      }
      toast({ title: 'Contas do painel atualizadas' });
      onOpenChange(false);
    },
    onError: (error: Error) => toast({ title: 'Não foi possível salvar as contas', description: error.message, variant: 'destructive' }),
  });

  const toggle = (accountId: string, on: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(accountId); else next.delete(accountId);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!save.isPending) onOpenChange(value); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Contas de anúncio do painel</DialogTitle>
          <DialogDescription>
            Contas que o System User da Meta enxerga. As marcadas entram em Campanhas e no Resultado deste painel.
          </DialogDescription>
        </DialogHeader>

        {query.isLoading && <p className="text-sm text-muted-foreground">Buscando contas na Meta...</p>}
        {query.error && <p className="text-sm text-destructive">{scrub((query.error as Error).message)}</p>}
        {listing?.warnings.map((warning) => <p key={warning} className="text-sm text-muted-foreground">{scrub(warning)}</p>)}
        {query.data?.needsToken && (
          <div className="space-y-2">
            <Label htmlFor="system-user-token">Token do System User da Meta</Label>
            <div className="flex gap-2">
              <Input
                id="system-user-token"
                type="password"
                autoComplete="off"
                value={token}
                onChange={(event) => { setToken(event.target.value); lookup.reset(); }}
                placeholder="Cole o token com ads_read e ads_management"
              />
              <Button type="button" variant="outline" onClick={() => lookup.mutate()} disabled={token.trim().length < 20 || lookup.isPending}>
                {lookup.isPending ? 'Buscando...' : 'Buscar contas'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">O token só é guardado, criptografado, ao salvar as contas marcadas.</p>
          </div>
        )}
        {listing && (!listing.needsToken || lookup.data) && listing.accounts.length === 0 && (
          <p className="text-sm text-muted-foreground">
            O token não enxerga nenhuma conta. Na BM, atribua as contas ao System User ou adicione a BM dele como parceira.
          </p>
        )}

        {listing && listing.accounts.length > 0 && (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {listing.accounts.map((account) => {
              const elsewhere = !!account.linkedDashboardId && !account.linked;
              const id = `account-${account.id}`;
              return (
                <li key={account.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-foreground/5">
                  <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                    <span className="block truncate text-sm font-medium">{mask('account', account.name)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {mask('id', account.id.replace(/^act_/, ''))} · {account.currency} · {accountStatusLabel(account.accountStatus)}
                      {elsewhere && ' · em outro painel'}
                    </span>
                  </label>
                  <Switch
                    id={id}
                    checked={selected.has(account.id)}
                    disabled={elsewhere || save.isPending}
                    onCheckedChange={(on) => toggle(account.id, on)}
                  />
                </li>
              );
            })}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={!listing || save.isPending || (!!query.data?.needsToken && !lookup.data)}>
            {save.isPending ? 'Salvando...' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
