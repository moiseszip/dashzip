import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CircleAlert, CircleCheck, CircleDashed, Loader2, PlugZap } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { useWiapy } from '@/hooks/useWiapy';
import { errorMessage } from '@/lib/utils';
import { Masked } from '@/components/Masked';

/**
 * Wiapy pelo MCP: com a conta conectada, Resultado, Vendas e Campanhas buscam
 * as vendas do período na Wiapy na hora (nada é gravado). O webhook continua
 * gravando as vendas novas, porque é ele que liga venda e visita e dispara o
 * Purchase da API de Conversões.
 */
export function WiapyCard() {
  const { status, loading, connect, complete, disconnect } = useWiapy();
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [params, setParams] = useSearchParams();

  // Volta do consentimento: /integrations?wiapy=connected | error&message=...
  useEffect(() => {
    const result = params.get('wiapy');
    if (!result) return;
    if (result === 'connected') toast({ title: 'Wiapy conectada', description: 'As vendas do período agora vêm direto da Wiapy.' });
    else toast({ title: 'Não foi possível conectar a Wiapy', description: params.get('message') ?? undefined, variant: 'destructive' });
    const next = new URLSearchParams(params);
    next.delete('wiapy');
    next.delete('message');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const conectar = () =>
    connect.mutate(undefined, {
      onSuccess: () => { setPasted(''); setPasting(true); },
      onError: (e) => toast({ title: 'Não foi possível abrir a Wiapy', description: errorMessage(e), variant: 'destructive' }),
    });
  const concluir = () =>
    complete.mutate(pasted, {
      onSuccess: () => {
        setPasting(false);
        setPasted('');
        toast({ title: 'Wiapy conectada', description: 'As vendas de qualquer período agora vêm direto da Wiapy.' });
      },
      onError: (e) => toast({ title: 'Não foi possível concluir', description: errorMessage(e), variant: 'destructive' }),
    });
  const desconectar = () =>
    disconnect.mutate(undefined, {
      onSuccess: () => toast({ title: 'Wiapy desconectada' }),
      onError: (e) => toast({ title: 'Não foi possível desconectar', description: errorMessage(e), variant: 'destructive' }),
    });

  const connected = !!status?.connected;
  const reconnect = !!status?.needsReconnect;

  return (
    <Card data-testid="wiapy-card">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <PlugZap className="h-4 w-4 text-accent-readable" strokeWidth={1.5} />
            <CardTitle>Checkout</CardTitle>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs">
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Carregando" />
            ) : connected ? (
              <>
                <CircleCheck className="h-3.5 w-3.5 text-green-500" aria-hidden />
                <span className="text-foreground">Conectada</span>
              </>
            ) : reconnect ? (
              <>
                <CircleAlert className="h-3.5 w-3.5 text-warning" aria-hidden />
                <span className="text-foreground">Reconectar</span>
              </>
            ) : (
              <>
                <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                <span className="text-muted-foreground">Desconectada</span>
              </>
            )}
          </span>
        </div>
        <CardDescription>
          Dados passados: conecte a Wiapy para puxar as vendas retroativas de qualquer período, na hora, em Resultado,
          Vendas e Campanhas. Nada é gravado; o rastreio das vendas novas continua no card acima.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {connected ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="min-w-0 text-sm text-muted-foreground">
              {status?.accountName ? (
                <>
                  Conta <span className="font-medium text-foreground"><Masked kind="customer" value={status.accountName} /></span>
                </>
              ) : (
                'Conta conectada'
              )}
              {status?.connectedAt && <> · desde {new Date(status.connectedAt).toLocaleDateString('pt-BR')}</>}
            </p>
            <Button variant="outline" className="w-full sm:w-auto" onClick={desconectar} disabled={disconnect.isPending}>
              {disconnect.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Desconectar
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {reconnect
                ? 'A Wiapy não renovou o acesso. Conecte de novo para voltar a ver o faturamento completo.'
                : 'Sem conexão, as telas mostram só as vendas recebidas por webhook.'}
            </p>
            <Button className="w-full sm:w-auto" onClick={conectar} disabled={loading || connect.isPending}>
              {connect.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {pasting ? 'Abrir a Wiapy de novo' : 'Conectar Wiapy'}
            </Button>
          </div>
        )}
        {pasting && !connected && (
          <form
            className="space-y-2 rounded-lg border border-border p-3"
            onSubmit={(event) => { event.preventDefault(); if (pasted.trim()) concluir(); }}
          >
            <p className="text-sm text-foreground">Depois de autorizar na Wiapy:</p>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>A aba vai parar numa página que não abre (endereço começando com <code className="text-xs">http://localhost/dashzip-wiapy</code>). É esperado.</li>
              <li>Copie o endereço inteiro dessa aba e cole aqui.</li>
            </ol>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={pasted}
                onChange={(event) => setPasted(event.target.value)}
                placeholder="http://localhost/dashzip-wiapy?code=…"
                aria-label="Endereço da página depois de autorizar"
                autoComplete="off"
                className="h-11 sm:h-10"
              />
              <Button type="submit" className="h-11 sm:h-10" disabled={!pasted.trim() || complete.isPending}>
                {complete.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Concluir
              </Button>
            </div>
          </form>
        )}
        <p className="text-xs text-muted-foreground/70">
          O botão abre a tela de autorização da Wiapy. O dash.zip só lê as vendas; o acesso fica guardado cifrado e pode ser
          revogado aqui a qualquer momento.
        </p>
      </CardContent>
    </Card>
  );
}
