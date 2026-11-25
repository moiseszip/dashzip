import { FetchFn, WIAPY_MCP_URL } from './wiapy-oauth';

/**
 * Cliente JSON-RPC enxuto do servidor MCP da Wiapy (transporte HTTP streamable).
 *
 * Por que não o SDK oficial: ele é ESM e traz servidor, transportes e zod que
 * o dash.zip não usa; aqui só cabem três mensagens (initialize,
 * notifications/initialized e tools/call). A resposta pode vir em JSON puro ou
 * em SSE (text/event-stream) — as duas são lidas.
 */

const PROTOCOL_VERSION = '2025-06-18';
const TIMEOUT_MS = 20_000;

export class WiapyMcpError extends Error {
  /** `auth`: o access token foi recusado (renove e tente de novo). */
  constructor(message: string, readonly kind: 'auth' | 'http' | 'tool' | 'protocol') {
    super(message);
  }
}

interface Session {
  id: string | null;
  protocolVersion: string;
}

interface RpcResponse {
  id?: number | string;
  result?: any;
  error?: { code?: number; message?: string };
}

/** Lê a resposta JSON-RPC de id `id`, venha ela em JSON ou em eventos SSE. */
export async function readRpc(response: Response, id: number): Promise<RpcResponse> {
  const type = response.headers.get('content-type') ?? '';
  const text = await response.text();
  if (type.includes('text/event-stream')) {
    let found: RpcResponse | null = null;
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
      if (!data) continue;
      try {
        const message = JSON.parse(data) as RpcResponse | RpcResponse[];
        for (const item of Array.isArray(message) ? message : [message]) if (item?.id === id) found = item;
      } catch {
        // evento que não é JSON-RPC (ping): ignora
      }
    }
    if (!found) throw new WiapyMcpError('Resposta da Wiapy sem resultado.', 'protocol');
    return found;
  }
  try {
    const message = JSON.parse(text) as RpcResponse | RpcResponse[];
    const item = Array.isArray(message) ? message.find((m) => m?.id === id) : message;
    if (!item) throw new Error('sem id');
    return item;
  } catch {
    throw new WiapyMcpError('Resposta da Wiapy ilegível.', 'protocol');
  }
}

/** O conteúdo de um tools/call: structuredContent, ou o JSON do primeiro bloco de texto. */
export function toolPayload(result: any): unknown {
  if (result?.isError) {
    const text = (result.content ?? []).find((c: any) => c?.type === 'text')?.text;
    throw new WiapyMcpError(`A Wiapy recusou a consulta${text ? `: ${String(text).slice(0, 200)}` : '.'}`, 'tool');
  }
  if (result?.structuredContent !== undefined) return result.structuredContent;
  const text = (result?.content ?? []).find((c: any) => c?.type === 'text')?.text;
  if (typeof text !== 'string') throw new WiapyMcpError('Resposta da Wiapy sem conteúdo.', 'protocol');
  try {
    return JSON.parse(text);
  } catch {
    throw new WiapyMcpError('Resposta da Wiapy ilegível.', 'protocol');
  }
}

export class WiapyMcpClient {
  private nextId = 1;
  /** Sessão MCP por access token: as chamadas em paralelo de um carregamento reaproveitam a mesma. */
  private readonly sessions = new Map<string, Promise<Session>>();

  constructor(private readonly fetchFn: FetchFn = fetch, private readonly url = WIAPY_MCP_URL) {}

  async callTool(accessToken: string, name: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      return await this.callOnce(accessToken, name, args);
    } catch (error) {
      // Sessão expirada no servidor: abre outra e tenta uma vez.
      if (error instanceof WiapyMcpError && error.message === 'session') {
        this.sessions.delete(accessToken);
        return this.callOnce(accessToken, name, args);
      }
      throw error;
    }
  }

  forget(accessToken: string) {
    this.sessions.delete(accessToken);
  }

  private async callOnce(accessToken: string, name: string, args: Record<string, unknown>) {
    const session = await this.session(accessToken);
    const id = this.nextId++;
    const response = await this.post(accessToken, session, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
    if (response.status === 404 && session.id) throw new WiapyMcpError('session', 'protocol');
    this.assertOk(response);
    const message = await readRpc(response, id);
    if (message.error) throw new WiapyMcpError(`Erro da Wiapy: ${message.error.message ?? message.error.code}`, 'tool');
    return toolPayload(message.result);
  }

  private session(accessToken: string): Promise<Session> {
    let pending = this.sessions.get(accessToken);
    if (!pending) {
      pending = this.initialize(accessToken);
      this.sessions.set(accessToken, pending);
      // Falha não fica guardada: a próxima chamada tenta de novo.
      pending.catch(() => this.sessions.delete(accessToken));
      // Não deixa o mapa crescer sem limite numa instância quente.
      if (this.sessions.size > 50) this.sessions.delete(this.sessions.keys().next().value as string);
    }
    return pending;
  }

  private async initialize(accessToken: string): Promise<Session> {
    const id = this.nextId++;
    const response = await this.post(accessToken, null, {
      jsonrpc: '2.0', id, method: 'initialize',
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'dash.zip', version: '1.0.0' } },
    });
    this.assertOk(response);
    const sessionId = response.headers.get('mcp-session-id');
    const message = await readRpc(response, id);
    if (message.error) throw new WiapyMcpError(`A Wiapy recusou a conexão: ${message.error.message ?? message.error.code}`, 'protocol');
    const session: Session = { id: sessionId, protocolVersion: message.result?.protocolVersion ?? PROTOCOL_VERSION };
    const ack = await this.post(accessToken, session, { jsonrpc: '2.0', method: 'notifications/initialized' });
    await ack.text().catch(() => undefined);
    return session;
  }

  private post(accessToken: string, session: Session | null, body: unknown) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (session) headers['MCP-Protocol-Version'] = session.protocolVersion;
    if (session?.id) headers['Mcp-Session-Id'] = session.id;
    return this.fetchFn(this.url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) })
      .catch((error: Error) => {
        throw new WiapyMcpError(error?.name === 'TimeoutError' ? 'A Wiapy demorou demais para responder.' : 'Sem conexão com a Wiapy.', 'http');
      });
  }

  private assertOk(response: Response) {
    if (response.status === 401 || response.status === 403) throw new WiapyMcpError('Acesso à Wiapy recusado.', 'auth');
    if (!response.ok) throw new WiapyMcpError(`A Wiapy respondeu ${response.status}.`, 'http');
  }
}
