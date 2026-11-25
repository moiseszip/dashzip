import { inPeriod, listWindow, mapStatus, mergeSales, parseListPage, parseOrigin, storedIds, toSaleRow, WiapyListSale } from '../wiapy-sales';

/** Formato real de my_sales_list (conferido no MCP da Wiapy em 23/11/2026). */
const sale = (over: Partial<WiapyListSale> = {}): WiapyListSale => ({
  id: '6afcefa28926e29dd8c9d328',
  date: '2026-11-18T00:21:54.104Z',
  last_update: '2026-11-18T00:22:30.847Z',
  status: 'paid',
  payment_method: 'pix',
  received: 45.1,
  sale_amount: 47.9,
  fee: 2.8,
  product: { id: '6ada273bd032443944dd343e', title: 'Produto Exemplo - Completo' },
  orderbumps: [],
  customer: { name: 'Cliente Teste', email: 'Cliente@Example.com', phone: '(47) 99999-0000', document: '000.000.000-00' },
  ...over,
});

describe('toSaleRow', () => {
  it('mapeia uma venda paga da Wiapy para uma linha de sales', () => {
    const row = toSaleRow(sale(), 'int-wiapy');
    expect(row).toMatchObject({
      id: 'wiapy-6afcefa28926e29dd8c9d328',
      external_id: '6afcefa28926e29dd8c9d328',
      checkout_integration_id: 'int-wiapy',
      amount: 47.9,
      currency: 'BRL',
      status: 'approved',
      sold_at: '2026-11-18T00:21:54.104Z',
      payment_method: 'pix',
      product_name: 'Produto Exemplo - Completo',
      customer_email: 'cliente@example.com',
      utm_content: null,
      session_id: null,
      source: 'wiapy',
    });
    // Mesma conta do webhook: bruto (sale_amount) menos a taxa Wiapy (fee) = received.
    expect(row.metadata).toMatchObject({ gross_amount: 47.9, payment_fee: 2.8, amount_is_net: false, received: 45.1 });
  });

  it('usa a origem (UTMs) do my_sales_get quando veio', () => {
    const origin = parseOrigin({
      origin: {
        utm_source: 'FB', utm_medium: 'CJ 01|52600763586905', utm_campaign: '[BR] CBO|52600763570505',
        utm_term: 'Instagram_Reels', utm_content: '[08/11] Motion 02|52600763708305', state: 'Santa Catarina', country: 'Brazil',
      },
    });
    const row = toSaleRow(sale(), null, origin);
    expect(row).toMatchObject({ utm_content: '[08/11] Motion 02|52600763708305', utm_medium: 'CJ 01|52600763586905', customer_state: 'Santa Catarina' });
  });

  it('traduz os status e manda o resto para recusado', () => {
    expect(mapStatus('paid')).toBe('approved');
    expect(mapStatus('unpaid')).toBe('pending');
    expect(mapStatus('refunded')).toBe('refunded');
    expect(mapStatus('chargedback')).toBe('chargeback');
    expect(mapStatus('refused')).toBe('refused');
    expect(mapStatus('expired')).toBe('refused');
    expect(mapStatus(null)).toBe('refused');
  });

  it('venda antiga sem fee não inventa taxa', () => {
    expect(toSaleRow(sale({ fee: null }), null).metadata).not.toHaveProperty('payment_fee');
  });
});

describe('parseListPage', () => {
  it('lê result.sales e pagination.pages', () => {
    const page = parseListPage({ result: { sales: [sale(), { id: 'x' }] }, pagination: { pages: 12, count: 36, current: 1, limit: 3 } });
    expect(page.pages).toBe(12);
    expect(page.sales).toHaveLength(1); // item sem data é descartado
  });

  it('formato inesperado vira erro (a tela cai no aviso, não em zero)', () => {
    expect(() => parseListPage({ foo: 1 })).toThrow();
  });
});

describe('janela e período', () => {
  it('pede da véspera de since até 31 dias depois de until, sem passar de hoje', () => {
    expect(listWindow('2026-10-01', '2026-10-31', '2026-11-23')).toEqual({ dateStart: '2026-09-30', dateEnd: '2026-11-23' });
    expect(listWindow('2026-08-01', '2026-08-31', '2026-11-23')).toEqual({ dateStart: '2026-07-31', dateEnd: '2026-10-01' });
  });

  it('filtra pela data de criação no fuso do painel, não pela movimentação', () => {
    // 00:21 UTC do dia 18 = 21:21 do dia 17 em São Paulo.
    expect(inPeriod(sale(), '2026-11-17', '2026-11-17', 'America/Sao_Paulo')).toBe(true);
    expect(inPeriod(sale(), '2026-11-18', '2026-11-18', 'America/Sao_Paulo')).toBe(false);
  });
});

describe('mergeSales', () => {
  const stored = (over: Record<string, unknown> = {}) => ({
    id: '600e5816-e119-460e-9aab-0b4f46c557d0',
    external_id: '6afcefa28926e29dd8c9d328',
    order_external_id: null,
    status: 'approved',
    product_name: 'Produto Exemplo',
    utm_content: 'arch-render',
    utm_medium: null as string | null,
    session_id: 'sess-1',
    metadata: { gross_amount: 47.9 } as Record<string, unknown>,
    ...over,
  });

  it('não conta duas vezes: a venda do webhook manda e a da Wiapy completa o que falta', () => {
    const live = [
      toSaleRow(sale(), 'int', parseOrigin({ origin: { utm_content: 'outro|1', utm_medium: 'CJ|52600763586905' } })),
      toSaleRow(sale({ id: '6b017d30f6f34fd109853ab4', status: 'unpaid' }), 'int'),
    ];
    const merged = mergeSales([stored()], live);
    expect(merged).toHaveLength(2);
    const [webhook, onlyWiapy] = merged as any[];
    expect(webhook.id).toBe('600e5816-e119-460e-9aab-0b4f46c557d0');
    expect(webhook.product_name).toBe('Produto Exemplo');
    expect(webhook.utm_content).toBe('arch-render'); // atribuição do webhook mantida
    expect(webhook.utm_medium).toBe('CJ|52600763586905'); // campo vazio completado
    expect(webhook.session_id).toBe('sess-1');
    expect(webhook.metadata.payment_fee).toBe(2.8);
    expect(onlyWiapy).toMatchObject({ external_id: '6b017d30f6f34fd109853ab4', status: 'pending', source: 'wiapy' });
  });

  it('avança o status quando a venda andou na Wiapy, nunca volta', () => {
    expect(mergeSales([stored({ status: 'pending' })], [toSaleRow(sale(), null)])[0].status).toBe('approved');
    expect(mergeSales([stored()], [toSaleRow(sale({ status: 'refunded' }), null)])[0].status).toBe('refunded');
    expect(mergeSales([stored({ status: 'refunded' })], [toSaleRow(sale({ status: 'paid' }), null)])[0].status).toBe('refunded');
  });

  it('linhas de outros checkouts seguem intactas', () => {
    const other = stored({ id: 'b1d0c3d4-0000-4000-8000-000000000000', external_id: 'hubla-1' });
    expect(mergeSales([other], [])).toEqual([other]);
  });
});

describe('storedIds', () => {
  it('só passa uuid adiante (as consultas por sale_id quebram com wiapy-<id>)', () => {
    expect(storedIds(['600e5816-e119-460e-9aab-0b4f46c557d0', 'wiapy-6afcefa28926e29dd8c9d328'])).toEqual(['600e5816-e119-460e-9aab-0b4f46c557d0']);
  });
});
