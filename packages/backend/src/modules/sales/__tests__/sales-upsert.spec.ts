import { SalesService } from '../sales.service';
import { webhookContext, WebhookContext } from '../../../shared/helpers/webhook-context';

/**
 * upsertFromWebhook com pedidos não pagos gravados: o Pix gerado vira aprovado
 * quando pago (e o Purchase sai uma vez), nada rebaixa o que já foi pago e a
 * reentrega não grava de novo.
 */
type Row = { id: string; status: string; [k: string]: any };

function build(initial: Row[] = []) {
  const rows: Row[] = initial.map((r) => ({ ...r }));
  const inserts: any[] = [];
  const updates: { id: string; fields: any }[] = [];
  const matchSale = jest.fn().mockResolvedValue(undefined);
  const svc = new SalesService({} as any, { matchSale } as any);
  jest.spyOn(svc as any, 'findByExternalId').mockImplementation(async (sale: any) => {
    const row = rows.find((r) => r.external_id === sale.external_id);
    return row ? { id: row.id, status: row.status } : null;
  });
  jest.spyOn(svc as any, 'persist').mockImplementation(async (sale: any) => {
    inserts.push(sale);
    const row = { ...sale, id: `sale-${rows.length + 1}` };
    rows.push(row);
    return { id: row.id };
  });
  jest.spyOn(svc as any, 'update').mockImplementation(async (id: any, sale: any) => {
    updates.push({ id, fields: sale });
    Object.assign(rows.find((r) => r.id === id)!, sale);
  });
  return { svc, rows, inserts, updates, matchSale };
}

async function inWebhook<T>(fn: (ctx: WebhookContext) => Promise<T>): Promise<{ result: T; ctx: WebhookContext }> {
  const ctx: WebhookContext = { trackingRef: null, approvedSaleIds: [], notificationSaleIds: [] };
  const result = await webhookContext.run(ctx, () => fn(ctx));
  return { result, ctx };
}

const sale = (status: string, extra: Record<string, any> = {}) => ({
  user_id: 'u', workspace_id: 'ws', checkout_integration_id: 'int', external_id: 'PIX1', amount: 97, status, ...extra,
});

