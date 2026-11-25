import { CacheService } from '../../../shared/services/cache.service';
import { EncryptionService } from '../../../shared/services/encryption.service';
import { WiapyConnectionService, WiapyDisconnectedError } from '../wiapy-connection.service';
import { readRpc, toolPayload } from '../wiapy-mcp.client';
import { appOrigin, authorizeUrl, hashState, parsePastedCallback, pkcePair } from '../wiapy-oauth';
import { createHash } from 'crypto';

const WS = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

/** Tabelas em memória com as cadeias do supabase-js que o serviço usa. */
function fakeDb() {
  const tables: Record<string, Record<string, any>[]> = { wiapy_connections: [], wiapy_oauth_states: [] };
  const from = (name: string) => {
    const filters: ((row: any) => boolean)[] = [];
    let action: { kind: 'select' | 'update' | 'delete' | 'insert' | 'upsert'; value?: any } = { kind: 'select' };
    let returning = false;
    const run = () => {
      const table = tables[name] ?? (tables[name] = []);
      const hit = table.filter((row) => filters.every((f) => f(row)));
      if (action.kind === 'insert') table.push({ ...action.value });
      if (action.kind === 'upsert') {
        const index = table.findIndex((row) => row.workspace_id === action.value.workspace_id);
        if (index >= 0) table[index] = { ...table[index], ...action.value };
        else table.push({ ...action.value });
      }
      if (action.kind === 'update') hit.forEach((row) => Object.assign(row, action.value));
      if (action.kind === 'delete') tables[name] = table.filter((row) => !hit.includes(row));
      return { data: action.kind === 'select' || returning ? hit : null, error: null };
    };
    const builder: any = {
      select: () => { if (action.kind !== 'select') returning = true; return builder; },
      eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return builder; },
      lt: (column: string, value: string) => { filters.push((row) => row[column] < value); return builder; },
      update: (value: any) => { action = { kind: 'update', value }; return builder; },
      delete: () => { action = { kind: 'delete' }; return builder; },
      insert: (value: any) => { action = { kind: 'insert', value }; return builder; },
      upsert: (value: any) => { action = { kind: 'upsert', value }; return builder; },
      maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: null }; },
      then: (resolve: any, reject: any) => Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  };
  return { tables, client: { from } };
}

function setup() {
  const db = fakeDb();
  const supabase = { getClient: () => db.client };
  const encryption = new EncryptionService({ get: () => 'chave-de-teste', getOrThrow: () => 'x' } as any);
  const service = new WiapyConnectionService(supabase as any, encryption, new CacheService());
  const requests: { url: string; body: string }[] = [];
  const responses: Record<string, (body: string) => Response> = {};
  service.fetchFn = (async (input: any, init: any) => {
    const url = String(input);
    requests.push({ url, body: String(init?.body ?? '') });
    const handler = Object.entries(responses).find(([prefix]) => url.startsWith(prefix))?.[1];
    if (!handler) throw new Error(`sem resposta para ${url}`);
    return handler(String(init?.body ?? ''));
  }) as any;
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  return { db, encryption, service, requests, responses, json };
}

function connected(env: ReturnType<typeof setup>, over: Record<string, unknown> = {}) {
  env.db.tables.wiapy_connections.push({
    workspace_id: WS, user_id: 'u1',
    client_id_enc: env.encryption.encrypt('client-123'),
    refresh_token_enc: env.encryption.encrypt('refresh-old'),
    access_token_enc: env.encryption.encrypt('access-old'),
    access_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    account_name: 'Operador', product_ids: [], status: 'connected', connected_at: '2026-11-23T00:00:00Z',
    ...over,
  });
}

/** Servidor MCP falso: initialize, initialized e tools/call. */
function mcp(env: ReturnType<typeof setup>, onCall: (token: string) => Response | null = () => null) {
  env.responses['https://mcp.wiapy.com/mcp'] = (body) => {
    const message = JSON.parse(body);
    if (message.method === 'initialize') {
      return env.json(200, { jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18' } }, { 'mcp-session-id': 'sess-1' });
    }
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
    return env.json(200, { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] } });
  };
  const original = env.service.fetchFn;
  env.service.fetchFn = (async (input: any, init: any) => {
    const auth = (init?.headers as Record<string, string>)?.Authorization ?? '';
    const custom = String(input).startsWith('https://mcp.wiapy.com/mcp') ? onCall(auth.replace('Bearer ', '')) : null;
    return custom ?? original(input, init);
  }) as any;
}

