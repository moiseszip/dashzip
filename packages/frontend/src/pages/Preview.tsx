import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNowStrict } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Eraser, ExternalLink, Globe, Loader2, Play, Server, Square } from 'lucide-react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Masked, MaskedInput } from '@/components/Masked';
import { NoWorkspace } from '@/components/NoWorkspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WebDebug } from '@/components/preview/WebDebug';
import { ServerDebug } from '@/components/preview/ServerDebug';
import { StatusDot } from '@/components/preview/parts';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { usePreview, type ServerTrace, type WebTrace } from '@/hooks/usePreview';
import { useCapiSettings } from '@/hooks/useCapi';
import { toast } from '@/hooks/use-toast';
import { openExternalWindow } from '@/lib/openExternalWindow';
import { errorMessage } from '@/lib/utils';

const urlKey = (workspaceId: string) => `preview-url:${workspaceId}`;

function readSavedUrl(workspaceId: string | null): string {
  if (!workspaceId) return '';
  try {
    return localStorage.getItem(urlKey(workspaceId)) ?? '';
  } catch {
    return '';
  }
}

/** A URL do site com o token do preview: é o que põe o navegador em modo debug. */
function previewUrl(raw: string, token: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    url.searchParams.set('stl_debug', token);
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * O modo preview: um Tag Assistant e um preview do GTM Server numa tela só.
 * Web mostra o navegador aberto pelo preview; Servidor mostra cada /collect e
 * cada webhook que chegou, com as tags da API de Conversões.
 */
export default function Preview() {
  const { activeWorkspaceId, activeWorkspace } = useWorkspaceContext();
  const preview = usePreview();
  const { settings } = useCapiSettings();
  const [url, setUrl] = useState(() => readSavedUrl(activeWorkspaceId));
  const [tab, setTab] = useState<'web' | 'server'>('web');

  useEffect(() => setUrl(readSavedUrl(activeWorkspaceId)), [activeWorkspaceId]);

  const web = useMemo(() => preview.traces.filter((t): t is WebTrace => t.source === 'web'), [preview.traces]);
  const server = useMemo(() => preview.traces.filter((t): t is ServerTrace => t.source === 'server'), [preview.traces]);
  const webErrors = web.some((t) => t.status === 'error');
  const serverErrors = server.some((t) => t.status === 'error');

  const active = !!preview.status?.active;
  const capiReady = !!settings?.meta_pixel_id && !!settings?.has_capi_token;

  // A janela abre já no clique (senão o bloqueador de pop-up a barra) e
  // navega quando o preview estiver ligado.
  const abrirSite = async () => {
    if (!url.trim()) {
      toast({ title: 'Informe a URL da página de vendas', variant: 'destructive' });
      return;
    }
    const win = openExternalWindow();
    try {
      const status = active && preview.status?.token ? preview.status : await preview.start();
      const target = status.token ? previewUrl(url, status.token) : null;
      if (!target) {
        win.close();
        toast({ title: 'URL inválida', description: 'Use o endereço completo, como https://www.seusite.com.br/oferta', variant: 'destructive' });
        return;
      }
      try {
        localStorage.setItem(urlKey(activeWorkspaceId!), url.trim());
      } catch {
        /* sem armazenamento: só não lembra a URL */
      }
      win.navigate(target);
      setTab('web');
    } catch (e) {
      win.close();
      toast({ title: 'Não foi possível ligar o preview', description: errorMessage(e), variant: 'destructive' });
    }
  };

  const ligar = async () => {
    try {
      await preview.start();
    } catch (e) {
      toast({ title: 'Não foi possível ligar o preview', description: errorMessage(e), variant: 'destructive' });
    }
  };

  const desligar = async () => {
    try {
      await preview.stop();
    } catch (e) {
      toast({ title: 'Não foi possível encerrar', description: errorMessage(e), variant: 'destructive' });
    }
  };

  const limpar = async () => {
    try {
      await preview.clear();
    } catch (e) {
      toast({ title: 'Não foi possível limpar', description: errorMessage(e), variant: 'destructive' });
    }
  };

  return (
    <DashboardLayout wide>
      <div className="space-y-5 animate-dash-in">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Preview e debug</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Veja cada evento sair da página e chegar ao Meta, no navegador e no servidor
              {activeWorkspace && (
                <>
                  {' '}· painel <span className="font-medium text-foreground"><Masked kind="workspace" value={activeWorkspace.name} /></span>
                </>
              )}
            </p>
          </div>
          {activeWorkspace && (
            <span className="inline-flex items-center gap-2 rounded-full border border-foreground/10 px-3 py-1 text-xs">
              <StatusDot status={active ? 'ok' : 'warning'} className={active ? 'animate-pulse' : 'bg-muted-foreground'} />
              {preview.statusLoading
                ? 'Verificando…'
                : active && preview.status?.until
                  ? `Preview ligado · encerra em ${formatDistanceToNowStrict(new Date(preview.status.until), { locale: ptBR })}`
                  : 'Preview desligado'}
            </span>
          )}
        </div>

        {!activeWorkspace ? (
          <NoWorkspace />
        ) : (
          <>
            <div className="space-y-3 rounded-lg border border-foreground/10 p-4">
              <div className="flex flex-col gap-2 sm:flex-row">
                <MaskedInput
                  kind="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && abrirSite()}
                  placeholder="https://www.seusite.com.br/oferta"
                  aria-label="URL da página de vendas"
                  className="sm:flex-1"
                />
                <Button onClick={abrirSite} disabled={preview.starting}>
                  {preview.starting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-1.5 h-4 w-4" />}
                  Abrir site em preview
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {active ? (
                  <Button variant="outline" size="sm" onClick={desligar} disabled={preview.stopping}>
                    <Square className="mr-1.5 h-3.5 w-3.5" />
                    Encerrar preview
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={ligar} disabled={preview.starting}>
                    <Play className="mr-1.5 h-3.5 w-3.5" />
                    Ligar só o servidor
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={limpar} disabled={preview.clearing || preview.traces.length === 0}>
                  <Eraser className="mr-1.5 h-3.5 w-3.5" />
                  Limpar
                </Button>
                <p className="text-xs text-muted-foreground">
                  A página abre com o selo "Preview" no canto. Navegue, clique no botão de compra, faça um pedido de teste: tudo
                  aparece aqui em segundos.
                </p>
              </div>
              {settings && !capiReady && (
                <p className="text-xs text-warning">
                  A API de Conversões ainda não está configurada: as tags do Meta vão aparecer como "não disparadas".{' '}
                  <Link to="/integrations" className="underline underline-offset-2">
                    Configurar em Integrações
                  </Link>
                </p>
              )}
              {(preview.statusError || preview.loadError) && (
                <p className="text-xs text-destructive">{preview.statusError || preview.loadError}</p>
              )}
            </div>

            <Tabs value={tab} onValueChange={(v) => setTab(v as 'web' | 'server')}>
              <TabsList>
                <TabsTrigger value="web" className="gap-1.5">
                  <Globe className="h-3.5 w-3.5" />
                  Web ({web.length})
                  {webErrors && <StatusDot status="error" />}
                </TabsTrigger>
                <TabsTrigger value="server" className="gap-1.5">
                  <Server className="h-3.5 w-3.5" />
                  Servidor ({server.length})
                  {serverErrors && <StatusDot status="error" />}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="web" className="mt-4">
                {preview.loaded ? <WebDebug traces={web} /> : <Loading />}
              </TabsContent>
              <TabsContent value="server" className="mt-4">
                {preview.loaded ? <ServerDebug traces={server} /> : <Loading />}
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function Loading() {
  return (
    <div className="flex justify-center py-12">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}
