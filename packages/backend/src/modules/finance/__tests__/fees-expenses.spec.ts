import { expenseOccurrences, sumOccurrences, Expense } from '../expenses';
import {
  FinanceSale, FinanceSettings, mediaTaxPercentFor, normalizePaymentMethod, parseSettingsRow, salesTotals,
} from '../finance-totals';

const wiapy = { id: 'w', platform: 'wiapy', use_commission_value: false };
const base: FinanceSettings = {
  salesTaxPercent: null, usdAdTaxPercent: null, checkoutRules: [], extraFees: [], mediaTaxRules: [], productCosts: [],
};
const brl = () => 1;
const line = (fields: Partial<FinanceSale> = {}): FinanceSale => ({
  id: 'a', external_id: 'ex', order_external_id: 'order', checkout_integration_id: 'w', amount: 100, currency: 'BRL',
  status: 'approved', sold_at: '2026-11-21T10:00:00.000Z', metadata: { payment_fee: 5 }, payment_method: 'PIX',
  product_name: 'Guia A', ...fields,
});

describe('Taxas extras', () => {
  it('aplica imposto sobre o bruto e taxa sobre o líquido, uma vez por pedido, pelo meio de pagamento', () => {
    const settings: FinanceSettings = {
      ...base,
      extraFees: [
        { id: 'iss', description: 'ISS', kind: 'tax', paymentMethod: 'all', platforms: [], base: 'gross', percent: 5, fixedBRL: 0 },
        { id: 'pix', description: 'Antecipação Pix', kind: 'fee', paymentMethod: 'pix', platforms: ['wiapy'], base: 'net', percent: 2, fixedBRL: 0.3 },
        { id: 'card', description: 'Só cartão', kind: 'fee', paymentMethod: 'credit_card', platforms: [], base: 'gross', percent: 10, fixedBRL: 0 },
      ],
    };
    const total = salesTotals([line(), line({ id: 'b', amount: 20, metadata: null })], [wiapy], settings, brl);
    // bruto 120; taxa do checkout 5; ISS 6; Pix 2% de 115 + 0,30 = 2,60; cartão não entra
    expect(total).toMatchObject({ grossBRL: 120, taxesBRL: 6, feesBRL: 7.6, afterDeductionsBRL: 120 - 5 - 2.6 - 6 });
  });

  it('respeita o filtro de plataforma', () => {
    const settings: FinanceSettings = {
      ...base,
      extraFees: [{ id: 'x', description: 'Só Hotmart', kind: 'fee', paymentMethod: 'all', platforms: ['hotmart'], base: 'gross', percent: 10, fixedBRL: 0 }],
    };
    expect(salesTotals([line()], [wiapy], settings, brl).feesBRL).toBe(5);
  });

  it('desconta o custo de cada produto do pedido, sem diferenciar maiúsculas', () => {
    const settings: FinanceSettings = { ...base, productCosts: [{ id: 'p', productName: 'guia a ', costBRL: 12, group: null }] };
    const total = salesTotals([line(), line({ id: 'b', product_name: 'Bump', amount: 20, metadata: null })], [wiapy], settings, brl);
    expect(total).toMatchObject({ productCostsBRL: 12, afterDeductionsBRL: 120 - 5 - 12 });
  });
});

describe('Meio de pagamento', () => {
  it('normaliza os textos das plataformas', () => {
    expect(normalizePaymentMethod('PIX')).toBe('pix');
    expect(normalizePaymentMethod('credit_card')).toBe('credit_card');
    expect(normalizePaymentMethod('Cartão de crédito')).toBe('credit_card');
    expect(normalizePaymentMethod('BOLETO')).toBe('boleto');
    expect(normalizePaymentMethod('paypal')).toBe('other');
    expect(normalizePaymentMethod('unknown')).toBeNull();
    expect(normalizePaymentMethod(null)).toBeNull();
  });
});

describe('Custo sobre mídia', () => {
  const rules = [
    { id: 'usd', description: 'IOF', percent: 3.5, scope: 'currency' as const, currency: 'USD', accountIds: [] },
    { id: 'ca2', description: 'Extra conta 2', percent: 1, scope: 'accounts' as const, currency: null, accountIds: ['act_222'] },
    { id: 'all', description: 'Agência', percent: 0.5, scope: 'all' as const, currency: null, accountIds: [] },
  ];
  it('soma as regras que valem para a conta', () => {
    expect(mediaTaxPercentFor({ accountId: 'act_222', currency: 'USD' }, rules)).toBe(5);
    expect(mediaTaxPercentFor({ accountId: '333', currency: 'BRL' }, rules)).toBe(0.5);
  });

  it('a coluna antiga vira a regra legacy-usd só quando não há regras', () => {
    expect(parseSettingsRow({ usd_ad_tax_percent: '3.5' }).mediaTaxRules).toEqual([
      expect.objectContaining({ id: 'legacy-usd', percent: 3.5, scope: 'currency', currency: 'USD' }),
    ]);
    expect(parseSettingsRow({ usd_ad_tax_percent: 3.5, media_tax_rules: [rules[2]] }).mediaTaxRules).toEqual([rules[2]]);
    expect(parseSettingsRow(null)).toMatchObject({ mediaTaxRules: [], extraFees: [], productCosts: [], salesTaxPercent: null });
  });
});

describe('Despesas', () => {
  const expenses: Expense[] = [
    { id: '1', description: 'Contador', category: 'accounting', amountBRL: 300, kind: 'recurring', date: null, startDate: '2026-09-15', endDate: null, recurringDay: 10 },
    { id: '2', description: 'Editor', category: 'team', amountBRL: 150, kind: 'single', date: '2026-11-05', startDate: null, endDate: null, recurringDay: null },
    { id: '3', description: 'Ferramenta', category: 'tools', amountBRL: 50, kind: 'recurring', date: null, startDate: '2026-01-01', endDate: '2026-10-31', recurringDay: 1 },
  ];

  it('expande as recorrentes dentro do período e respeita início e fim', () => {
    const items = expenseOccurrences(expenses, '2026-09-01', '2026-11-30');
    expect(items.map((item) => `${item.date} ${item.description}`)).toEqual([
      '2026-09-01 Ferramenta', '2026-10-01 Ferramenta', '2026-10-10 Contador', '2026-11-05 Editor', '2026-11-10 Contador',
    ]);
    expect(sumOccurrences(items)).toBe(850);
  });

  it('período sem ocorrência devolve vazio', () => {
    expect(expenseOccurrences(expenses, '2026-11-11', '2026-11-20')).toEqual([]);
  });
});
