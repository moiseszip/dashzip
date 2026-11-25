import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AccountsDialog } from '@/components/campaigns/AccountsDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { accountStatusLabel, campaignsApi } from '@/lib/campaigns';
import { useMask } from '@/contexts/StreamingModeContext';

/**
 * Contas de anúncio do painel. Cada painel tem as suas (uma conta pertence a um painel só);
 * elas alimentam Resultado, Campanhas, Acompanhamento de testes e Regras.
 */
export function AdAccountsCard({ dashboardId }: { dashboardId: string }) {
  const [open, setOpen] = useState(false);
  const { mask, scrub } = useMask();
  const query = useQuery({
    queryKey: ['campaign-accounts', dashboardId],
    queryFn: () => campaignsApi.availableAccounts(dashboardId),
  });
  const linked = query.data?.accounts.filter((a) => a.linked) ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Contas de anúncio</CardTitle>
          <CardDescription>
            Vincule as contas Meta que alimentam os relatórios e as regras deste painel.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Gerenciar contas</Button>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-muted-foreground">Google Ads, TikTok Ads e Pinterest Ads (em breve)</p>
        {query.isPending && <p role="status" className="text-sm text-muted-foreground">Buscando contas…</p>}
        {query.isError && <p role="alert" className="text-sm text-destructive">{scrub(query.error.message)}</p>}
        {query.data && linked.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {query.data.needsToken ? 'Nenhum token da Meta salvo ainda. Em Gerenciar contas, cole o token do System User.' : 'Nenhuma conta vinculada a este painel.'}
          </p>
        )}
        {linked.length > 0 && (
          <ul className="divide-y divide-border">
            {linked.map((account) => (
              <li key={account.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{mask('account', account.name)}</p>
                  <p className="text-xs text-muted-foreground">{mask('id', account.id.replace(/^act_/, ''))} · {account.currency}{account.timezone ? ` · ${account.timezone}` : ''}</p>
                </div>
                <span className="text-xs text-muted-foreground">{accountStatusLabel(account.accountStatus)}</span>
              </li>
            ))}
          </ul>
        )}
        {query.data?.warnings.map((w) => <p key={w} className="mt-2 text-xs text-muted-foreground">{scrub(w)}</p>)}
      </CardContent>
      <AccountsDialog dashboardId={dashboardId} open={open} onOpenChange={setOpen} />
    </Card>
  );
}
