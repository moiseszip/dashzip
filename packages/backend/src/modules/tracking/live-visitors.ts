/**
 * Monta a aba "Ao vivo" a partir das sessões e dos eventos recentes.
 *
 * O snippet não manda batimento: a última atividade é o último lote que
 * chegou (pageview, clique, saída). Por isso "online" é uma estimativa —
 * atividade nos últimos minutos e sem uma saída de página depois dela.
 */

/** Atividade mais nova que isso, sem saída depois, conta como online. */
export const ONLINE_WINDOW_MS = 5 * 60_000;

export interface LiveSessionRow {
  session_id: string;
  visitor_id: string;
  started_at: string;
  ended_at: string | null;
  landing_page: string;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  fbclid: string | null;
  gclid: string | null;
  ad_id: string | null;
  device_type: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  pageviews: number;
  had_checkout_click: boolean;
}

export interface LiveEventRow {
  session_id: string;
  event_type: string;
  url: string | null;
  occurred_at: string;
}

/** Um envio à CAPI, como está em capi_events. */
export interface LiveCapiRow {
  id: string;
  event_name: string;
  session_id: string | null;
  status: string;
  error: string | null;
  created_at: string;
  sent_at: string | null;
  custom_data: { value?: number; currency?: string } | null;
  source_url: string | null;
}

export type CapiStatus = 'sent' | 'failed' | 'pending';

export interface LiveCapiEvent {
  id: string;
  eventName: string;
  status: CapiStatus;
  error: string | null;
  createdAt: string;
  sessionId: string | null;
  value: number | null;
  currency: string | null;
  page: string | null;
  /** Do acesso que gerou o evento, quando ele está na janela da aba. */
  country: string | null;
}

/** Os eventos de um acesso que foram para a Meta, agrupados pelo nome. */
export interface LiveMetaEvent {
  name: string;
  count: number;
  /** failed se algum falhou; pending se algum ainda está saindo; senão sent. */
  status: CapiStatus;
}

export interface LiveVisit {
  sessionId: string;
  visitorId: string;
  startedAt: string;
  lastSeenAt: string;
  online: boolean;
  /** O último evento foi uma saída: fechou a página ou trocou de aba. */
  exited: boolean;
  page: string;
  /** utm_source; sem ele, o site de onde veio. */
  source: string | null;
  /** Os UTMs do link da entrada, só os que vieram preenchidos. */
  utm: Partial<Record<'source' | 'medium' | 'campaign' | 'content' | 'term', string>>;
  /** Clique em anúncio: fbclid (Meta) ou gclid (Google). */
  clickId: 'fbclid' | 'gclid' | null;
  adId: string | null;
  device: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  pageviews: number;
  checkoutClick: boolean;
  metaEvents: LiveMetaEvent[];
}

export interface LiveSnapshot {
  online: number;
  visits: number;
  countries: { country: string | null; visits: number; online: number }[];
  list: LiveVisit[];
  /** Envios à Meta na janela, do mais novo para o mais antigo. */
  capi: LiveCapiEvent[];
  capiSummary: { sent: number; failed: number; pending: number };
  generatedAt: string;
}

function capiStatus(status: string): CapiStatus {
  return status === 'sent' ? 'sent' : status === 'failed' ? 'failed' : 'pending';
}

export function buildLiveSnapshot(
  sessions: LiveSessionRow[],
  events: LiveEventRow[],
  now = Date.now(),
  capiRows: LiveCapiRow[] = [],
): LiveSnapshot {
  const capiSorted = [...capiRows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const metaBySession = new Map<string, Map<string, LiveMetaEvent>>();
  for (const c of capiSorted) {
    if (!c.session_id) continue;
    const byName = metaBySession.get(c.session_id) ?? new Map<string, LiveMetaEvent>();
    const status = capiStatus(c.status);
    const entry = byName.get(c.event_name);
    if (!entry) {
      byName.set(c.event_name, { name: c.event_name, count: 1, status });
    } else {
      entry.count += 1;
      if (status === 'failed' || (status === 'pending' && entry.status === 'sent')) entry.status = status;
    }
    metaBySession.set(c.session_id, byName);
  }

  // Eventos do mais novo para o mais antigo: o primeiro visto é o último da sessão.
  const sorted = [...events].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const lastEvent = new Map<string, LiveEventRow>();
  const lastPage = new Map<string, string>();
  for (const e of sorted) {
    if (!lastEvent.has(e.session_id)) lastEvent.set(e.session_id, e);
    if (e.event_type === 'pageview' && e.url && !lastPage.has(e.session_id)) lastPage.set(e.session_id, e.url);
  }

  const list = sessions
    .map((s): LiveVisit => {
      const lastSeenAt = s.ended_at ?? s.started_at;
      const exited = lastEvent.get(s.session_id)?.event_type === 'page_exit';
      return {
        sessionId: s.session_id,
        visitorId: s.visitor_id,
        startedAt: s.started_at,
        lastSeenAt,
        online: !exited && now - new Date(lastSeenAt).getTime() <= ONLINE_WINDOW_MS,
        exited,
        page: lastPage.get(s.session_id) ?? s.landing_page,
        source: s.utm_source ?? referrerHost(s.referrer),
        utm: filled({
          source: s.utm_source,
          medium: s.utm_medium,
          campaign: s.utm_campaign,
          content: s.utm_content,
          term: s.utm_term,
        }),
        clickId: s.fbclid ? 'fbclid' : s.gclid ? 'gclid' : null,
        adId: s.ad_id,
        device: s.device_type,
        country: s.country,
        region: s.region,
        city: s.city,
        pageviews: s.pageviews,
        checkoutClick: s.had_checkout_click,
        metaEvents: [...(metaBySession.get(s.session_id)?.values() ?? [])],
      };
    })
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));

  const countryBySession = new Map(sessions.map((s) => [s.session_id, s.country]));

  const byCountry = new Map<string | null, { visits: number; online: number }>();
  for (const v of list) {
    const entry = byCountry.get(v.country) ?? { visits: 0, online: 0 };
    entry.visits += 1;
    if (v.online) entry.online += 1;
    byCountry.set(v.country, entry);
  }

  return {
    online: list.filter((v) => v.online).length,
    visits: list.length,
    countries: [...byCountry]
      .map(([country, c]) => ({ country, ...c }))
      .sort((a, b) => b.online - a.online || b.visits - a.visits),
    list,
    capi: capiSorted.map((c): LiveCapiEvent => {
      const value = Number(c.custom_data?.value);
      return {
        id: c.id,
        eventName: c.event_name,
        status: capiStatus(c.status),
        error: c.error,
        createdAt: c.created_at,
        sessionId: c.session_id,
        value: Number.isFinite(value) && c.custom_data?.value != null ? value : null,
        currency: c.custom_data?.currency ?? null,
        page: c.source_url,
        country: (c.session_id && countryBySession.get(c.session_id)) || null,
      };
    }),
    capiSummary: {
      sent: capiSorted.filter((c) => capiStatus(c.status) === 'sent').length,
      failed: capiSorted.filter((c) => capiStatus(c.status) === 'failed').length,
      pending: capiSorted.filter((c) => capiStatus(c.status) === 'pending').length,
    },
    generatedAt: new Date(now).toISOString(),
  };
}

function filled<K extends string>(values: Record<K, string | null>): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const key of Object.keys(values) as K[]) {
    if (values[key]) out[key] = values[key]!;
  }
  return out;
}

function referrerHost(referrer: string | null): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}
