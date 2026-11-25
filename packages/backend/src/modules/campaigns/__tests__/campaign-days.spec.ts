import { CampaignsService } from '../campaigns.service';

/** Query do Supabase que aceita qualquer encadeamento e devolve lista vazia. */
function emptyQuery(): any {
  const query: any = new Proxy(() => query, {
    get: (_target, prop) => (prop === 'then'
      ? (resolve: (value: unknown) => void) => resolve({ data: [], error: null })
      : () => query),
  });
  return query;
}

const settings = { salesTaxPercent: null, usdAdTaxPercent: null, checkoutRules: [], extraFees: [], mediaTaxRules: [], productCosts: [] };

describe('Acompanhamento de testes: vendas do período', () => {
  it('soma as vendas da Wiapy buscadas na hora, não só as gravadas pelo webhook', async () => {
    const liveSale = {
      id: 'wiapy:pedido-1', external_id: 'pedido-1', order_external_id: 'pedido-1', checkout_integration_id: 'ck', amount: 97,
      currency: 'BRL', status: 'approved', sold_at: '2026-11-20T15:00:00.000Z', metadata: null, payment_method: 'pix',
      product_name: 'Produto', utm_campaign: null, utm_medium: null, utm_content: null, ad_id: null,
    };
    const merge = jest.fn().mockResolvedValue({ rows: [liveSale], source: 'wiapy', warnings: ['aviso da Wiapy'] });
    const service = new CampaignsService(
      { getClient: () => ({ from: () => emptyQuery() }) } as any,
      {} as any, {} as any, {} as any, {} as any,
      { readSettings: jest.fn().mockResolvedValue(settings) } as any,
      { get: jest.fn().mockResolvedValue('America/Sao_Paulo') } as any,
      { merge } as any,
    );

    const result = await service.campaignDays('painel', { since: '2026-11-19', until: '2026-11-25' });

    expect(merge).toHaveBeenCalledWith('painel', '2026-11-19', '2026-11-25', 'America/Sao_Paulo', [],
      expect.objectContaining({ statuses: ['approved', 'refunded', 'chargeback'], origins: 'fetch' }));
    expect(result.untrackedSales.count).toBe(1);
    expect(result.warnings).toContain('aviso da Wiapy');
  });
});
