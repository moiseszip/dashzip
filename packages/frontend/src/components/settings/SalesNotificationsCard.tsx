import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/contexts/AuthContext';
import { useMask } from '@/contexts/StreamingModeContext';
import { api } from '@/lib/api';
import { enableSaleSound } from '@/lib/salesSound';
import { enableSalesPush, existingSalesPush, removeSalesPush, supportsSalesPush } from '@/lib/salesPush';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';

interface Preferences {
  pending: boolean;
  approved: boolean;
  sale_value: 'total' | 'net' | 'hidden';
  show_product: boolean;
  show_campaign: boolean;
  show_workspace: boolean;
  show_workspace_icon: boolean;
}
type SavedPreferences = { settings: Preferences; publicKey: string | null };

type Toggle = { key: Exclude<keyof Preferences, 'sale_value'>; label: string; hint?: string };
const TOGGLES: Toggle[] = [
  { key: 'pending', label: 'Enviar vendas pendentes', hint: 'Quando um pedido chega aguardando pagamento.' },
  { key: 'approved', label: 'Enviar vendas aprovadas', hint: 'Quando o checkout confirma o pagamento.' },
  { key: 'show_product', label: 'Mostrar nome do produto' },
  { key: 'show_campaign', label: 'Mostrar utm_campaign' },
  { key: 'show_workspace', label: 'Mostrar nome do painel' },
  { key: 'show_workspace_icon', label: 'Mostrar ícone do painel' },
];

export function SalesNotificationsCard() {
  const { activeWorkspace, workspaces, setActiveWorkspace } = useWorkspaceContext();
  const { mask } = useMask();
  if (!activeWorkspace) return <p className="text-sm text-muted-foreground">Crie um painel para configurar notificações de venda.</p>;

  return (
    <div className="space-y-4">
      <label className="block space-y-1.5 text-sm font-medium">
        <span>Painel</span>
        <select
          value={activeWorkspace.id}
          onChange={(event) => setActiveWorkspace(event.target.value)}
          className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-base sm:w-auto sm:text-sm"
        >
          {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{mask('workspace', workspace.name)}</option>)}
        </select>
      </label>
      <NotificationSettings key={activeWorkspace.id} workspaceId={activeWorkspace.id} name={mask('workspace', activeWorkspace.name) ?? 'Painel'} emoji={activeWorkspace.emoji} />
    </div>
  );
}