describe('OAuth da Wiapy', () => {
  it('monta o consentimento com PKCE S256, state e o recurso MCP', () => {
    const { verifier, challenge } = pkcePair();
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    const url = new URL(authorizeUrl({ clientId: 'c1', redirectUri: 'https://painel.exemplo.com.br/api/integrations/wiapy/callback', state: 's1', challenge }));
    expect(url.origin + url.pathname).toBe('https://mcp.wiapy.com/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code', client_id: 'c1', scope: 'producer', state: 's1', code_challenge: challenge, code_challenge_method: 'S256',
      resource: 'https://mcp.wiapy.com/mcp',
    });
  });

  it('só aceita o painel (APP_URL) e o localhost como origem do callback', () => {
    const app = 'https://painel.exemplo.com.br/';
    expect(appOrigin('painel.exemplo.com.br', app)).toBe('https://painel.exemplo.com.br');
    expect(appOrigin('localhost:5173', app)).toBe('http://localhost:5173');
    expect(appOrigin('evil.example.com', app)).toBe('https://painel.exemplo.com.br');
    expect(appOrigin('projeto-git-x.vercel.app', app)).toBe('https://painel.exemplo.com.br');
    expect(appOrigin('evil.example.com', undefined)).toBe('');
  });

  it('conectar registra o dash.zip e guarda o state cifrado, de uso único', async () => {
    const env = setup();
    env.responses['https://mcp.wiapy.com/oauth/register'] = () => env.json(201, { client_id: 'client-new' });
    const { url } = await env.service.start('u1', WS);
    const register = JSON.parse(env.requests[0].body);
    expect(register).toMatchObject({ client_name: 'dash.zip', token_endpoint_auth_method: 'none' });
    // A Wiapy só aceita redirect de uma lista fixa: o retorno vai para o localhost e o endereço é colado no card.
    expect(register.redirect_uris).toEqual(['http://localhost/dashzip-wiapy']);
    expect(new URL(url).searchParams.get('redirect_uri')).toBe('http://localhost/dashzip-wiapy');
    const state = new URL(url).searchParams.get('state')!;
    const row = env.db.tables.wiapy_oauth_states[0];
    expect(row.state_hash).toBe(hashState(state));
    expect(row.code_verifier_enc).not.toContain(state);
    expect(env.encryption.decrypt(row.client_id_enc)).toBe('client-new');

    env.responses['https://mcp.wiapy.com/oauth/token'] = () => env.json(200, { access_token: 'acc-1', refresh_token: 'ref-1', expires_in: 3600 });
    mcp(env);
    const pasted = parsePastedCallback(`http://localhost/dashzip-wiapy?code=code-1&state=${state}&iss=https%3A%2F%2Fmcp.wiapy.com`);
    expect(pasted).toEqual({ code: 'code-1', state, iss: 'https://mcp.wiapy.com', error: undefined });
    await expect(env.service.complete(pasted, { userId: 'u1', workspaceId: WS })).resolves.toEqual({ workspaceId: WS });
    const tokenForm = new URLSearchParams(env.requests.find((r) => r.url.endsWith('/oauth/token'))!.body);
    expect(tokenForm.get('grant_type')).toBe('authorization_code');
    expect(tokenForm.get('code_verifier')).toBeTruthy();
    const saved = env.db.tables.wiapy_connections[0];
    expect(saved.refresh_token_enc).not.toContain('ref-1');
    expect(env.encryption.decrypt(saved.refresh_token_enc)).toBe('ref-1');

    // O mesmo state não serve duas vezes.
    await expect(env.service.complete({ state, code: 'code-1' })).rejects.toThrow(/já usado/);
  });

  it('status nunca expõe token', async () => {
    const env = setup();
    connected(env);
    const status = await env.service.status(WS);
    expect(status).toEqual({ connected: true, needsReconnect: false, accountName: 'Operador', connectedAt: '2026-11-23T00:00:00Z' });
    expect(JSON.stringify(status)).not.toMatch(/access|refresh|client/);
  });
});

