import { createHash, randomBytes } from 'crypto';

/**
 * OAuth da Wiapy (docs/features/07-integrations/wiapy.md).
 *
 * A Wiapy não tem API REST pública: as vendas saem do servidor MCP dela, que
 * exige OAuth 2.1 com registro dinâmico de cliente (RFC 7591), PKCE S256 e
 * cliente público (token_endpoint_auth_method "none"). Tudo aqui é sem estado:
 * quem guarda client_id, verifier e tokens é o WiapyConnectionService.
 */

export const WIAPY_ISSUER = 'https://mcp.wiapy.com';
export const WIAPY_MCP_URL = `${WIAPY_ISSUER}/mcp`;
export const WIAPY_SCOPE = 'producer';
export const WIAPY_CALLBACK_PATH = '/api/integrations/wiapy/callback';
/**
 * A Wiapy só aceita redirect_uri de uma lista fixa (claude.ai, chatgpt.com e
 * localhost); o domínio do Dash.zip é recusado com invalid_redirect_uri. Por
 * isso o consentimento volta para este endereço local, que não abre nada, e o
 * operador cola o endereço dele no card. O código só serve com o verifier PKCE,
 * que fica cifrado no servidor.
 */
export const WIAPY_LOOPBACK_REDIRECT = 'http://localhost/dashzip-wiapy';

/** Lê state/code/iss/error do endereço colado (ou só da query). */
export function parsePastedCallback(text: string): { state?: string; code?: string; iss?: string; error?: string } {
  const raw = (text ?? '').trim().slice(0, 4096);
  const query = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : raw;
  const params = new URLSearchParams(query.split('#')[0]);
  const read = (key: string) => params.get(key)?.slice(0, 2048) || undefined;
  return { state: read('state'), code: read('code'), iss: read('iss'), error: read('error') };
}

const ENDPOINTS = {
  authorize: `${WIAPY_ISSUER}/oauth/authorize`,
  token: `${WIAPY_ISSUER}/oauth/token`,
  register: `${WIAPY_ISSUER}/oauth/register`,
  revoke: `${WIAPY_ISSUER}/oauth/revoke`,
};

export type FetchFn = typeof fetch;

export interface WiapyTokens {
  accessToken: string;
  /** Algumas renovações não trocam o refresh token: aí ele volta nulo e vale o anterior. */
  refreshToken: string | null;
  /** Quando o access token vence (ms desde a época). */
  expiresAt: number;
  scope: string | null;
}

/** Falha do servidor de autorização. `invalidGrant` = refresh token morto: precisa reconectar. */
export class WiapyOAuthError extends Error {
  constructor(message: string, readonly invalidGrant = false) {
    super(message);
  }
}

const base64url = (buffer: Buffer) => buffer.toString('base64url');

export function newState(): string {
  return base64url(randomBytes(32));
}

export function hashState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48));
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) };
}

/**
 * Origem do Dash.zip para montar o redirect. Só o painel (`APP_URL`) e o
 * localhost valem: qualquer outro host (preview da Vercel, header forjado) cai
 * no painel. Sem `APP_URL`, devolve '' e o redirect fica relativo ao mesmo host.
 */
export function appOrigin(host: string | undefined, appUrl: string | undefined = process.env.APP_URL): string {
  const name = (host ?? '').split(',')[0].trim().toLowerCase();
  if (/^(localhost|127\.0\.0\.1)(:\d{2,5})?$/.test(name)) return `http://${name}`;
  try {
    return appUrl ? new URL(appUrl).origin : '';
  } catch {
    return '';
  }
}

export function callbackUrl(origin: string): string {
  return `${origin}${WIAPY_CALLBACK_PATH}`;
}

/** Registro dinâmico: um client_id público por conexão. */
export async function registerClient(fetchFn: FetchFn, redirectUris: string[]): Promise<string> {
  const response = await fetchFn(ENDPOINTS.register, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'dash.zip',
      redirect_uris: [...new Set(redirectUris)],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: WIAPY_SCOPE,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => null)) as { client_id?: string; error_description?: string } | null;
  if (!response.ok || !body?.client_id) {
    throw new WiapyOAuthError(`A Wiapy recusou o registro do dash.zip (${body?.error_description ?? response.status}).`);
  }
  return body.client_id;
}

export function authorizeUrl(params: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const url = new URL(ENDPOINTS.authorize);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    scope: WIAPY_SCOPE,
    state: params.state,
    code_challenge: params.challenge,
    code_challenge_method: 'S256',
    resource: WIAPY_MCP_URL,
  }).toString();
  return url.toString();
}

async function tokenRequest(fetchFn: FetchFn, form: Record<string, string>, now: number): Promise<WiapyTokens> {
  const response = await fetchFn(ENDPOINTS.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ ...form, resource: WIAPY_MCP_URL }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => null)) as {
    access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string;
  } | null;
  if (!response.ok || !body?.access_token) {
    const invalid = body?.error === 'invalid_grant' || body?.error === 'invalid_client' || response.status === 401;
    // Só o código do erro: a descrição pode ecoar o token enviado.
    throw new WiapyOAuthError(`Token da Wiapy recusado (${body?.error ?? response.status}).`, invalid);
  }
  const seconds = Number(body.expires_in);
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    // Sem expires_in, assume 1 hora; renova 1 minuto antes.
    expiresAt: now + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000,
    scope: body.scope ?? null,
  };
}

export function exchangeCode(
  fetchFn: FetchFn,
  params: { clientId: string; code: string; redirectUri: string; verifier: string },
  now = Date.now(),
): Promise<WiapyTokens> {
  return tokenRequest(fetchFn, {
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    code_verifier: params.verifier,
  }, now);
}

export function refreshTokens(fetchFn: FetchFn, params: { clientId: string; refreshToken: string }, now = Date.now()): Promise<WiapyTokens> {
  return tokenRequest(fetchFn, { grant_type: 'refresh_token', refresh_token: params.refreshToken, client_id: params.clientId }, now);
}

/** Revogação é melhor esforço: desconectar no dash.zip vale mesmo se a Wiapy não responder. */
export async function revokeToken(fetchFn: FetchFn, params: { clientId: string; token: string }): Promise<boolean> {
  try {
    const response = await fetchFn(ENDPOINTS.revoke, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: params.token, token_type_hint: 'refresh_token', client_id: params.clientId }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
