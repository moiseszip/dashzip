import { FinanceSale, FinanceSettings, MediaTaxRule, mediaTotals, salesTotals, usdRateForDay } from '../finance-totals';

const wiapy = { id: 'w', platform: 'wiapy', use_commission_value: false };
const usdRule: MediaTaxRule = { id: 'legacy-usd', description: 'IOF', percent: 3.5, scope: 'currency', currency: 'USD', accountIds: [] };
const settings: FinanceSettings = {
  salesTaxPercent: 10, usdAdTaxPercent: 3.5, checkoutRules: [{ platform: 'wiapy', percent: 5, fixedBRL: 2 }],
  extraFees: [], productCosts: [], mediaTaxRules: [usdRule],
};
const exchange = (currency: string) => currency === 'BRL' ? 1 : currency === 'USD' ? 5 : null;
const line = (fields: Partial<FinanceSale> = {}): FinanceSale => ({
  id: 'a', external_id: 'ex', order_external_id: 'order', checkout_integration_id: 'w',
  amount: 100, currency: 'BRL', status: 'approved', sold_at: '2026-11-21T10:00:00.000Z', metadata: null, ...fields,
});

describe('Resultado do painel', () => {
  it('aplica a taxa fixa uma vez por pedido com bump e exclui pendentes e pedidos reembolsados', () => {
    const total = salesTotals([
      line(), line({ id: 'b', amount: 20 }),
      line({ id: 'r', order_external_id: 'refund', status: 'refunded' }),
      line({ id: 'p', order_external_id: 'pix', status: 'pending' }),
    ], [wiapy], settings, exchange);
    expect(total).toMatchObject({ approvedOrders: 1, grossBRL: 120, feesBRL: 8, checkoutNetBRL: 112, taxesBRL: 11.2, afterDeductionsBRL: 100.8 });
  });

  it('usa taxa efetiva do pedido e evita descontá-la de novo em outra linha ou valor já líquido', () => {
    const total = salesTotals([
      line({ metadata: { payment_fee: 4 } }), line({ id: 'b', amount: 20 }),
      line({ id: 'c', order_external_id: 'net', amount: 92, metadata: { amount_is_net: true, gross_amount: 100, payment_fee: 8 } }),
    ], [wiapy], settings, exchange);
    expect(total).toMatchObject({ approvedOrders: 2, grossBRL: 220, feesBRL: 12, checkoutNetBRL: 208, taxesBRL: 20.8, afterDeductionsBRL: 187.2 });
  });

  it('calcula imposto sobre o líquido mesmo quando o checkout só envia a comissão', () => {
    const sale = line({ amount: 92, metadata: { amount_is_net: true } });
    const total = salesTotals([sale], [wiapy], settings, exchange);
    expect(total).toMatchObject({ grossBRL: null, checkoutNetBRL: 92, taxesBRL: 9.2, afterDeductionsBRL: 82.8 });

    const grossTax = {
      ...settings, extraFees: [
        { id: 'iss', description: 'ISS', kind: 'tax' as const, paymentMethod: 'all' as const,
          platforms: ['wiapy'], base: 'gross' as const, percent: 5, fixedBRL: 0 },
      ],
    };
    expect(salesTotals([sale], [wiapy], grossTax, exchange)).toMatchObject({
      checkoutNetBRL: 92, taxesBRL: null, afterDeductionsBRL: null,
    });
  });

  it('preserva a moeda original e não totaliza um pedido sem cotação', () => {
    const total = salesTotals([line({ currency: 'EUR' })], [wiapy], settings, exchange);
    expect(total).toMatchObject({ recordedBRL: null, afterDeductionsBRL: null, unpricedOrders: 1, revenueByCurrency: [{ currency: 'EUR', amount: 100 }] });
  });

  it('estima mídia em BRL pela cotação diária e aplica a taxa somente em USD', () => {
    const quotes = new Map([['2026-11-20', 5], ['2026-11-23', 6]]);
    const account = { id: 'id', accountId: 'act_1', name: 'Conta', currency: 'USD', timezone: 'America/Sao_Paulo', active: true };
    const total = mediaTotals([
      { account, days: [
        { campaignId: 'c', campaignName: 'Campanha', day: '2026-11-21', spend: 20 },
        { campaignId: 'c', campaignName: 'Campanha', day: '2026-11-23', spend: 20 },
      ] },
      { account: { ...account, id: 'br', currency: 'BRL' }, days: [{ campaignId: 'x', campaignName: 'Outra', day: '2026-11-21', spend: 50 }] },
    ], (currency, day) => currency === 'BRL' ? 1 : usdRateForDay(quotes, day), [usdRule]);
    expect(total).toMatchObject({ spendBRL: 270, taxBRL: 7.7 });
    expect(mediaTotals([{ account, days: null }], exchange, [usdRule]).spendBRL).toBeNull();
  });
});