describe('renovação do token', () => {
  it('access token vencido: renova pelo refresh token e guarda o novo (rotativo)', async () => {
    const env = setup();
    connected(env, { access_expires_at: new Date(Date.now() - 1000).toISOString() });
    env.responses['https://mcp.wiapy.com/oauth/token'] = () => env.json(200, { access_token: 'access-new', refresh_token: 'refresh-new', expires_in: 3600 });
    const tokens: string[] = [];
    mcp(env, (token) => { tokens.push(token); return null; });

    await env.service.callTool(WS, 'my_sales_list', { period: 'today' });
    const form = new URLSearchParams(env.requests.find((r) => r.url.endsWith('/oauth/token'))!.body);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('refresh-old');
    expect(new Set(tokens)).toEqual(new Set(['access-new']));
    const row = env.db.tables.wiapy_connections[0];
    expect(env.encryption.decrypt(row.refresh_token_enc)).toBe('refresh-new');
  });

  it('chamadas paralelas com token vencido renovam uma vez só', async () => {
    const env = setup();
    connected(env, { access_expires_at: new Date(Date.now() - 1000).toISOString() });
    env.responses['https://mcp.wiapy.com/oauth/token'] = () => env.json(200, { access_token: 'access-new', expires_in: 3600 });
    mcp(env);
    await Promise.all([1, 2, 3].map(() => env.service.callTool(WS, 'my_sales_list', {})));
    expect(env.requests.filter((r) => r.url.endsWith('/oauth/token'))).toHaveLength(1);
  });

  it('token recusado pelo MCP (401): renova e tenta de novo uma vez', async () => {
    const env = setup();
    connected(env);
    env.responses['https://mcp.wiapy.com/oauth/token'] = () => env.json(200, { access_token: 'access-new', expires_in: 3600 });
    mcp(env, (token) => (token === 'access-old' ? new Response('{}', { status: 401 }) : null));
    await expect(env.service.callTool(WS, 'my_sales_list', {})).resolves.toEqual({ ok: true });
  });

  it('refresh token recusado: marca para reconectar e trata como desconectada', async () => {
    const env = setup();
    connected(env, { access_expires_at: null });
    env.responses['https://mcp.wiapy.com/oauth/token'] = () => env.json(400, { error: 'invalid_grant' });
    await expect(env.service.callTool(WS, 'my_sales_list', {})).rejects.toBeInstanceOf(WiapyDisconnectedError);
    expect(env.db.tables.wiapy_connections[0].status).toBe('reauth');
    expect(await env.service.status(WS)).toMatchObject({ connected: false, needsReconnect: true });
  });

  it('sem conexão: WiapyDisconnectedError, sem tocar na rede', async () => {
    const env = setup();
    await expect(env.service.productIds(WS)).rejects.toBeInstanceOf(WiapyDisconnectedError);
    expect(env.requests).toHaveLength(0);
  });

  it('desconectar revoga o refresh token na Wiapy e apaga a conexão', async () => {
    const env = setup();
    connected(env);
    env.responses['https://mcp.wiapy.com/oauth/revoke'] = () => new Response(null, { status: 200 });
    await env.service.disconnect(WS);
    const form = new URLSearchParams(env.requests[0].body);
    expect(env.requests[0].url).toBe('https://mcp.wiapy.com/oauth/revoke');
    expect(form.get('token')).toBe('refresh-old');
    expect(env.db.tables.wiapy_connections).toHaveLength(0);
  });
});

describe('cliente MCP', () => {
  it('lê a resposta em SSE e em JSON', async () => {
    const sse = new Response('event: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":1}}\n\n', { headers: { 'content-type': 'text/event-stream' } });
    expect((await readRpc(sse, 7)).result).toEqual({ ok: 1 });
    const json = new Response('{"jsonrpc":"2.0","id":3,"result":{"ok":2}}', { headers: { 'content-type': 'application/json' } });
    expect((await readRpc(json, 3)).result).toEqual({ ok: 2 });
  });

  it('prefere structuredContent e transforma isError em erro', () => {
    expect(toolPayload({ structuredContent: { a: 1 }, content: [] })).toEqual({ a: 1 });
    expect(toolPayload({ content: [{ type: 'text', text: '{"b":2}' }] })).toEqual({ b: 2 });
    expect(() => toolPayload({ isError: true, content: [{ type: 'text', text: 'sem acesso' }] })).toThrow(/sem acesso/);
  });
});

describe('endereço colado', () => {
  it('state de outro usuário ou painel é recusado', async () => {
    const env = setup();
    env.responses['https://mcp.wiapy.com/oauth/register'] = () => env.json(201, { client_id: 'c' });
    const { url } = await env.service.start('u1', WS);
    const state = new URL(url).searchParams.get('state')!;
    await expect(env.service.complete({ state, code: 'x' }, { userId: 'u2', workspaceId: WS })).rejects.toThrow(/outra conexão/);
  });

  it('aceita só a query ou o endereço completo e ignora o fragmento', () => {
    expect(parsePastedCallback('code=a&state=b')).toMatchObject({ code: 'a', state: 'b' });
    expect(parsePastedCallback('  http://localhost/dashzip-wiapy?error=access_denied&state=b#x ')).toMatchObject({ error: 'access_denied', state: 'b' });
    expect(parsePastedCallback('lixo')).toEqual({ state: undefined, code: undefined, iss: undefined, error: undefined });
  });
});
