import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../../shared/services/cache.service';
import { SupabaseService } from '../../shared/services/supabase.service';
import { dayInTimezone } from '../../shared/helpers/timezone';
import { WiapyConnectionService, WiapyDisconnectedError } from './wiapy-connection.service';
import {
  inPeriod, listWindow, LiveSaleRow, mergeSales, parseListPage, parseOrigin, toSaleRow, WiapyListSale, WiapyOrigin,
} from './wiapy-sales';

/** Itens por página (máximo da Wiapy). */
const PAGE_SIZE = 100;
/** Teto de páginas por período: 6.000 movimentações. Passando disso, avisa que cortou. */
const MAX_PAGES = 60;
const PAGE_CONCURRENCY = 4;
/** Cache do período: curto se inclui hoje, longo se já fechou. */
export const OPEN_PERIOD_TTL_MS = 2 * 60_000;
export const CLOSED_PERIOD_TTL_MS = 30 * 60_000;
/** Falha também fica guardada um pouco, para a tela não esperar a Wiapy a cada recarga. */
const FAILURE_TTL_MS = 30_000;
/** Origem (UTMs) de uma venda não muda: fica 12 horas. */
const ORIGIN_TTL_MS = 12 * 60 * 60_000;
const DETAIL_CONCURRENCY = 8;
/** Detalhes buscados por carregamento de Campanhas; o resto vem nas próximas recargas (cache). */
const MAX_DETAILS_PER_LOAD = 300;
const DETAILS_BUDGET_MS = 25_000;

export const WIAPY_UNAVAILABLE = 'Faturamento da Wiapy indisponível agora: mostrando só as vendas recebidas por webhook.';

interface PeriodResult {
  sales: WiapyListSale[];
  truncated: boolean;
}

export interface LiveMergeOptions {
  /** Só estes status (depois da união). */
  statuses?: string[];
  /** Busca a origem (UTMs) das vendas que só a Wiapy conhece, para atribuir a anúncios. */
  origins?: 'fetch' | 'cached';
}

export interface LiveMergeResult<T> {
  rows: T[];
  /** wiapy: o período veio da Wiapy (unido ao webhook); webhook: só o banco. */
  source: 'wiapy' | 'webhook';
  warnings: string[];
}

