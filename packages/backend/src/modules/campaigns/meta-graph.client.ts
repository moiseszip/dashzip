import { Injectable } from '@nestjs/common';
import { GRAPH_API_URL } from '../../shared/constants/meta-api';

/**
 * Cliente mínimo da Graph API para a tela de Campanhas: leitura paginada e
 * escrita em objetos de anúncio, com os erros da Meta traduzidos em códigos
 * estáveis que a tela entende (docs/features/22-campaigns/campaigns.md).
 */

export type MetaErrorCode =
  | 'TOKEN_INVALID' | 'MISSING_PERMISSION' | 'ACCOUNT_RESTRICTED' | 'RATE_LIMITED'
  | 'LOW_BUDGET' | 'HIGH_BUDGET' | 'META_REJECTED' | 'META_UNAVAILABLE';

export class MetaGraphError extends Error {
  constructor(readonly code: MetaErrorCode, message: string, readonly status?: number) {
    super(message);
  }
}

interface GraphErrorBody {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
  };
}

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80014]);

/** Traduz a resposta de erro da Meta. Exportada para teste. */
export function classifyMetaError(status: number, body: GraphErrorBody | null): MetaGraphError {
  const error = body?.error;
  const code = error?.code;
  const text = error?.error_user_msg || error?.message || `HTTP ${status}`;
  if (status >= 500 && code === undefined) return new MetaGraphError('META_UNAVAILABLE', 'A Meta não respondeu.', status);
  if (code === 190 || code === 102) return new MetaGraphError('TOKEN_INVALID', 'O token da conta expirou ou foi revogado.', status);
  if (code !== undefined && RATE_LIMIT_CODES.has(code)) {
    return new MetaGraphError('RATE_LIMITED', 'A Meta limitou as chamadas desta conta. Tente de novo em alguns minutos.', status);
  }
  if (code === 10 || (code !== undefined && code >= 200 && code <= 299)) {
    return new MetaGraphError('MISSING_PERMISSION', 'O token não tem permissão para esta conta ou ação (ads_read/ads_management).', status);
  }
  if (code === 368 || code === 2635 || /account.*(disabled|restricted|desativada|restrit)/i.test(text)) {
    return new MetaGraphError('ACCOUNT_RESTRICTED', text, status);
  }
  if (/budget/i.test(text) || /orçamento/i.test(text)) {
    if (/(too low|minimum|at least|mínimo|baixo)/i.test(text)) return new MetaGraphError('LOW_BUDGET', text, status);
    if (/(too high|maximum|exceed|máximo|alto)/i.test(text)) return new MetaGraphError('HIGH_BUDGET', text, status);
  }
  if (status >= 500) return new MetaGraphError('META_UNAVAILABLE', text, status);
  return new MetaGraphError('META_REJECTED', text, status);
}

interface Page<T> { data?: T[]; paging?: { next?: string; cursors?: { after?: string } } }

@Injectable()
export class MetaGraphClient {
  async get<T>(path: string, token: string, params: Record<string, string> = {}, timeoutMs = 15_000): Promise<T> {
    return this.request<T>('GET', path, token, params, timeoutMs);
  }

  async post<T>(path: string, token: string, params: Record<string, string>): Promise<T> {
    return this.request<T>('POST', path, token, params, 15_000);
  }

  /** Lê todas as páginas, até `maxPages`. Passou disso, lança TOO_MANY_PAGES. */
  async getAll<T>(path: string, token: string, params: Record<string, string>, maxPages = 20): Promise<T[]> {
    const rows: T[] = [];
    let after: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const result = await this.get<Page<T>>(path, token, { limit: '500', ...params, ...(after ? { after } : {}) });
      if (!Array.isArray(result.data)) throw new MetaGraphError('META_UNAVAILABLE', 'Resposta inválida da Meta.');
      rows.push(...result.data);
      if (!result.paging?.next) return rows;
      const next = result.paging.cursors?.after;
      if (!next || next === after) return rows;
      after = next;
    }
    throw new MetaGraphError('META_REJECTED', 'A Meta devolveu dados demais para este período. Reduza o intervalo ou filtre por campanha.');
  }

  private async request<T>(method: 'GET' | 'POST', path: string, token: string, params: Record<string, string>, timeoutMs: number) {
    if (!/^\/?[A-Za-z0-9_]+(\/[a-z_]+)?$/.test(path)) throw new MetaGraphError('META_REJECTED', 'Caminho inválido para a Meta.');
    const url = `${GRAPH_API_URL}/${path.replace(/^\//, '')}`;
    let response: Response;
    try {
      response = method === 'GET'
        ? await fetch(`${url}?${new URLSearchParams(params)}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs),
        })
        : await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(params),
          signal: AbortSignal.timeout(timeoutMs),
        });
    } catch {
      throw new MetaGraphError('META_UNAVAILABLE', 'A Meta não respondeu a tempo.');
    }
    const body = await response.json().catch(() => null) as (T & GraphErrorBody) | null;
    if (!response.ok || body?.error) throw classifyMetaError(response.status, body);
    if (body === null) throw new MetaGraphError('META_UNAVAILABLE', 'Resposta vazia da Meta.');
    return body as T;
  }
}
