import { buildLiveSnapshot, LiveSessionRow } from '../live-visitors';

const NOW = Date.parse('2026-10-29T20:00:00Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

function session(id: string, over: Partial<LiveSessionRow> = {}): LiveSessionRow {
  return {
    session_id: id,
    visitor_id: `v-${id}`,
    started_at: ago(10),
    ended_at: ago(1),
    landing_page: 'https://site.com/',
    referrer: null,
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_content: null,
    utm_term: null,
    fbclid: null,
    gclid: null,
    ad_id: null,
    device_type: 'mobile',
    country: 'BR',
    region: 'SP',
    city: 'Sao Paulo',
    pageviews: 1,
    had_checkout_click: false,
    ...over,
  };
}

describe('buildLiveSnapshot', () => {
  it('online = atividade recente e sem saida de pagina depois', () => {
    const snap = buildLiveSnapshot(
      [session('a'), session('b'), session('c', { ended_at: ago(20) })],
      [
        { session_id: 'b', event_type: 'pageview', url: 'https://site.com/', occurred_at: ago(3) },
        { session_id: 'b', event_type: 'page_exit', url: 'https://site.com/', occurred_at: ago(1) },
      ],
      NOW,
    );
    const byId = Object.fromEntries(snap.list.map((v) => [v.sessionId, v]));
    expect(byId.a.online).toBe(true);
    expect(byId.b).toMatchObject({ online: false, exited: true });
    expect(byId.c.online).toBe(false);
    expect(snap).toMatchObject({ online: 1, visits: 3 });
  });

  it('a pagina atual e o ultimo pageview; sem ele, a de entrada', () => {
    const snap = buildLiveSnapshot(
      [session('a'), session('b', { landing_page: 'https://site.com/entrada' })],
      [
        { session_id: 'a', event_type: 'pageview', url: 'https://site.com/1', occurred_at: ago(5) },
        { session_id: 'a', event_type: 'pageview', url: 'https://site.com/2', occurred_at: ago(2) },
        { session_id: 'a', event_type: 'checkout_click', url: 'https://pay.com/x', occurred_at: ago(1) },
      ],
      NOW,
    );
    expect(snap.list.find((v) => v.sessionId === 'a')?.page).toBe('https://site.com/2');
    expect(snap.list.find((v) => v.sessionId === 'b')?.page).toBe('https://site.com/entrada');
  });

  it('agrupa por pais, com os mais online primeiro, e usa o referrer sem UTM', () => {
    const snap = buildLiveSnapshot(
      [
        session('a', { country: 'US', ended_at: ago(20) }),
        session('b', { country: 'US', ended_at: ago(25) }),
        session('c', { country: 'BR', referrer: 'https://www.instagram.com/p/1' }),
        session('d', { country: null, utm_source: 'facebook' }),
      ],
      [],
      NOW,
    );
    expect(snap.countries).toEqual([
      { country: 'BR', visits: 1, online: 1 },
      { country: null, visits: 1, online: 1 },
      { country: 'US', visits: 2, online: 0 },
    ]);
    expect(snap.list.find((v) => v.sessionId === 'c')?.source).toBe('instagram.com');
    expect(snap.list.find((v) => v.sessionId === 'd')?.source).toBe('facebook');
  });

  it('traz so os UTMs preenchidos e o clique do anuncio', () => {
    const snap = buildLiveSnapshot(
      [
        session('a', { utm_source: 'fb', utm_medium: 'paid', utm_content: 'criativo-3', fbclid: 'IwAR1', ad_id: '120' }),
        session('b', { gclid: 'Cj0K' }),
        session('c'),
      ],
      [],
      NOW,
    );
    const byId = Object.fromEntries(snap.list.map((v) => [v.sessionId, v]));
    expect(byId.a).toMatchObject({
      utm: { source: 'fb', medium: 'paid', content: 'criativo-3' },
      clickId: 'fbclid',
      adId: '120',
    });
    expect(byId.a.utm).not.toHaveProperty('campaign');
    expect(byId.b.clickId).toBe('gclid');
    expect(byId.c).toMatchObject({ utm: {}, clickId: null, adId: null });
  });
});

describe('buildLiveSnapshot — envios a Meta', () => {
  const capi = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    event_name: 'PageView',
    session_id: 'a',
    status: 'sent',
    error: null,
    created_at: ago(2),
    sent_at: ago(2),
    custom_data: null,
    source_url: 'https://site.com/',
    ...over,
  });

  it('lista os envios do mais novo ao mais antigo, com o pais do acesso', () => {
    const snap = buildLiveSnapshot(
      [session('a', { country: 'FR' })],
      [],
      NOW,
      [
        capi('1', { created_at: ago(5) }),
        capi('2', { event_name: 'Purchase', status: 'failed', error: 'x', custom_data: { value: 28.99, currency: 'USD' } }),
        capi('3', { session_id: null, event_name: 'Purchase', status: 'pending', created_at: ago(1) }),
      ],
    );
    expect(snap.capi.map((c) => c.id)).toEqual(['3', '2', '1']);
    expect(snap.capi[1]).toMatchObject({ eventName: 'Purchase', status: 'failed', value: 28.99, currency: 'USD', country: 'FR' });
    expect(snap.capi[0].country).toBeNull();
    expect(snap.capiSummary).toEqual({ sent: 1, failed: 1, pending: 1 });
  });

  it('agrupa por nome os eventos de cada acesso; uma falha marca o grupo', () => {
    const snap = buildLiveSnapshot([session('a'), session('b')], [], NOW, [
      capi('1'),
      capi('2'),
      capi('3', { event_name: 'InitiateCheckout', status: 'failed' }),
      capi('4', { event_name: 'InitiateCheckout' }),
    ]);
    const a = snap.list.find((v) => v.sessionId === 'a')!;
    expect(a.metaEvents).toEqual(
      expect.arrayContaining([
        { name: 'PageView', count: 2, status: 'sent' },
        { name: 'InitiateCheckout', count: 2, status: 'failed' },
      ]),
    );
    expect(snap.list.find((v) => v.sessionId === 'b')!.metaEvents).toEqual([]);
  });
});
