import { ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { SharedModule } from '../../../shared/shared.module';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { VslModule } from '../vsl.module';

const workspace = '12345678-1234-4123-8123-123456789012';
const otherWorkspace = '87654321-1234-4123-8123-123456789012';
const source = 'https://fixture.supabase.co';
const serviceKey = 'fixture-service-role';
const config: Record<string, string> = {
  ENCRYPTION_KEY: 'fixture-encryption-key',
  VSL_ENABLED_WORKSPACE_ID: workspace,
  VSL_SOURCE_SUPABASE_URL: source,
  VSL_SOURCE_SERVICE_ROLE_KEY: serviceKey,
};

const row = (pagina: string, extra: Record<string, unknown> = {}) => ({
  pagina, video: 'mini-vsl-v1', duracao: 10, som: false, seg_som: [], cta: false, utm_content: 'Criativo 1|123', ...extra,
});

describe('GET /api/vsl/:workspaceId', () => {
  let app: NestFastifyApplication;
  let sourceFetch: jest.SpyInstance;
  const getConfig = jest.fn((key: string) => config[key]);
  const workspaceQuery = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(),
  };
  const from = jest.fn(() => workspaceQuery);

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), SharedModule, VslModule],
    })
      .overrideProvider(ConfigService).useValue({ get: getConfig })
      .overrideProvider(SupabaseService).useValue({
        getUserFromToken: async (token: string) => token === 'fixture' ? { id: 'owner' } : null,
        getClient: () => ({ from }),
      })
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    getConfig.mockImplementation((key) => config[key]);
    workspaceQuery.maybeSingle.mockResolvedValue({ data: { id: workspace }, error: null });
    sourceFetch = jest.spyOn(global, 'fetch');
  });

  afterEach(() => sourceFetch?.mockRestore());
  afterAll(() => app?.close());

  const request = (path = workspace, token = 'fixture') =>
    app.inject({ method: 'GET', url: `/api/vsl/${path}`, headers: { authorization: `Bearer ${token}` } });

  it('recusa visitante sem sessão e filtros inválidos', async () => {
    expect((await request(workspace, 'invalid')).statusCode).toBe(401);
    expect((await request(`${workspace}?days=90`)).statusCode).toBe(400);
    expect((await request(`${workspace}?versions=unknown`)).statusCode).toBe(400);
    expect((await request(`${workspace}?extra=1`)).statusCode).toBe(400);
    expect(from).not.toHaveBeenCalled();
    expect(sourceFetch).not.toHaveBeenCalled();
  });

  it('recusa não proprietários, dashboards redirecionados e workspaces desabilitados', async () => {
    workspaceQuery.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await request()).statusCode).toBe(403);
    expect(from).toHaveBeenCalledWith('workspaces');
    expect(workspaceQuery.eq).toHaveBeenCalledWith('user_id', 'owner');
    expect(workspaceQuery.is).toHaveBeenCalledWith('redirect_workspace_id', null);
    expect((await request(otherWorkspace)).statusCode).toBe(403);
    expect(sourceFetch).not.toHaveBeenCalled();
  });

  it('lê a tabela de visitas da fonte, agrega por versão e devolve sem cache', async () => {
    sourceFetch.mockResolvedValueOnce(Response.json([
      row('/', { som: true, seg_som: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], cta: true }),
      row('/', { som: true, seg_som: [0, 1, 2] }),
      row('/'),
      row('/quiz/', { som: true, seg_som: [0, 1, 2, 3, 4], utm_content: null }),
      row('/b', { som: true, seg_som: [0] }),
      row('/outra', { som: true, seg_som: [0] }),
    ]));
    const result = await request(`${workspace}?days=1&market=br&versions=a,quiz`);
    expect(result.statusCode).toBe(200);
    expect(result.headers['cache-control']).toBe('private, no-store');
    const body = result.json();
    expect(body).toMatchObject({ market: 'br', selected: ['a', 'quiz'] });
    expect(body.since).toBe(body.until);
    expect(body.versions.a).toMatchObject({ duration: 10, visits: 3, plays: 2, finish: 0.5, averageRetention: 0.65 });
    expect(body.versions.a.checkout).toEqual({ all: 1 / 3, played: 0.5, muted: 0, half: 1 });
    expect(body.versions.a.curve.slice(0, 4)).toEqual([1, 1, 1, 0.5]);
    expect(body.versions.a.milestones.find((m: { label: string }) => m.label === 'Fim')).toEqual({ label: 'Fim', second: 8, retention: 0.5 });
    expect(body.versions.a.creatives).toEqual([{ name: 'Criativo 1', visits: 3, plays: 2 / 3, retention: 0.65, checkout: 1 / 3 }]);
    expect(body.versions.quiz).toMatchObject({ visits: 1, plays: 1 });
    expect(body.versions.b).toMatchObject({ visits: 1 });
    expect(body.total).toMatchObject({ visits: 4, plays: 3 });

    const [url, init] = sourceFetch.mock.calls[0];
    expect(url.origin).toBe(source);
    expect(url.pathname).toBe('/rest/v1/vsl_views');
    expect(url.searchParams.get('video')).toBe('eq.mini-vsl-v1');
    expect(url.searchParams.get('criado_em')).toMatch(/^gte\.\d{4}-\d{2}-\d{2}T03:00:00\.000Z$/);
    expect(init).toMatchObject({ redirect: 'error', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    expect(result.body).not.toContain(serviceKey);
  });

  it('EUA usa a VSL em inglês, só a versão A e sem somado', async () => {
    sourceFetch.mockResolvedValueOnce(Response.json([]));
    const body = (await request(`${workspace}?market=us&versions=a,b`)).json();
    expect(Object.keys(body.versions)).toEqual(['a']);
    expect(body.versions.a).toMatchObject({ duration: 67, visits: 0, plays: 0, averageRetention: null, creatives: [] });
    expect(body.total).toBeNull();
    expect(sourceFetch.mock.calls[0][0].searchParams.get('video')).toBe('eq.mini-vsl-en');
  });

  it('período exato (aba Hotjar): lê do início do primeiro dia ao fim do último', async () => {
    sourceFetch.mockResolvedValueOnce(Response.json([]));
    const result = await request(`${workspace}?since=2026-11-20&until=2026-11-22&versions=quiz`);
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ since: '2026-11-20', until: '2026-11-22', selected: ['quiz'] });
    expect(sourceFetch.mock.calls[0][0].searchParams.getAll('criado_em')).toEqual([
      'gte.2026-11-20T03:00:00.000Z',
      'lt.2026-11-23T03:00:00.000Z',
    ]);
    expect((await request(`${workspace}?since=2026-11-22&until=2026-11-20`)).statusCode).toBe(400);
    expect((await request(`${workspace}?since=2026-11-22`)).statusCode).toBe(400);
  });

  it('pagina a leitura da fonte de 1000 em 1000', async () => {
    sourceFetch
      .mockResolvedValueOnce(Response.json(Array.from({ length: 1000 }, () => row('/'))))
      .mockResolvedValueOnce(Response.json([row('/b')]));
    const body = (await request(`${workspace}?days=30`)).json();
    expect(sourceFetch).toHaveBeenCalledTimes(2);
    expect(sourceFetch.mock.calls[1][0].searchParams.get('offset')).toBe('1000');
    expect(body.total.visits).toBe(1001);
  });

  it('trata configuração ausente e falha da fonte sem expor o corpo do erro', async () => {
    getConfig.mockImplementation((key) => key === 'VSL_SOURCE_SUPABASE_URL' ? '' : config[key]);
    expect((await request()).statusCode).toBe(503);
    expect(sourceFetch).not.toHaveBeenCalled();
    getConfig.mockImplementation((key) => config[key]);
    sourceFetch.mockResolvedValueOnce(new Response('detalhe privado', { status: 500 }));
    const result = await request();
    expect(result.statusCode).toBe(502);
    expect(result.body).not.toContain('detalhe privado');
  });
});
