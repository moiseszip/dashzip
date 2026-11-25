import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { TrackingModule } from '../tracking.module';
import { SharedModule } from '../../../shared/shared.module';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { MetaCapiService } from '../../meta-capi/meta-capi.service';
import { CacheService } from '../../../shared/services/cache.service';
import { sharedCookieDomain } from '../tracking-collect.controller';

const TID = '11111111-2222-4333-8444-555555555555';
const LEGACY_TID = '23456789-2222-4333-8444-555555555555';
const VID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SID = 'ffffffff-0000-4111-8222-333333333333';
const EID = '99999999-8888-4777-8666-555555555555';
const CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148';
const FBP = 'fb.1.1711800000000.1234567890';
const FBC = 'fb.1.1711800000000.IwAR0abc';
const DEBUG_TOKEN = 'b'.repeat(48);

/**
 * A pilha HTTP de verdade (Fastify + ValidationPipe global + ThrottlerGuard
 * global, montados como no bootstrap), com Supabase e CAPI trocados por
 * dublês. Pega o que teste de unidade não pega: o corpo text/plain do
 * sendBeacon, o prefixo /api, o guard global, os headers da resposta.
 */
describe('Rotas públicas do rastreio (HTTP)', () => {
  let app: NestFastifyApplication;
  const rpc = jest.fn();
  const maybeSingle = jest.fn();
  const insert = jest.fn();
  const capi = {
    getConfig: jest.fn(),
    sendWebEvents: jest.fn(),
    invalidateConfig: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ ENCRYPTION_KEY: '0'.repeat(64) })],
        }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
        SharedModule,
        TrackingModule,
      ],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    })
      .overrideProvider(SupabaseService)
      .useValue({
        getClient: () => ({
          rpc,
          from: (table: string) => ({
            select: () => ({ eq: () => ({ maybeSingle }) }),
            insert: (rows: unknown) => insert(table, rows),
          }),
        }),
      })
      .overrideProvider(MetaCapiService)
      .useValue(capi)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.setGlobalPrefix('api', { exclude: ['health'] });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(() => app?.close());
  beforeEach(() => {
    app.get(CacheService).invalidateByPrefix('debug:');
    app.get(CacheService).invalidateByPrefix('tracking:workspace-route:');
    insert.mockReset().mockResolvedValue({ error: null });
    rpc.mockReset().mockResolvedValue({ data: 1, error: null });
    maybeSingle.mockReset().mockResolvedValue({ data: { id: TID }, error: null });
    capi.getConfig.mockReset().mockResolvedValue({ param: 'xcod', pixelId: '123456789012345' });
    capi.sendWebEvents.mockReset().mockResolvedValue(undefined);
  });

  const collect = (payload: unknown, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/t/collect',
      headers: { 'content-type': 'text/plain;charset=UTF-8', 'user-agent': CHROME, ...headers },
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    });

  describe('tracker.js', () => {
    it('sai com a area, o endpoint da propria requisicao e a configuracao da plataforma', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/t/tracker.js?tid=${TID}`,
        headers: { host: 'track.loja.com.br', 'x-forwarded-proto': 'https' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/javascript');
      expect(res.headers['cache-control']).toBe('public, max-age=300');
      expect(res.body).toContain(JSON.stringify(TID));
      expect(res.body).toContain('"https://track.loja.com.br/api/t/collect"');
      expect(res.body).toContain('PARAM = "xcod"');
      expect(res.body).toContain('PIXEL = "123456789012345"');
    });

    it('gera o snippet do painel para a LP que usa um ID legado', async () => {
      maybeSingle.mockResolvedValue({
        data: { id: LEGACY_TID, redirect_workspace_id: TID },
        error: null,
      });
      const res = await app.inject({ method: 'GET', url: `/api/t/tracker.js?tid=${LEGACY_TID}` });
      expect(res.body).toContain(JSON.stringify(TID));
      expect(res.body).not.toContain(JSON.stringify(LEGACY_TID));
      expect(capi.getConfig).toHaveBeenCalledWith(TID);
    });

    it('area desconhecida recebe um script que nao faz nada, sem 404 no console do cliente', async () => {
      capi.getConfig.mockResolvedValue(null);
      maybeSingle.mockResolvedValue({ data: null, error: null });
      const res = await app.inject({ method: 'GET', url: '/api/t/tracker.js?tid=22222222-2222-4333-8444-555555555555' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('window.dashzip=window.sentinel=function(){}');

      const bad = await app.inject({ method: 'GET', url: '/api/t/tracker.js?tid=<script>' });
      expect(bad.body).toContain('window.dashzip=window.sentinel=function(){}');
    });

    it('host estranho nao entra no script', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/t/tracker.js?tid=33333333-2222-4333-8444-555555555555',
        headers: { host: 'evil.com"/><script>' },
      });
      expect(res.body).not.toContain('evil.com');
    });
  });

  describe('collect', () => {
    it('grava fbp, fbc e IP na sessao e manda PageView/InitiateCheckout para a CAPI', async () => {
      const res = await collect(
        {
          tid: TID, vid: VID, sid: SID, sr: '390x844', lang: 'pt-BR', fbp: FBP, fbc: FBC,
          events: [
            { type: 'pageview', event_id: EID, url: 'https://www.loja.com.br/oferta?fbclid=x', utm_source: 'facebook' },
            { type: 'page_exit', duration_seconds: 30 },
          ],
        },
        {
          'x-forwarded-for': '2804:14c:5b8::1, 10.0.0.1',
          'x-vercel-ip-city': 'S%C3%A3o%20Paulo',
          'x-vercel-ip-country-region': 'SP',
          'x-vercel-ip-country': 'BR',
        },
      );

      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('');
      expect(res.headers['access-control-allow-origin']).toBe('*');

      const [fn, args] = rpc.mock.calls[0];
      expect(fn).toBe('tracking_ingest');
      expect(args.p_ctx).toMatchObject({
        device_type: 'mobile', city: 'São Paulo', region: 'SP', country: 'BR',
        fbp: FBP, fbc: FBC, ip_address: '2804:14c:5b8::1',
      });
      expect(args.p_events[0]).toMatchObject({ type: 'pageview', event_id: EID, url: 'https://www.loja.com.br/oferta' });

      // Só o pageview vai para a CAPI; a saída de página não é evento do Meta.
      expect(capi.sendWebEvents).toHaveBeenCalledWith(TID, [
        expect.objectContaining({
          type: 'pageview', eventId: EID, url: 'https://www.loja.com.br/oferta',
          visitorId: VID, sessionId: SID, ip: '2804:14c:5b8::1', userAgent: CHROME,
          fbp: FBP, fbc: FBC, city: 'São Paulo', region: 'SP', country: 'BR',
        }),
      ]);
    });

    it('grava um beacon de um snippet legado no painel consolidado', async () => {
      maybeSingle.mockResolvedValue({ data: { id: LEGACY_TID, redirect_workspace_id: TID }, error: null });
      const res = await collect({
        tid: LEGACY_TID, vid: VID, sid: SID, events: [{ type: 'pageview', event_id: EID }],
      });
      expect(res.statusCode).toBe(200);
      expect(rpc).toHaveBeenCalledWith('tracking_ingest', expect.objectContaining({ p_workspace_id: TID }));
      expect(capi.sendWebEvents).toHaveBeenCalledWith(TID, expect.any(Array));
    });

    it('fbp e fbc fora do formato do Meta nao passam', async () => {
      await collect({ tid: TID, vid: VID, sid: SID, fbp: 'lixo', fbc: '<script>', events: [{ type: 'pageview', event_id: EID }] });
      expect(rpc.mock.calls[0][1].p_ctx).toMatchObject({ fbp: null, fbc: null });
    });

    it('no subdominio do cliente, regrava os cookies pelo servidor no dominio raiz', async () => {
      const res = await collect(
        { tid: TID, vid: VID, sid: SID, fbp: FBP, fbc: FBC, events: [{ type: 'pageview', event_id: EID }] },
        { host: 'track.loja.com.br', origin: 'https://www.loja.com.br' },
      );
      const cookies = ([] as string[]).concat(res.headers['set-cookie'] as any);
      expect(cookies).toHaveLength(3);
      expect(cookies[0]).toBe(`_stl_vid=${VID}; Max-Age=31536000; Domain=loja.com.br; Path=/; SameSite=Lax; Secure`);
      expect(cookies[1]).toContain(`_fbp=${encodeURIComponent(FBP)}; Max-Age=7776000; Domain=loja.com.br`);
      expect(cookies[2]).toContain('_fbc=');
    });

    it('fora do subdominio do cliente, nao grava cookie', async () => {
      const res = await collect(
        { tid: TID, vid: VID, sid: SID, fbp: FBP, events: [{ type: 'pageview', event_id: EID }] },
        { host: 'painel.vercel.app', origin: 'https://www.loja.com.br' },
      );
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('robo do Facebook e lixo nao chegam ao banco nem ao Meta, e ainda assim respondem 200', async () => {
      const bot = await collect({ tid: TID, vid: VID, sid: SID, events: [{ type: 'pageview' }] }, { 'user-agent': 'facebookexternalhit/1.1' });
      const junk = await collect('nao e json');
      expect(bot.statusCode).toBe(200);
      expect(junk.statusCode).toBe(200);
      expect(rpc).not.toHaveBeenCalled();
      expect(capi.sendWebEvents).not.toHaveBeenCalled();
    });

    it('falha do banco nao vira erro para o visitante', async () => {
      rpc.mockResolvedValue({ data: null, error: { message: 'relation does not exist' } });
      const res = await collect({ tid: TID, vid: VID, sid: SID, events: [{ type: 'pageview' }] });
      expect(res.statusCode).toBe(200);
    });

    it('nao cai no limite global de 60/min, e sim no proprio de 300/min por IP', async () => {
      const send = (ip: string) => collect({ tid: TID, vid: VID, sid: SID, events: [{ type: 'pageview' }] }, { 'x-forwarded-for': ip });

      for (let i = 0; i < 300; i++) expect((await send('9.9.9.9')).statusCode).toBe(200);
      expect(rpc).toHaveBeenCalledTimes(300);

      await send('9.9.9.9'); // 301ª: descartada em silêncio
      expect(rpc).toHaveBeenCalledTimes(300);

      await send('8.8.8.8'); // outro IP segue passando
      expect(rpc).toHaveBeenCalledTimes(301);
    });
  });

  describe('preview (debug do servidor)', () => {
    const previewOn = () =>
      maybeSingle.mockResolvedValue({
        data: { id: TID, debug_until: new Date(Date.now() + 600_000).toISOString(), debug_token: DEBUG_TOKEN },
        error: null,
      });

    it('fora do preview, nada vai para debug_traces', async () => {
      await collect({ tid: TID, vid: VID, sid: SID, events: [{ type: 'pageview', event_id: EID }] });
      expect(insert).not.toHaveBeenCalled();
    });

    it('em preview, grava o rastro com request, variaveis, tags e o navegador que depura', async () => {
      previewOn();
      await collect(
        { tid: TID, vid: VID, sid: SID, fbp: FBP, dbg: DEBUG_TOKEN, events: [{ type: 'pageview', event_id: EID }] },
        { 'x-forwarded-for': '7.7.7.7' },
      );

      const [table, row] = insert.mock.calls.find((c) => c[0] === 'debug_traces')!;
      expect(table).toBe('debug_traces');
      expect(row).toMatchObject({
        workspace_id: TID,
        source: 'server',
        kind: 'collect',
        title: 'PageView',
        browser_token: DEBUG_TOKEN,
      });
      expect(row.data.request.path).toBe('/api/t/collect');
      expect(row.data.variables.Visitante).toMatchObject({ visitor_id: VID, fbp: FBP, ip: '7.7.7.7' });
      expect(row.data.tags).toContainEqual(expect.objectContaining({ name: 'Gravar visita no banco', status: 'fired' }));
      // A gravação aparece com os dados escritos e o que o banco devolveu.
      expect(row.data.db).toEqual([
        expect.objectContaining({
          table: 'tracking_visitors + tracking_sessions + tracking_events',
          operation: 'rpc',
          data: expect.objectContaining({ p_visitor_id: VID, p_ctx: expect.objectContaining({ ip_address: '7.7.7.7', fbp: FBP }) }),
          result: 1,
          error: null,
        }),
      ]);
      expect(row.data.response).toEqual({ status: 200, body: '' });
    });

    it('so requisicoes com evento do Meta: saida de pagina e robo nao entram no preview', async () => {
      previewOn();
      await collect({ tid: TID, vid: VID, sid: SID, events: [{ type: 'page_exit', duration_seconds: 5 }] });
      await collect({ tid: TID, vid: VID, sid: SID, events: [{ type: 'pageview' }] }, { 'user-agent': 'facebookexternalhit/1.1' });
      expect(insert.mock.calls.filter((c) => c[0] === 'debug_traces')).toHaveLength(0);
      expect(rpc).toHaveBeenCalledTimes(1); // a saída foi gravada normalmente
    });

    it('mensagens do navegador entram so com o token do preview ligado', async () => {
      previewOn();
      const post = (dbg: string) =>
        app.inject({
          method: 'POST',
          url: '/api/t/debug',
          headers: { 'content-type': 'text/plain' },
          payload: JSON.stringify({
            tid: TID,
            dbg,
            msgs: [{ type: 'pageview', title: 'PageView', page_id: 'abcdef12', data: { tags: [{ name: 'x', status: 'fired' }] } }],
          }),
        });

      const ok = await post(DEBUG_TOKEN);
      expect(ok.json()).toEqual({ ok: true });
      expect(ok.headers['access-control-allow-origin']).toBe('*');
      const [, rows] = insert.mock.calls.find((c) => c[0] === 'debug_traces')!;
      expect(rows[0]).toMatchObject({ workspace_id: TID, source: 'web', kind: 'pageview', page_id: 'abcdef12', status: 'ok' });

      insert.mockClear();
      const wrong = await post('c'.repeat(48));
      expect(wrong.json()).toEqual({ ok: false, reason: 'preview encerrado' });
      expect(insert).not.toHaveBeenCalled();
    });
  });

  it('ping responde para a verificacao do subdominio, de qualquer origem', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/t/ping' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.json()).toEqual({ ok: true, service: 'dashzip-tracking' });
  });

  it('rotas de leitura exigem login', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/debug/traces?workspace_id=${TID}` });
    expect(res.statusCode).toBe(401);
    const start = await app.inject({ method: 'POST', url: '/api/debug/start', payload: { workspace_id: TID } });
    expect(start.statusCode).toBe(401);
    const capiRes = await app.inject({ method: 'GET', url: `/api/capi/settings?workspace_id=${TID}` });
    expect(capiRes.statusCode).toBe(401);
    const cron = await app.inject({ method: 'GET', url: '/api/capi/retry-cron' });
    expect(cron.statusCode).toBe(401); // sem CRON_SECRET a rota fica fechada
  });
});

describe('sharedCookieDomain', () => {
  it('acha o dominio raiz comum entre o subdominio de rastreio e a pagina', () => {
    expect(sharedCookieDomain('track.loja.com.br', 'www.loja.com.br')).toBe('loja.com.br');
    expect(sharedCookieDomain('track.loja.com.br', 'loja.com.br')).toBe('loja.com.br');
    expect(sharedCookieDomain('t.loja.com', 'oferta.loja.com')).toBe('loja.com');
  });

  it('sem dominio em comum, nada', () => {
    expect(sharedCookieDomain('painel.vercel.app', 'www.loja.com.br')).toBeNull();
    expect(sharedCookieDomain('track.loja.com.br', 'www.outraloja.com.br')).toBeNull();
    expect(sharedCookieDomain('loja.com', 'www.loja.com')).toBeNull(); // nao grava em "com"
    expect(sharedCookieDomain('track.loja.com.br', null)).toBeNull();
  });
});
