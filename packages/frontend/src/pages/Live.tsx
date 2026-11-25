import { useState, type ReactNode } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Loader2, Monitor, ShoppingCart, Smartphone, Tablet } from 'lucide-react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { NoWorkspace } from '@/components/NoWorkspace';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { UTM_KEYS, useLive, type CapiStatus, type LiveCapiEvent, type LiveVisit } from '@/hooks/useLive';
import { cn } from '@/lib/utils';
import { useMask } from '@/contexts/StreamingModeContext';

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(['pt-BR'], { type: 'region' });
  } catch {
    return null;
  }
})();

function countryName(code: string | null): string {
  if (!code) return 'Desconhecido';
  try {
    return regionNames?.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** Imagem e não emoji: o Windows não desenha bandeira em emoji, só as letras. */
function Flag({ code }: { code: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!code || !/^[a-z]{2}$/i.test(code) || failed) {
    return <span className="inline-block h-3 w-4 shrink-0 rounded-[2px] bg-foreground/10" aria-hidden />;
  }
  return (
    <img
      src={`https://flagcdn.com/w40/${code.toLowerCase()}.png`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-3 w-4 shrink-0 rounded-[2px] object-cover"
    />
  );
}

function pagePath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url || '—';
  }
}

function ago(iso: string): string {
  return formatDistanceToNowStrict(new Date(iso), { locale: ptBR, addSuffix: true });
}

function DeviceIcon({ device }: { device: string | null }) {
  const Icon = device === 'mobile' ? Smartphone : device === 'tablet' ? Tablet : Monitor;
  return <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label={device ?? 'desktop'} />;
}

/** Quem está na página agora e quem passou nos últimos 30 minutos, com o país de cada um. */
export default function Live() {
  const { activeWorkspace } = useWorkspaceContext();
  const live = useLive();
  const data = live.data;
  const { scrub } = useMask();

  return (
    <DashboardLayout wide>
      <div className="space-y-5 animate-dash-in">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Ao vivo</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Acessos e eventos enviados à Meta nos últimos 30 minutos, atualizados a cada 5 segundos
            </p>
          </div>
          {data && (
            <span className="inline-flex items-center gap-2 rounded-full border border-foreground/10 px-3 py-1 text-xs">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              Atualizado {ago(data.generatedAt)}
            </span>
          )}
        </div>

        {!activeWorkspace ? (
          <NoWorkspace />
        ) : live.loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : live.error && !data ? (
          <p className="text-sm text-destructive">{scrub(live.error)}</p>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="Online agora" value={data.online} hint="Atividade nos últimos 5 minutos, sem ter saído da página" />
              <Stat label="Acessos em 30 min" value={data.visits} hint="Sessões com alguma atividade na última meia hora" />
              <Stat
                label="Enviados à Meta em 30 min"
                className="col-span-2 sm:col-span-1"
                value={data.capiSummary?.sent ?? 0}
                hint="Eventos aceitos pela API de Conversões da Meta na última meia hora"
                extra={
                  data.capiSummary?.failed ? (
                    <span className="text-xs text-destructive">{data.capiSummary.failed} com falha</span>
                  ) : null
                }
              />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)]">
              <section className="rounded-lg border border-foreground/10">
                <h2 className="border-b border-foreground/5 px-4 py-3 text-sm font-medium">Países</h2>
                {data.countries.length === 0 ? (
                  <Empty />
                ) : (
                  <ul className="divide-y divide-foreground/5">
                    {data.countries.map((c) => (
                      <li key={c.country ?? '—'} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                        <Flag code={c.country} />
                        <span className="min-w-0 flex-1 truncate">{countryName(c.country)}</span>
                        {c.online > 0 && <span className="text-xs text-success">{c.online} online</span>}
                        <span className="w-8 text-right tabular-nums text-muted-foreground">{c.visits}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="rounded-lg border border-foreground/10">
                <h2 className="border-b border-foreground/5 px-4 py-3 text-sm font-medium">Acessos</h2>
                {data.list.length === 0 ? <Empty /> : (
                  <ul className="divide-y divide-foreground/5">
                    {data.list.map((v) => <VisitRow key={v.sessionId} visit={v} />)}
                  </ul>
                )}
              </section>
            </div>

            <section className="rounded-lg border border-foreground/10">
              <h2 className="border-b border-foreground/5 px-4 py-3 text-sm font-medium">Eventos enviados à Meta</h2>
              {!data.capi?.length ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Nenhum evento enviado à Meta nos últimos 30 minutos.
                </p>
              ) : (
                <ul className="divide-y divide-foreground/5">
                  {data.capi.map((e) => <CapiRow key={e.id} event={e} />)}
                </ul>
              )}
            </section>
            {live.error && <p className="text-xs text-destructive">{scrub(live.error)}</p>}
          </>
        ) : null}
      </div>
    </DashboardLayout>
  );
}

function Stat({ label, value, hint, extra, className }: { label: string; value: number; hint: string; extra?: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-foreground/10 p-4', className)} title={hint}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {extra}
      </p>
    </div>
  );
}

const STATUS_LABEL: Record<CapiStatus, string> = {
  sent: 'Enviado',
  failed: 'Falhou',
  pending: 'Enviando',
};

const STATUS_CLASS: Record<CapiStatus, string> = {
  sent: 'bg-success/10 text-success',
  failed: 'bg-destructive/10 text-destructive',
  pending: 'bg-warning/10 text-warning',
};

function money(value: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(value);
  } catch {
    return `${value} ${currency ?? ''}`.trim();
  }
}

/** Um evento que saiu para a API de Conversões. */
function CapiRow({ event: e }: { event: LiveCapiEvent }) {
  const { enabled, mask, scrub } = useMask();
  const page = e.page ? mask('page', pagePath(e.page)) : null;
  const error = scrub(e.error);
  return (
    <li className="flex items-start gap-3 px-4 py-2.5 text-sm">
      <span className={cn('mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px]', STATUS_CLASS[e.status])}>
        {STATUS_LABEL[e.status]}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{e.eventName}</span>
          {e.value != null && <span className="tabular-nums">{money(e.value, e.currency)}</span>}
          {e.country && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Flag code={e.country} />
              {countryName(e.country)}
            </span>
          )}
          {!e.sessionId && <span className="text-xs text-muted-foreground">sem sessão do site</span>}
        </div>
        {page && (
          <p className="truncate text-xs text-muted-foreground" title={enabled ? page : e.page!}>
            {page}
          </p>
        )}
        {error && (
          <p className="break-words text-xs text-destructive" title={error}>
            {error}
          </p>
        )}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{ago(e.createdAt)}</span>
    </li>
  );
}

/** Os eventos deste acesso que foram para a Meta. */
function MetaChips({ visit: v }: { visit: LiveVisit }) {
  if (!v.metaEvents?.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {v.metaEvents.map((m) => (
        <span
          key={m.name}
          className={cn('rounded px-1.5 py-0.5 text-[11px]', STATUS_CLASS[m.status])}
          title={`${m.name} enviado à Meta ${m.count}x — ${STATUS_LABEL[m.status].toLowerCase()}`}
        >
          Meta: {m.name}
          {m.count > 1 && ` ×${m.count}`}
        </span>
      ))}
    </div>
  );
}

function Empty() {
  return (
    <p className="px-4 py-8 text-center text-sm text-muted-foreground">
      Nenhum acesso nos últimos 30 minutos.
    </p>
  );
}

/** Os parâmetros do link pelo qual a pessoa chegou. */
function UtmChips({ visit: v }: { visit: LiveVisit }) {
  const { mask, maskUtm } = useMask();
  // Modo streaming: utm_campaign/medium/content trazem nome|id e viram o apelido da campanha/conjunto/anúncio.
  const chips: [string, string][] = UTM_KEYS.flatMap((key) => {
    const value = maskUtm(key, v.utm[key]);
    return value ? [[`utm_${key}`, value] as [string, string]] : [];
  });
  if (v.adId) chips.push(['ad_id', mask('id', v.adId)]);
  if (!chips.length && !v.clickId) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {v.clickId && (
        <span
          className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary"
          title={`Chegou com ${v.clickId} na URL`}
        >
          {v.clickId === 'fbclid' ? 'Anúncio Meta' : 'Anúncio Google'}
        </span>
      )}
      {chips.map(([key, value]) => (
        <span
          key={key}
          className="max-w-full truncate rounded bg-foreground/5 px-1.5 py-0.5 font-mono text-[11px]"
          title={`${key}=${value}`}
        >
          <span className="text-muted-foreground">{key}=</span>
          {value}
        </span>
      ))}
    </div>
  );
}