/** Executa `tasks` com no máximo `limit` ao mesmo tempo. */
export async function pool<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await task(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Vendas da Wiapy de um período, buscadas na hora (com cache em memória) e
 * unidas às do webhook. Nunca grava: a decisão é não guardar histórico
 * (docs/features/07-integrations/wiapy.md).
 */
@Injectable()
export class WiapySalesService {
  private readonly logger = new Logger('WiapySales');
  /** Busca em andamento por chave: duas telas pedindo o mesmo período esperam a mesma. */
  private readonly inflight = new Map<string, Promise<PeriodResult>>();
  now = () => Date.now();

  constructor(
    private readonly connections: WiapyConnectionService,
    private readonly cache: CacheService,
    private readonly supabase: SupabaseService,
  ) {}

  /**
   * As linhas do banco `stored` unidas às da Wiapy no período. Sem conexão,
   * devolve `stored` como veio; com a Wiapy fora do ar, também, e um aviso.
   */
  async merge<T extends { id: string; external_id: string | null; status: string | null }>(
    workspaceId: string, since: string, until: string, timeZone: string, stored: T[], options: LiveMergeOptions = {},
  ): Promise<LiveMergeResult<T>> {
    const warnings: string[] = [];
    let period: PeriodResult;
    try {
      period = await this.period(workspaceId, since, until, timeZone);
    } catch (error) {
      if (error instanceof WiapyDisconnectedError) return { rows: stored, source: 'webhook', warnings };
      this.logger.warn(`Wiapy indisponível para o painel ${workspaceId}: ${(error as Error)?.message ?? error}`);
      return { rows: stored, source: 'webhook', warnings: [WIAPY_UNAVAILABLE] };
    }
    if (period.truncated) warnings.push('Período com vendas demais na Wiapy: parte delas ficou de fora. Escolha um intervalo menor.');

    const checkoutId = await this.checkoutId(workspaceId);
    const known = new Set(stored.map((row) => row.external_id).filter(Boolean));
    const origins = new Map<string, WiapyOrigin>();
    const counted = new Set(['approved', 'refunded', 'chargeback']);
    const needOrigin = period.sales.filter((sale) => !known.has(sale.id));
    if (options.origins) {
      const missing = await this.origins(workspaceId, needOrigin.filter((sale) => counted.has(toSaleRow(sale, null).status ?? '')), origins, options.origins === 'fetch');
      if (missing > 0 && options.origins === 'fetch') {
        warnings.push(`Origem de ${missing} ${missing === 1 ? 'venda da Wiapy ainda não carregou' : 'vendas da Wiapy ainda não carregou'}: elas aparecem como não rastreadas até a próxima atualização.`);
      }
    }
    const live = period.sales.map((sale) => toSaleRow(sale, checkoutId, origins.get(sale.id)));
    let rows = mergeSales(stored, live);
    if (options.statuses) {
      const keep = new Set(options.statuses);
      rows = rows.filter((row) => keep.has(row.status ?? ''));
    }
    return { rows, source: 'wiapy', warnings };
  }

  /** O período na Wiapy: cache, depois busca (uma por vez por chave). */
  private async period(workspaceId: string, since: string, until: string, timeZone: string): Promise<PeriodResult> {
    const productIds = await this.connections.productIds(workspaceId);
    const key = `wiapy:${workspaceId}:period:${since}:${until}:${timeZone}`;
    const cached = this.cache.get<PeriodResult | { failed: true }>(key);
    if (cached && 'failed' in cached) throw new Error('falha recente (em cache)');
    if (cached) return cached;
    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.fetchPeriod(workspaceId, since, until, timeZone, productIds)
        .then((result) => {
          const today = dayInTimezone(new Date(this.now()), timeZone);
          this.cache.set(key, result, until >= today ? OPEN_PERIOD_TTL_MS : CLOSED_PERIOD_TTL_MS);
          return result;
        })
        .catch((error) => {
          if (!(error instanceof WiapyDisconnectedError)) this.cache.set(key, { failed: true }, FAILURE_TTL_MS);
          throw error;
        })
        .finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    return pending;
  }

  /** Pagina my_sales_list na janela da movimentação e fica com as vendas criadas no período. */
  private async fetchPeriod(workspaceId: string, since: string, until: string, timeZone: string, productIds: string[]): Promise<PeriodResult> {
    const today = dayInTimezone(new Date(this.now()), 'America/Sao_Paulo');
    const { dateStart, dateEnd } = listWindow(since, until, today);
    const args = (page: number) => ({
      period: 'range', date_start: dateStart, date_end: dateEnd, limit: PAGE_SIZE, page,
      ...(productIds.length ? { checkouts: productIds } : {}),
    });
    const first = parseListPage(await this.connections.callTool(workspaceId, 'my_sales_list', args(1)));
    const pages = Math.min(first.pages, MAX_PAGES);
    const byId = new Map<string, WiapyListSale>();
    const add = (list: WiapyListSale[]) => {
      for (const sale of list) if (inPeriod(sale, since, until, timeZone)) byId.set(sale.id, sale);
    };
    add(first.sales);
    const rest = Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i + 2);
    await pool(rest, PAGE_CONCURRENCY, async (page) => {
      add(parseListPage(await this.connections.callTool(workspaceId, 'my_sales_list', args(page))).sales);
    });
    return { sales: [...byId.values()], truncated: first.pages > MAX_PAGES };
  }

  /**
   * Origem (UTMs) das vendas, por my_sales_get, com concorrência limitada e
   * cache de 12 horas. Devolve quantas ficaram sem origem por limite/tempo.
   */
  private async origins(workspaceId: string, sales: WiapyListSale[], into: Map<string, WiapyOrigin>, fetchMissing: boolean): Promise<number> {
    const missing: WiapyListSale[] = [];
    for (const sale of sales) {
      const cached = this.cache.get<WiapyOrigin>(`wiapy:${workspaceId}:origin:${sale.id}`);
      if (cached) into.set(sale.id, cached);
      else missing.push(sale);
    }
    if (!fetchMissing || !missing.length) return 0;
    const started = this.now();
    const batch = missing.slice(0, MAX_DETAILS_PER_LOAD);
    let failed = 0;
    await pool(batch, DETAIL_CONCURRENCY, async (sale) => {
      if (this.now() - started > DETAILS_BUDGET_MS) { failed++; return; }
      try {
        const origin = parseOrigin(await this.connections.callTool(workspaceId, 'my_sales_get', { id_payment: sale.id }));
        this.cache.set(`wiapy:${workspaceId}:origin:${sale.id}`, origin, ORIGIN_TTL_MS);
        into.set(sale.id, origin);
      } catch {
        failed++;
      }
    });
    return failed + (missing.length - batch.length);
  }

  /** A integração Wiapy do painel (webhook), para as linhas da Wiapy usarem a mesma taxa e a mesma chave de pedido. */
  private async checkoutId(workspaceId: string): Promise<string | null> {
    const key = `wiapy:${workspaceId}:checkout`;
    const cached = this.cache.get<{ id: string | null }>(key);
    if (cached) return cached.id;
    const { data } = await this.supabase.getClient().from('checkout_integrations').select('id')
      .eq('workspace_id', workspaceId).eq('platform', 'wiapy').order('created_at').limit(1);
    const id = (data?.[0]?.id as string | undefined) ?? null;
    this.cache.set(key, { id }, 5 * 60_000);
    return id;
  }
}

export type { LiveSaleRow };
