import { CacheService } from '../../../shared/services/cache.service';
import { WiapyDisconnectedError } from '../wiapy-connection.service';
import { CLOSED_PERIOD_TTL_MS, OPEN_PERIOD_TTL_MS, pool, WIAPY_UNAVAILABLE, WiapySalesService } from '../wiapy-sales.service';
import { WiapyListSale } from '../wiapy-sales';

const WS = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const NOW = Date.parse('2026-11-23T15:00:00Z');

const item = (n: number, over: Partial<WiapyListSale> = {}): WiapyListSale => ({
  id: n.toString(16).padStart(24, '0'),
  date: '2026-11-20T15:00:00.000Z',
  status: 'paid',
  payment_method: 'pix',
  sale_amount: 47.9,
  received: 45.1,
  fee: 2.8,
  product: { id: 'p', title: 'Produto' },
  customer: { name: 'C', email: 'c@x.com', phone: null, document: null },
  ...over,
});

function setup(pages: WiapyListSale[][], opts: { productIds?: () => Promise<string[]> } = {}) {
  const calls: { name: string; args: any }[] = [];
  const connections = {
    productIds: jest.fn(opts.productIds ?? (async () => [])),
    callTool: jest.fn(async (_ws: string, name: string, args: any) => {
      calls.push({ name, args });
      if (name === 'my_sales_get') {
        return { origin: { utm_content: `Anúncio|${args.id_payment.slice(-6)}0000` } };
      }
      return { result: { sales: pages[args.page - 1] ?? [] }, pagination: { pages: pages.length } };
    }),
  };
  const supabase = {
    getClient: () => ({
      from: () => {
        const builder: any = {
          select: () => builder, eq: () => builder, order: () => builder,
          limit: async () => ({ data: [{ id: 'int-wiapy' }], error: null }),
        };
        return builder;
      },
    }),
  };
  const cache = new CacheService();
  const service = new WiapySalesService(connections as any, cache, supabase as any);
  service.now = () => NOW;
  return { service, connections, calls, cache };
}

