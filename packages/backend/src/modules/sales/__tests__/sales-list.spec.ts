import { buildOrders, dayRangeBounds, periodStart, SaleRow, summarize } from '../sales-list';

const row = (over: Partial<SaleRow> = {}): SaleRow => ({
  id: 's1',
  external_id: 'inv-1:offer-1',
  order_external_id: 'inv-1',
  amount: 27,
  currency: 'BRL',
  status: 'approved',
  payment_method: 'pix',
  product_name: 'Protocolo',
  is_order_bump: false,
  customer_name: 'Greice Rangel',
  customer_email: 'g@x.com',
  customer_phone: null,
  utm_source: 'FB',
  utm_medium: null,
  utm_campaign: 'cbo-kit|120',
  utm_content: 'ad-08|121',
  utm_term: null,
  ad_id: '121',
  session_id: null,
  match_method: null,
  checkout_integration_id: 'int-1',
  sold_at: '2026-11-08T16:01:09.416Z',
  ...over,
});

describe('buildOrders', () => {
  it('junta o principal e o order bump num pedido só', () => {
    const orders = buildOrders(
      [
        row({ id: 's2', external_id: 'inv-1:bump', product_name: 'Bump', amount: '9.90', is_order_bump: true, session_id: 'sess' }),
        row(),
      ],
      [{ sale_id: 's2', status: 'sent', error: null }],
      new Map([['int-1', 'hubla']]),
    );
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      id: 's1',
      orderId: 'inv-1',
      amount: 36.9,
      platform: 'hubla',
      matched: true,
      purchase: 'sent',
    });
    expect(orders[0].products.map((p) => p.name)).toEqual(['Protocolo', 'Bump']);
  });

  it('estorno em uma linha vale para o pedido', () => {
    const [o] = buildOrders([row(), row({ id: 's2', status: 'refunded' })], [], new Map());
    expect(o.status).toBe('refunded');
  });

  it('envio que falhou traz o erro; sem envio fica nulo', () => {
    const [failed] = buildOrders([row()], [{ sale_id: 's1', status: 'failed', error: 'token' }], new Map());
    expect(failed).toMatchObject({ purchase: 'failed', purchaseError: 'token' });
    const [none] = buildOrders([row()], [], new Map());
    expect(none.purchase).toBeNull();
  });

  it('mais recente primeiro; sem order_external_id cada linha é um pedido', () => {
    const orders = buildOrders(
      [
        row({ id: 'a', order_external_id: null, external_id: 'a', sold_at: '2026-11-01T00:00:00Z' }),
        row({ id: 'b', order_external_id: null, external_id: 'b', sold_at: '2026-11-05T00:00:00Z' }),
      ],
      [],
      new Map(),
    );
    expect(orders.map((o) => o.id)).toEqual(['b', 'a']);
  });
});

describe('summarize', () => {
  it('conta só aprovadas no faturamento', () => {
    const orders = buildOrders(
      [
        row({ id: 'a', order_external_id: 'a', session_id: 'x' }),
        row({ id: 'b', order_external_id: 'b', amount: 50 }),
        row({ id: 'c', order_external_id: 'c', status: 'refunded' }),
        row({ id: 'd', order_external_id: 'd', status: 'pending' }),
      ],
      [{ sale_id: 'a', status: 'sent', error: null }],
      new Map(),
    );
    expect(summarize(orders, 70.5)).toMatchObject({
      orders: 2, revenue: 77, netRevenue: 70.5, refunded: 1, pending: 1, pendingAmount: 27, matched: 1, purchaseSent: 1, currency: 'BRL',
    });
  });

  it('separa Pix e cartão com a taxa de aprovação (pago ÷ gerado)', () => {
    const orders = buildOrders(
      [
        row({ id: 'p1', order_external_id: 'p1' }),
        row({ id: 'p2', order_external_id: 'p2', status: 'pending' }),
        row({ id: 'p3', order_external_id: 'p3', status: 'refunded' }),
        row({ id: 'p4', order_external_id: 'p4', status: 'pending' }),
        row({ id: 'c1', order_external_id: 'c1', payment_method: 'credit_card', amount: 97 }),
        row({ id: 'c2', order_external_id: 'c2', payment_method: 'Cartão de crédito', status: 'refused' }),
        row({ id: 'b1', order_external_id: 'b1', payment_method: 'boleto' }),
      ],
      [],
      new Map(),
    );
    const summary = summarize(orders);
    expect(summary.pix).toEqual({ approved: 1, approvedAmount: 27, generated: 4, approvalRate: 0.5 });
    expect(summary.card).toEqual({ approved: 1, approvedAmount: 97, generated: 2, approvalRate: 0.5 });
    expect(summary.netRevenue).toBeNull();
    expect(summarize([]).pix.approvalRate).toBeNull();
  });
});

describe('dayRangeBounds', () => {
  it('converte dias de São Paulo em limites UTC com fim exclusivo', () => {
    expect(dayRangeBounds('2026-11-01', '2026-11-07')).toEqual({ from: '2026-11-01T03:00:00.000Z', to: '2026-11-08T03:00:00.000Z' });
    expect(dayRangeBounds('2026-11-22', '2026-11-22')).toEqual({ from: '2026-11-22T03:00:00.000Z', to: '2026-11-23T03:00:00.000Z' });
  });

  it('recusa intervalo invertido ou maior que 92 dias', () => {
    expect(dayRangeBounds('2026-11-08', '2026-11-01')).toBeNull();
    expect(dayRangeBounds('2026-01-01', '2026-11-01')).toBeNull();
  });
});

describe('periodStart', () => {
  it('hoje começa à meia-noite de Brasília', () => {
    const now = Date.parse('2026-11-08T16:00:00Z');
    expect(periodStart('today', now)).toBe('2026-11-08T03:00:00.000Z');
    // 01:00 UTC ainda é dia 7 em Brasília
    expect(periodStart('today', Date.parse('2026-11-08T01:00:00Z'))).toBe('2026-11-07T03:00:00.000Z');
  });

  it('7 dias atrás', () => {
    expect(periodStart('7', Date.parse('2026-11-08T00:00:00Z'))).toBe('2026-11-01T00:00:00.000Z');
  });
});