function VisitRow({ visit: v }: { visit: LiveVisit }) {
  const { enabled, mask } = useMask();
  const page = mask('page', pagePath(v.page));
  const place = [v.city, v.region].filter(Boolean).join(', ');
  return (
    <li className="flex items-start gap-3 px-4 py-3 text-sm">
      <span
        className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', v.online ? 'bg-success' : 'bg-muted-foreground/40')}
        title={v.online ? 'Online' : v.exited ? 'Saiu ou trocou de aba' : 'Sem atividade há mais de 5 minutos'}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Flag code={v.country} />
          <span className="font-medium">{countryName(v.country)}</span>
          {place && <span className="truncate text-xs text-muted-foreground">{place}</span>}
          <DeviceIcon device={v.device} />
          {v.checkoutClick && (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] text-success">
              <ShoppingCart className="h-3 w-3" />
              Clicou no checkout
            </span>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground" title={enabled ? page : v.page}>
          {page}
          {' · '}
          {v.pageviews} {v.pageviews === 1 ? 'página' : 'páginas'}
          {Object.keys(v.utm).length === 0 && v.source && ` · veio de ${mask('domain', v.source)}`}
        </p>
        <UtmChips visit={v} />
        <MetaChips visit={v} />
      </div>
      <span className="shrink-0 text-right text-xs text-muted-foreground">
        {v.online ? 'agora' : v.exited ? 'saiu' : 'inativo'}
        <br />
        {ago(v.lastSeenAt)}
      </span>
    </li>
  );
}
