import { AsyncLocalStorage } from 'async_hooks';

/**
 * O rastro de uma requisição no servidor, no formato do preview do GTM
 * Server: o que chegou (request), quem a reivindicou (client), o que se
 * extraiu dela (variáveis), as tags que dispararam ou não, as chamadas HTTP
 * que saíram e o console.
 *
 * Vive num AsyncLocalStorage, como o webhookContext: o controller abre, e
 * qualquer serviço no caminho (CAPI, vendas, logger) escreve nele sem receber
 * parâmetro. Fora do preview o rastro é montado e descartado — custa só
 * objetos em memória.
 */

export type TagStatus = 'fired' | 'failed' | 'not_fired';

export interface DebugTag {
  name: string;
  status: TagStatus;
  detail?: string | null;
  /** Índice da chamada HTTP que a tag fez, em `http`. */
  httpIndex?: number;
}

export interface DebugHttpCall {
  method: string;
  url: string;
  requestBody: unknown;
  status: number | null;
  responseBody: unknown;
  durationMs: number;
  error?: string | null;
}

/** Uma gravação no banco feita durante a requisição: o que foi escrito e o que voltou. */
export interface DebugDbWrite {
  table: string;
  operation: 'insert' | 'upsert' | 'update' | 'rpc';
  data: unknown;
  result: unknown;
  error?: string | null;
  durationMs: number;
}

export interface DebugLogLine {
  level: 'log' | 'warn' | 'error' | 'debug';
  message: string;
  context?: string | null;
  /** Milissegundos desde o início da requisição. */
  at: number;
}

export interface DebugRequest {
  method: string;
  path: string;
  query: Record<string, unknown>;
  headers: Record<string, unknown>;
  body: unknown;
}

export interface DebugTraceData {
  client: string;
  request: DebugRequest;
  response: { status: number; body: unknown } | null;
  events: string[];
  variables: Record<string, unknown>;
  tags: DebugTag[];
  http: DebugHttpCall[];
  db: DebugDbWrite[];
  logs: DebugLogLine[];
  durationMs: number;
}

/** Headers que nunca vão para o painel, nem mascarados. */
const HIDDEN_HEADERS = new Set(['cookie', 'authorization', 'proxy-authorization']);
/** Chaves de query/corpo cujo valor é segredo: mostra só o começo. */
const SECRET_KEYS = /^(token|access_token|signature|hottok|secret|webhook_?secret|x-hotmart-hottok|api_key|apikey)$/i;

export function mask(value: unknown): unknown {
  if (typeof value !== 'string' || value.length === 0) return value;
  return value.length <= 6 ? '••••' : `${value.slice(0, 4)}••••`;
}

export function sanitizeHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (HIDDEN_HEADERS.has(key.toLowerCase())) continue;
    out[key] = SECRET_KEYS.test(key) || /token|signature|secret/i.test(key) ? mask(value) : value;
  }
  return out;
}

export function sanitizeQuery(query: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query ?? {})) {
    out[key] = SECRET_KEYS.test(key) ? mask(value) : value;
  }
  return out;
}

/** Corpo grande demais vira um aviso: o painel não precisa de 1 MB de JSON. */
const MAX_BODY_CHARS = 60_000;

export function limitBody(body: unknown): unknown {
  try {
    const json = typeof body === 'string' ? body : JSON.stringify(body);
    if (json && json.length > MAX_BODY_CHARS) {
      return { _truncado: true, tamanho: json.length, inicio: json.slice(0, 2000) };
    }
  } catch {
    return '[corpo ilegível]';
  }
  return body;
}

export class DebugTrace {
  readonly startedAt = Date.now();
  workspaceId: string | null = null;
  /** Token do preview vindo do navegador que está em modo debug. */
  browserToken: string | null = null;
  title: string;
  private readonly data: Omit<DebugTraceData, 'durationMs'>;

  constructor(
    readonly kind: 'collect' | 'webhook',
    client: string,
    request: DebugRequest,
  ) {
    this.title = client;
    this.data = {
      client,
      request: {
        ...request,
        headers: sanitizeHeaders(request.headers),
        query: sanitizeQuery(request.query),
        body: limitBody(request.body),
      },
      response: null,
      events: [],
      variables: {},
      tags: [],
      http: [],
      db: [],
      logs: [],
    };
  }

  /** O primeiro workspace conhecido vale: é a área dona da requisição. */
  setWorkspace(id: string | null | undefined): void {
    if (id && !this.workspaceId) this.workspaceId = id;
  }

  event(name: string): void {
    if (!this.data.events.includes(name)) this.data.events.push(name);
  }

  variable(name: string, value: unknown): void {
    this.data.variables[name] = value;
  }

  tag(tag: DebugTag): void {
    this.data.tags.push(tag);
  }

  http(call: DebugHttpCall): number {
    this.data.http.push({ ...call, requestBody: limitBody(call.requestBody), responseBody: limitBody(call.responseBody) });
    return this.data.http.length - 1;
  }

  db(write: DebugDbWrite): void {
    if (this.data.db.length >= 50) return;
    this.data.db.push({ ...write, data: limitBody(write.data), result: limitBody(write.result) });
  }

  log(message: string, level: DebugLogLine['level'] = 'log', context?: string | null): void {
    if (this.data.logs.length >= 300) return;
    this.data.logs.push({ level, message: message.slice(0, 4000), context: context ?? null, at: Date.now() - this.startedAt });
  }

  respond(status: number, body: unknown): void {
    this.data.response = { status, body: limitBody(body) };
  }

  /** ok / warning / error, para a cor na lista do painel. */
  get status(): 'ok' | 'warning' | 'error' {
    const status = this.data.response?.status ?? 200;
    if (status >= 500 || this.data.tags.some((t) => t.status === 'failed') || this.data.db.some((w) => w.error)) return 'error';
    if (status >= 400 || this.data.logs.some((l) => l.level === 'error')) return 'error';
    if (this.data.logs.some((l) => l.level === 'warn')) return 'warning';
    return 'ok';
  }

  get events(): string[] {
    return this.data.events;
  }

  toJSON(): DebugTraceData {
    return { ...this.data, durationMs: Date.now() - this.startedAt };
  }
}

export const debugContext = new AsyncLocalStorage<DebugTrace>();

/**
 * Roda uma gravação e, no preview, registra no rastro o que foi escrito e o
 * que o banco devolveu. Fora do preview é só a gravação.
 */
export async function traced<T extends { data?: unknown; error?: { message: string } | null }>(
  table: string,
  operation: DebugDbWrite['operation'],
  data: unknown,
  run: () => PromiseLike<T>,
): Promise<T> {
  const trace = debugContext.getStore();
  const started = Date.now();
  const res = await run();
  trace?.db({ table, operation, data, result: res.data ?? null, error: res.error?.message ?? null, durationMs: Date.now() - started });
  return res;
}