describe('WiapySalesService.merge', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(NOW));
  afterEach(() => jest.restoreAllMocks());

  it('pagina até cobrir o período e une com o webhook sem duplicar', async () => {
    const pages = [[item(1), item(2)], [item(3), item(4, { date: '2026-10-01T12:00:00Z' })], [item(5, { status: 'unpaid' })]];
    const { service, calls } = setup(pages);
    const stored = [{ id: '600e5816-e119-460e-9aab-0b4f46c557d0', external_id: item(1).id, status: 'approved' }];
    const result = await service.merge(WS, '2026-11-17', '2026-11-23', 'America/Sao_Paulo', stored);

    expect(calls.filter((c) => c.name === 'my_sales_list').map((c) => c.args.page).sort()).toEqual([1, 2, 3]);
    expect(calls[0].args).toMatchObject({ period: 'range', date_start: '2026-11-16', date_end: '2026-11-23', limit: 100 });
    expect(result.source).toBe('wiapy');
    // item 4 foi criado fora do período (só mexeu dentro dele); item 1 é o do webhook.
    expect(result.rows.map((r) => r.external_id)).toEqual([item(1).id, item(2).id, item(3).id, item(5).id]);
    expect(result.rows[0].id).toBe('600e5816-e119-460e-9aab-0b4f46c557d0');
    expect((result.rows[1] as any).checkout_integration_id).toBe('int-wiapy');
    expect(result.warnings).toEqual([]);
  });

  it('guarda o período em memória: curto se inclui hoje, longo se já fechou', async () => {
    const { service, connections, cache } = setup([[item(1)]]);
    const set = jest.spyOn(cache, 'set');
    await service.merge(WS, '2026-11-17', '2026-11-23', 'America/Sao_Paulo', []);
    await service.merge(WS, '2026-11-17', '2026-11-23', 'America/Sao_Paulo', []);
    expect(connections.callTool).toHaveBeenCalledTimes(1);
    expect(set.mock.calls.find((c) => String(c[0]).includes(':period:2026-11-17'))?.[2]).toBe(OPEN_PERIOD_TTL_MS);

    await service.merge(WS, '2026-10-01', '2026-10-31', 'America/Sao_Paulo', []);
    expect(set.mock.calls.find((c) => String(c[0]).includes(':period:2026-10-01'))?.[2]).toBe(CLOSED_PERIOD_TTL_MS);
  });

  it('duas telas pedindo o mesmo período ao mesmo tempo fazem uma busca só', async () => {
    const { service, connections } = setup([[item(1)]]);
    await Promise.all([
      service.merge(WS, '2026-11-17', '2026-11-23', 'America/Sao_Paulo', []),
      service.merge(WS, '2026-11-17', '2026-11-23', 'America/Sao_Paulo', []),
    ]);
    expect(connections.callTool).toHaveBeenCalledTimes(1);
  });

  it('desconectada: devolve só o webhook, sem aviso', async () => {
    const { service, connections } = setup([], { productIds: async () => { throw new WiapyDisconnectedError(); } });
    const stored = [{ id: 'a', external_id: 'x', status: 'approved' }];
    const result = await service.merge(WS, '2026-11-17', '2026-11-23', 'America/Sao_Paulo', stored);
    expect(result).toEqual({ rows: stored, source: 'webhook', warnings: [] });
    expect(connections.callTool).not.toHaveBeenCalled();
  });

  it('Wiapy fora do ar: devolve o webhook com o aviso discreto, e não insiste a cada recarga', async () => {
    const { service, connections } = setup([]);
    connections.callTool.mockRejectedValue(new Error('A Wiapy respondeu 502.'));
    const stored = [{ id: 'a', external_id: 'x', status: 'approved' }];
    const first = await service.merge(WS, '2026-11-17', '2026-11-23', 'America/Sao_Paulo', stored);
    expect(first).toEqual({ rows: stored, source: 'webhook', warnings: [WIAPY_UNAVAILABLE] });
    await service.merge(WS, '2026-11-17', '2026-11-23', 'America/Sao_Paulo', stored);
    expect(connections.callTool).toHaveBeenCalledTimes(1);
  });

  it('Campanhas: busca a origem das vendas só da Wiapy, com cache, e filtra os status', async () => {
    const pages = [[item(1), item(2), item(3, { status: 'unpaid' })]];
    const { service, calls } = setup(pages);
    const stored = [{ id: '600e5816-e119-460e-9aab-0b4f46c557d0', external_id: item(1).id, status: 'approved' }];
    const options = { statuses: ['approved', 'refunded', 'chargeback'], origins: 'fetch' as const };
    const result = await service.merge(WS, '2026-11-17', '2026-11-23', 'America/Sao_Paulo', stored, options);

    // Só a venda 2: a 1 já tem o webhook e a 3 não foi paga.
    expect(calls.filter((c) => c.name === 'my_sales_get').map((c) => c.args.id_payment)).toEqual([item(2).id]);
    expect(result.rows.map((r) => r.external_id)).toEqual([item(1).id, item(2).id]);
    expect((result.rows[1] as any).utm_content).toBe(`Anúncio|${item(2).id.slice(-6)}0000`);

    await service.merge(WS, '2026-11-17', '2026-11-23', 'America/Sao_Paulo', stored, options);
    expect(calls.filter((c) => c.name === 'my_sales_get')).toHaveLength(1);
  });

  it('filtra pelos produtos vinculados ao painel quando existem', async () => {
    const { service, calls } = setup([[item(1)]], { productIds: async () => ['6ada273bd032443944dd343e'] });
    await service.merge(WS, '2026-11-17', '2026-11-23', 'America/Sao_Paulo', []);
    expect(calls[0].args.checkouts).toEqual(['6ada273bd032443944dd343e']);
  });
});

describe('pool', () => {
  it('respeita o limite de concorrência', async () => {
    let running = 0;
    let peak = 0;
    await pool(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 2));
      running--;
    });
    expect(peak).toBe(4);
  });
});