function NotificationSettings({ workspaceId, name, emoji }: { workspaceId: string; name: string; emoji?: string | null }) {
  const { user } = useAuth();
  const path = `/sales-push/preferences/${workspaceId}`;
  const queryKey = ['sales-push', user?.id, workspaceId];
  const cache = useQueryClient();
  const { data, isPending, isError, refetch } = useQuery({ queryKey, queryFn: () => api.get<SavedPreferences>(path) });
  const [draft, setDraft] = useState<Preferences | null>(null);
  const settings = draft ?? data?.settings;
  const save = useMutation({
    mutationFn: (value: Preferences) => api.put(path, value),
    onSuccess: (_, value) => {
      cache.setQueryData<SavedPreferences>(queryKey, (current) => current ? { ...current, settings: value } : undefined);
      setDraft(null);
    },
  });

  if (isPending) return <Loader2 aria-label="Carregando notificações" className="h-5 w-5 animate-spin" />;
  if (isError && !settings) return (
    <Card className="space-y-3 p-4">
      <p role="alert" className="text-sm text-destructive">Não foi possível carregar as notificações.</p>
      <Button variant="outline" onClick={() => void refetch()}>Tentar novamente</Button>
    </Card>
  );
  if (!settings) return null;

  function update<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    if (settings) setDraft({ ...settings, [key]: value });
    save.reset();
  }

  const amount = { total: 'R$ 149,90', net: 'R$ 139,90', hidden: '' }[settings.sale_value];
  const visibleIcon = settings.show_workspace_icon ? emoji : null;
  const visibleName = settings.show_workspace ? name : null;
  const panel = [visibleIcon, visibleName].filter(Boolean).join(' ');
  const optional = [settings.show_product && 'Produto exemplo', settings.show_campaign && 'campanha-exemplo'].filter(Boolean).join(' · ');
  const summary = amount ? `${amount} · Pix` : 'Pix';
  const preview = [summary, optional].filter(Boolean).join('\n');

  return (
    <div className="grid gap-4 md:grid-cols-2 md:items-start">
      <Card className="space-y-5 p-4 sm:p-5">
        <h2 className="font-semibold">Notificações de venda</h2>
        <fieldset disabled={save.isPending} className="min-w-0 space-y-4">
          {TOGGLES.slice(0, 2).map(({ key, label, hint }) => (
            <NotificationToggle key={key} label={label} hint={hint} checked={settings[key] ?? false} onChange={(value) => update(key, value)} />
          ))}
          <label className="block space-y-1.5 text-sm font-medium">
            <span>Valor da venda</span>
            <select
              className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-base sm:text-sm"
              value={settings.sale_value}
              onChange={(event) => update('sale_value', event.target.value as Preferences['sale_value'])}
            >
              <option value="total">Total</option>
              <option value="net">Líquido do checkout</option>
              <option value="hidden">Ocultar</option>
            </select>
            {settings.sale_value === 'net' && <span className="block text-xs font-normal text-muted-foreground">Exibido quando o checkout informa o valor líquido ou a taxa.</span>}
          </label>
          {TOGGLES.slice(2).map(({ key, label }) => (
            <NotificationToggle key={key} label={label} checked={settings[key] ?? false} onChange={(value) => update(key, value)} />
          ))}
          {settings.show_workspace_icon && !emoji && (
            <p className="text-xs text-muted-foreground">Defina um emoji em Configurações → Painéis para exibi-lo no aviso.</p>
          )}
        </fieldset>
        <Button className="min-h-11 w-full sm:w-auto" disabled={!draft || save.isPending} onClick={() => draft && save.mutate(draft)}>
          {save.isPending ? 'Salvando…' : 'Salvar preferências'}
        </Button>
        {save.isSuccess && <p role="status" className="text-sm text-muted-foreground">Preferências salvas.</p>}
        {save.isError && <p role="alert" className="text-sm text-destructive">Falha ao salvar. Tente novamente.</p>}
      </Card>
      <div className="space-y-4">
        <Card className="space-y-3 p-4 sm:p-5">
          <h2 className="font-semibold">Prévia da notificação</h2>
          {settings.pending || settings.approved ? (
            <div className="space-y-2" aria-live="polite">
              {(['pending', 'approved'] as const).filter((status) => settings[status]).map((status) => {
                const statusLabel = status === 'approved' ? 'Venda aprovada' : 'Venda pendente';
                const title = [statusLabel, panel].filter(Boolean).join(' · ');
                return (
                  <div key={status} className="flex items-start gap-3 rounded-2xl border border-border bg-background/70 p-3.5">
                    <img src="/apple-touch-icon.png" alt="" width="36" height="36" className="shrink-0 rounded-[9px]" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground">dash.zip</p>
                      <p className="break-words text-sm font-semibold">{title}</p>
                      <p className="whitespace-pre-line break-words text-sm leading-snug">{preview}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Ative os avisos de vendas pendentes ou aprovadas para ver a prévia.</p>
          )}
        </Card>
        <DeviceSettings workspaceId={workspaceId} publicKey={data?.publicKey ?? null} hasUnsavedChanges={!!draft} />
      </div>
    </div>
  );
}

function NotificationToggle({ label, hint, checked, onChange }: {
  label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm">
      <span><span className="font-medium">{label}</span>{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

/** Espera do envio de teste: com o app aberto na tela, o iOS mostra o aviso sem som. */
const TEST_DELAY_SECONDS = 5;

function DeviceSettings({ workspaceId, publicKey, hasUnsavedChanges }: {
  workspaceId: string; publicKey: string | null; hasUnsavedChanges: boolean;
}) {
  const [worker, setWorker] = useState<ServiceWorkerRegistration | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const supported = supportsSalesPush();
  useEffect(() => {
    if (!supported || !publicKey) return;
    let current = true;
    navigator.serviceWorker.register('/sales-push-sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then(async (registration) => {
        const subscription = await existingSalesPush();
        if (current) {
          setWorker(registration);
          setEndpoint(subscription?.endpoint ?? null);
        }
      })
      .catch(() => { if (current) setError('Não foi possível preparar as notificações neste aparelho.'); });
    return () => { current = false; };
  }, [publicKey, supported]);

  const action = useMutation({
    mutationFn: async ({ name, enable }: { name: 'enable' | 'test' | 'remote' | 'disable'; enable?: Promise<string> }) => {
      if (enable) return enable;
      if (name === 'remote') {
        const result = await api.post<{ sent: number }>('/sales-push/devices/test-others', {
          workspace_id: workspaceId, ...(endpoint && { except_endpoint: endpoint }),
        });
        return result.sent;
      }
      if (name === 'test' && endpoint) {
        await api.post('/sales-push/devices/test', { endpoint, workspace_id: workspaceId, delay_seconds: TEST_DELAY_SECONDS });
      }
      if (name === 'disable') await removeSalesPush();
      return null;
    },
    onMutate: ({ name }) => {
      setError('');
      setMessage(name === 'test'
        ? `Bloqueie a tela ou saia do app: a venda de exemplo chega em ${TEST_DELAY_SECONDS} segundos, com o som do iPhone.`
        : name === 'remote' ? 'Enviando a venda de exemplo...' : '');
    },
    onSuccess: (result, { name }) => {
      if (name === 'remote') {
        const sent = typeof result === 'number' ? result : 0;
        setMessage(`Venda de exemplo enviada para ${sent} ${sent === 1 ? 'aparelho' : 'aparelhos'}.`);
        return;
      }
      if (name !== 'test') setEndpoint(typeof result === 'string' ? result : null);
      setMessage(name === 'test' ? 'Venda de exemplo enviada. Confira as notificações do aparelho.'
        : name === 'enable' ? 'Notificações ativadas neste aparelho.' : 'Notificações desativadas neste aparelho.');
    },
    onError: (failure) => setError(failure instanceof Error ? failure.message : 'Não foi possível alterar este aparelho.'),
  });

  // Do computador para o celular: o aviso chega com o celular bloqueado, com o som do sistema.
  const remoteButton = (
    <Button variant="outline" className="min-h-11" disabled={action.isPending || hasUnsavedChanges}
      onClick={() => action.mutate({ name: 'remote' })}>
      Enviar teste para os outros aparelhos
    </Button>
  );

  return (
    <Card className="space-y-3 p-4 sm:p-5">
      <h2 className="font-semibold">Neste aparelho</h2>
      {!publicKey ? (
        <p className="text-sm text-muted-foreground">O Web Push precisa ser configurado nesta instância.</p>
      ) : !supported ? (
        <p className="text-sm text-muted-foreground">No iPhone, adicione o Dash.zip à Tela de Início e abra pelo ícone para ativar as notificações.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {endpoint ? (
            <>
              <Button className="min-h-11" disabled={action.isPending || hasUnsavedChanges} onClick={() => {
                action.mutate({ name: 'test' });
              }}>Simular venda</Button>
              <Button variant="outline" className="min-h-11" disabled={action.isPending} onClick={() => {
                action.mutate({ name: 'disable' });
              }}>Desativar</Button>
            </>
          ) : (
            <Button className="min-h-11" disabled={!worker || action.isPending} onClick={() => {
              if (!worker || !publicKey) return;
              // Request permission before yielding to the mutation scheduler.
              const enable = enableSalesPush(worker, publicKey);
              enableSaleSound();
              void enable.catch(() => undefined);
              action.mutate({ name: 'enable', enable });
            }}>Ativar neste aparelho</Button>
          )}
          {remoteButton}
        </div>
      )}
      {publicKey && !supported && <div>{remoteButton}</div>}
      {hasUnsavedChanges && <p className="text-xs text-muted-foreground">Salve as preferências para usá-las na simulação.</p>}
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </Card>
  );
}