describe('SalesService.upsertFromWebhook', () => {
  it('Pix gerado e depois pago: grava pendente, vira aprovado e o Purchase sai uma vez', async () => {
    const { svc, rows, inserts, updates, matchSale } = build();

    const first = await inWebhook(() => svc.upsertFromWebhook(sale('pending', { sold_at: '2026-11-23T10:00:00Z' })));
    expect(first.result).toEqual({ id: 'sale-1', status: 'pending' });
    expect(first.ctx.approvedSaleIds).toEqual([]);
    expect(matchSale).not.toHaveBeenCalled();

    const paid = await inWebhook(() =>
      svc.upsertFromWebhook(sale('approved', { amount: 99, sold_at: '2026-11-23T10:05:00Z', utm_campaign: 'c', metadata: { status_raw: 'paid' } })),
    );
    expect(paid.result).toEqual({ id: 'sale-1', status: 'approved' });
    expect(paid.ctx.approvedSaleIds).toEqual(['sale-1']);
    expect(matchSale).toHaveBeenCalledWith('sale-1');
    expect(inserts).toHaveLength(1);
    expect(updates).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'approved', amount: 99, sold_at: '2026-11-23T10:05:00Z', utm_campaign: 'c' });

    // Reentrega do pago: nada a fazer, sem segundo Purchase.
    const again = await inWebhook(() => svc.upsertFromWebhook(sale('approved')));
    expect(again.result).toEqual({ id: 'sale-1', status: 'approved' });
    expect(again.ctx.approvedSaleIds).toEqual([]);
    expect(updates).toHaveLength(1);
    expect(inserts).toHaveLength(1);
  });

  it('cartão recusado e depois aprovado no mesmo pedido: vira aprovado com Purchase', async () => {
    const { svc } = build([{ id: 's1', external_id: 'PIX1', status: 'refused' }]);
    const { result, ctx } = await inWebhook(() => svc.upsertFromWebhook(sale('approved')));
    expect(result).toEqual({ id: 's1', status: 'approved' });
    expect(ctx.approvedSaleIds).toEqual(['s1']);
  });

  it('não rebaixa venda aprovada, reembolsada ou com chargeback', async () => {
    for (const status of ['approved', 'refunded', 'chargeback']) {
      const { svc, inserts, updates } = build([{ id: 's1', external_id: 'PIX1', status }]);
      for (const incoming of ['pending', 'refused']) {
        const { result, ctx } = await inWebhook(() => svc.upsertFromWebhook(sale(incoming)));
        expect(result).toEqual({ id: 's1', status });
        expect(ctx.approvedSaleIds).toEqual([]);
      }
      expect(inserts).toHaveLength(0);
      expect(updates).toHaveLength(0);
    }
  });

  it('pendente reentregue ou que vira recusado atualiza a mesma linha, sem insert duplicado', async () => {
    const { svc, rows, inserts, updates } = build();
    await inWebhook(() => svc.upsertFromWebhook(sale('pending')));
    await inWebhook(() => svc.upsertFromWebhook(sale('pending')));
    await inWebhook(() => svc.upsertFromWebhook(sale('refused')));
    expect(inserts).toHaveLength(1);
    expect(updates).toHaveLength(2);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('refused');
  });

  it('reembolso já gravado: a aprovada que chega depois é reentrega', async () => {
    const { svc, updates } = build([{ id: 's1', external_id: 'PIX1', status: 'refunded' }]);
    const { result, ctx } = await inWebhook(() => svc.upsertFromWebhook(sale('approved')));
    expect(result).toEqual({ id: 's1', status: 'refunded' });
    expect(ctx.approvedSaleIds).toEqual([]);
    expect(updates).toHaveLength(0);
  });

  it('aprovada nova: grava, casa com a visita e entra no Purchase', async () => {
    const { svc, matchSale } = build();
    const { result, ctx } = await inWebhook(() => svc.upsertFromWebhook(sale('approved')));
    expect(result).toEqual({ id: 'sale-1', status: 'approved' });
    expect(matchSale).toHaveBeenCalledWith('sale-1');
    expect(ctx.approvedSaleIds).toEqual(['sale-1']);
  });

  it('corrida: outra entrega grava a linha entre a busca e o insert — tenta de novo como atualização', async () => {
    const { svc, rows, updates } = build();
    const persist = jest.spyOn(svc as any, 'persist');
    persist.mockImplementationOnce(async (s: any) => {
      rows.push({ ...s, id: 'other', status: 'pending' });
      throw Object.assign(new Error('duplicate key'), { code: '23505' });
    });
    const { result, ctx } = await inWebhook(() => svc.upsertFromWebhook(sale('approved')));
    expect(result).toEqual({ id: 'other', status: 'approved' });
    expect(updates).toHaveLength(1);
    expect(ctx.approvedSaleIds).toEqual(['other']);
  });

  it('banco sem o status refused: a recusa não derruba o webhook', async () => {
    const { svc } = build();
    jest.spyOn(svc as any, 'persist').mockRejectedValueOnce(Object.assign(new Error('check'), { code: '23514' }));
    const { result } = await inWebhook(() => svc.upsertFromWebhook(sale('refused')));
    expect(result).toMatchObject({ id: null, skipped: 'refused_not_supported' });
  });

  it('busca a linha existente pelo painel, além do dono (índice único external_id + painel)', async () => {
    const calls: [string, any][] = [];
    const chain: any = {
      select: () => chain,
      eq: (col: string, val: any) => { calls.push([col, val]); return chain; },
      maybeSingle: async () => ({ data: null }),
    };
    const svc = new SalesService({ getClient: () => ({ from: () => chain }) } as any, { matchSale: jest.fn() } as any);
    await (svc as any).findByExternalId(sale('pending'));
    expect(calls).toEqual([['external_id', 'PIX1'], ['user_id', 'u'], ['workspace_id', 'ws']]);
  });
});
