import { FinanceSettings } from '../../finance/finance-totals';
import { campaignColumnsError } from '../preferences.service';
import { normalizeCountry, normalizeState } from '../geo';
import {
  approvalMethod, approvalRates, buildSummary, CARD_CATALOG, CHART_CATALOG, cleanSource, cleanTerm, DEFAULT_LAYOUT, funnelSteps, geoBreakdown, layoutError, MediaInput, migrateLayout,
  previousPeriod, SummaryLayoutV1, SummarySale, toLayoutV2,
} from '../summary-metrics';

const settings: FinanceSettings = {
  salesTaxPercent: 10, usdAdTaxPercent: null, checkoutRules: [], extraFees: [], mediaTaxRules: [], productCosts: [],
};
const checkouts = [{ id: 'w', platform: 'wiapy', use_commission_value: false }];
const brl = (currency: string) => (currency === 'BRL' ? 1 : null);

const sale = (fields: Partial<SummarySale> = {}): SummarySale => ({
  id: 's1', external_id: 'e1', order_external_id: 'o1', checkout_integration_id: 'w', amount: 100, currency: 'BRL',
  status: 'approved', sold_at: '2026-11-21T12:30:00.000Z', metadata: { payment_fee: 5 }, payment_method: 'pix',
  product_name: 'Guia', customer_country: 'BR', utm_source: 'FBjLj6b0abc', utm_term: 'stl_abc', ...fields,
});

const media: MediaInput = {
  spend: 50, mediaTax: 2, impressions: 10_000, clicks: 200, landingPageViews: 150, initiateCheckouts: 20,
  spendByHour: Array.from({ length: 24 }, (_, hour) => (hour === 9 ? 50 : 0)),
  spendByDay: new Map([['2026-11-21', 50]]),
};

describe('Resumo', () => {
  const sales = [
    sale(),
    sale({ id: 's2', order_external_id: 'o2', amount: 60, payment_method: 'credit_card', sold_at: '2026-11-21T20:00:00.000Z', metadata: null, utm_source: 'google' }),
    sale({ id: 's3', order_external_id: 'o3', status: 'pending', amount: 40 }),
    sale({ id: 's4', order_external_id: 'o4', status: 'refunded', amount: 30 }),
  ];
  const result = buildSummary({
    sales, sessions: new Map([['s1', { utm_source: 'FB', utm_term: 'Instagram_Reels' }]]), checkouts, settings,
    exchangeRate: brl, media, expensesBRL: 10, tracking: { sessions: 400, checkoutClicks: 40, matchedSales: 1 },
  });
  const card = (key: string) => result.cards.find((c) => c.key === key)?.value;

  it('cards de faturamento, lucro e taxas', () => {
    // Bruto 160, taxa 5, líquido 155 e imposto de 15,50. Lucro de 87,50 após mídia e IOF.
    expect(card('grossRevenue')).toBe(160);
    expect(card('netRevenue')).toBe(155);
    expect(card('taxes')).toBe(15.5);
    expect(card('profit')).toBe(87.5);
    expect(card('roas')).toBeCloseTo(3.2);
    expect(card('roi')).toBeCloseTo(139.5 / 52);
    expect(card('margin')).toBeCloseTo(87.5 / 155);
    expect(card('sales')).toBe(2);
    expect(card('avgTicket')).toBe(80);
    expect(card('expenses')).toBe(10);
  });

  it('ROI usa somente imposto da venda no numerador, e lucro inclui CMV e IOF', () => {
    const input = buildSummary({
      sales: [sale()], sessions: new Map(), checkouts,
      settings: {
        ...settings,
        productCosts: [{ id: 'guide', productName: 'Guia', costBRL: 20, group: null }],
      },
      exchangeRate: brl, media, expensesBRL: 10,
      tracking: { sessions: 0, checkoutClicks: 0, matchedSales: 0 },
    });
    const values = Object.fromEntries(input.cards.map(({ key, value }) => [key, value]));
    expect(values).toMatchObject({ netRevenue: 95, taxes: 9.5, productCosts: 20, profit: 13.5, expenses: 10 });
    expect(values.roi).toBeCloseTo(85.5 / 52);
    expect(values.margin).toBeCloseTo(13.5 / 95);
  });

  it('reconcilia os cards a partir de uma venda, do custo de produto e da mídia', () => {
    const input = {
      sales: [sale({ amount: 1100, metadata: { payment_fee: 100 } })],
      sessions: new Map(), checkouts, exchangeRate: brl,
      settings: {
        ...settings,
        productCosts: [{ id: 'guide', productName: 'Guia', costBRL: 200, group: null }],
      },
      media: { ...media, spend: 300, mediaTax: 10 }, expensesBRL: 80,
      tracking: { sessions: 0, checkoutClicks: 0, matchedSales: 0 },
    };
    const values = (data: typeof input) => Object.fromEntries(buildSummary(data).cards.map(({ key, value }) => [key, value]));
    expect(values(input)).toMatchObject({
      netRevenue: 1000, taxes: 100, productCosts: 200, spend: 300, mediaTax: 10,
      expenses: 80, profit: 390, margin: 0.39, roi: 2.903225806451613,
    });
    expect(values({ ...input, sales: [] })).toMatchObject({ netRevenue: 0, profit: -310, margin: null, roi: 0 });
    expect(values({ ...input, media: { ...media, spend: 0, mediaTax: 0 } })).toMatchObject({
      profit: 700, margin: 0.7, roi: null,
    });
  });

  it('tem uma explicação para cada card e gráfico do catálogo', () => {
    for (const entry of [...CARD_CATALOG, ...CHART_CATALOG]) {
      expect(entry.hint.trim()).not.toBe('');
    }
  });

  it('pendente, reembolso e Pix pago sobre gerado', () => {
    expect(card('pendingSales')).toBe(1);
    expect(card('pendingRevenue')).toBe(40);
    expect(card('refundRate')).toBeCloseTo(1 / 3);
    expect(card('pixConversion')).toBeCloseTo(2 / 3); // o1 pago, o4 reembolsado (foi pago), o3 pendente
  });

  it('mídia e rastreio', () => {
    expect(card('ctr')).toBeCloseTo(0.02);
    expect(card('cpm')).toBe(5);
    expect(card('checkoutClickRate')).toBeCloseTo(0.1);
    expect(card('sessionConversion')).toBeCloseTo(1 / 400);
  });

  it('vendas por dia da semana trazem os 7 dias e por hora as 24 horas', () => {
    const { byDayOfWeek, byHour } = result.charts;
    expect(byDayOfWeek.map((p) => p.label)).toEqual(['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']);
    // 21/11/2026 é sábado: as duas aprovadas caem nele; os outros dias ficam zerados.
    expect(byDayOfWeek[6]).toEqual({ label: 'Sábado', sales: 2, revenue: 160 });
    expect(byDayOfWeek.slice(0, 6).every((p) => p.sales === 0 && p.revenue === 0)).toBe(true);
    expect(byHour).toHaveLength(24);
    expect(byHour.find((p) => p.label === '09h')).toEqual({ label: '09h', sales: 1, revenue: 100 });
    expect(byHour.find((p) => p.label === '17h')).toEqual({ label: '17h', sales: 1, revenue: 60 });
  });

  it('séries por hora acumulam no fuso de São Paulo', () => {
    const at = (label: string) => result.charts.hourly.find((p) => p.label === label)!;
    expect(at('09h')).toMatchObject({ revenue: 100, revenueCum: 100, spendCum: 50 });
    expect(at('17h')).toMatchObject({ revenue: 60, revenueCum: 160 });
    expect(result.charts.daily).toEqual([expect.objectContaining({ label: '2026-11-21', revenue: 160, spend: 50, sales: 2 })]);
  });

  it('origem e posicionamento vêm da sessão, sem o lead da UTMify nem o marcador stl_', () => {
    expect(result.charts.byUtmSource.map((p) => p.label).sort()).toEqual(['FB', 'google']);
    expect(result.charts.byUtmTerm.map((p) => p.label).sort()).toEqual(['(sem posicionamento)', 'Instagram_Reels']);
    expect(result.charts.byPaymentMethod.map((p) => p.label)).toEqual(['Pix', 'Cartão']);
  });

  it('gasto indisponível deixa lucro e ROI em null', () => {
    const empty = buildSummary({
      sales, sessions: new Map(), checkouts, settings, exchangeRate: brl,
      media: { ...media, spend: null, mediaTax: null }, expensesBRL: 0, tracking: { sessions: null, checkoutClicks: null, matchedSales: 0 },
    });
    expect(empty.cards.find((c) => c.key === 'profit')?.value).toBeNull();
    expect(empty.cards.find((c) => c.key === 'roi')?.value).toBeNull();
  });
});

describe('Auxiliares', () => {
  it('limpa utm_source e utm_term', () => {
    expect(cleanSource('map_qajLj6b0123')).toBe('map_qa');
    expect(cleanTerm('stl_9f2c')).toBeNull();
    expect(cleanTerm('Facebook_Mobile_Feed')).toBe('Facebook_Mobile_Feed');
  });

  it('período anterior de mesmo tamanho', () => {
    expect(previousPeriod('2026-11-16', '2026-11-22')).toEqual({ since: '2026-11-09', until: '2026-11-15' });
    expect(previousPeriod('2026-11-22', '2026-11-22')).toEqual({ since: '2026-11-21', until: '2026-11-21' });
  });
});

describe('Layout e colunas', () => {
  it('o layout padrão é válido e o inválido é recusado', () => {
    expect(layoutError(DEFAULT_LAYOUT)).toBeNull();
    expect(layoutError({ version: 3, sections: [] })).toBe('Versão de layout desconhecida.');
    expect(layoutError({ version: 1, sections: [{ key: 'a', title: 'A', collapsed: false, items: [{ key: 'nope', size: 'sm' }] }] }))
      .toBe('Item desconhecido: nope.');
    expect(layoutError({ version: 1, sections: [{ key: 'a', title: 'A', collapsed: false, items: [{ key: 'roi', size: 'sm' }, { key: 'roi', size: 'md' }] }] }))
      .toBe('Item repetido: roi.');
  });

  const v2 = (items: object[], extra: object = {}) => ({ version: 2, sections: [{ key: 'a', title: 'A', collapsed: false, items, ...extra }] });

  it('o layout v2 aceita posição e tamanho livres, em qualquer seção', () => {
    expect(layoutError(v2([{ key: 'hourly', x: 0, y: 0, w: 12, h: 7 }, { key: 'roi', x: 0, y: 7, w: 3, h: 2 }, { key: 'fees', x: 3, y: 7, w: 9, h: 4 }]))).toBeNull();
    expect(layoutError(v2([{ key: 'roi', x: 0, y: 0, w: 13, h: 2 }]))).toBe('Tamanho inválido em roi.');
    expect(layoutError(v2([{ key: 'roi', x: 0, y: 0, w: 2, h: 0 }]))).toBe('Tamanho inválido em roi.');
    expect(layoutError(v2([{ key: 'roi', x: -1, y: 0, w: 2, h: 2 }]))).toBe('Posição inválida em roi.');
    expect(layoutError(v2([{ key: 'roi', x: 11, y: 0, w: 2, h: 2 }]))).toBe('roi passa da largura da grade.');
    expect(layoutError(v2([{ key: 'roi', x: 0, y: 0, w: 1.5, h: 2 }]))).toBe('Tamanho inválido em roi.');
    expect(layoutError(v2([{ key: 'roi', x: 0, y: 0, w: 4, h: 2 }, { key: 'roas', x: 3, y: 1, w: 2, h: 2 }]))).toBe('Itens sobrepostos na seção A.');
    expect(layoutError(v2([{ key: 'roi', x: 0, y: 0, w: 4, h: 2, size: 'sm' }]))).toBe('Campo desconhecido em roi: size.');
    expect(layoutError(v2([{ key: 'roi', size: 'sm' }]))).toBe('Tamanho inválido em roi.');
    expect(layoutError({ version: 2, sections: [{ key: 'a', title: 'A', collapsed: false, items: [] }, { key: 'a', title: 'B', collapsed: false, items: [] }] }))
      .toBe('Seção repetida: a.');
    expect(layoutError({ version: 2, sections: [
      { key: 'a', title: 'A', collapsed: false, items: [{ key: 'roi', x: 0, y: 0, w: 2, h: 2 }] },
      { key: 'b', title: 'B', collapsed: false, items: [{ key: 'roi', x: 0, y: 0, w: 2, h: 2 }] },
    ] })).toBe('Item repetido: roi.');
  });

  it('o layout v1 continua válido e vira posições e tamanhos equivalentes na grade', () => {
    const old: SummaryLayoutV1 = {
      version: 1,
      sections: [
        { key: 'general', title: 'Geral', collapsed: false, items: [
          { key: 'grossRevenue', size: 'sm' }, { key: 'profit', size: 'md' }, { key: 'roi', size: 'sm' },
          { key: 'roas', size: 'sm' }, { key: 'margin', size: 'sm' }, { key: 'sales', size: 'lg' }, { key: 'cpa', size: 'sm' },
        ] },
        { key: 'charts', title: 'Gráficos', collapsed: true, items: [
          { key: 'hourly', size: 'lg' }, { key: 'byProduct', size: 'md' }, { key: 'byHour', size: 'md' }, { key: 'funnelMeta', size: 'sm' },
        ] },
      ],
    };
    expect(layoutError(old)).toBeNull();
    const next = migrateLayout(old);
    expect(layoutError(next)).toBeNull();
    expect(next.version).toBe(2);
    expect(next.sections.map((s) => [s.key, s.title, s.collapsed])).toEqual([['general', 'Geral', false], ['charts', 'Gráficos', true]]);
    expect(next.sections[0].items).toEqual([
      { key: 'grossRevenue', x: 0, y: 0, w: 2, h: 2 },
      { key: 'profit', x: 2, y: 0, w: 4, h: 2 },
      { key: 'roi', x: 6, y: 0, w: 2, h: 2 },
      { key: 'roas', x: 8, y: 0, w: 2, h: 2 },
      { key: 'margin', x: 10, y: 0, w: 2, h: 2 },
      { key: 'sales', x: 0, y: 2, w: 12, h: 2 },
      { key: 'cpa', x: 0, y: 4, w: 2, h: 2 },
    ]);
    expect(next.sections[1].items).toEqual([
      { key: 'hourly', x: 0, y: 0, w: 12, h: 7 },
      { key: 'byProduct', x: 0, y: 7, w: 6, h: 7 },
      { key: 'byHour', x: 6, y: 7, w: 6, h: 7 },
      { key: 'funnelMeta', x: 0, y: 14, w: 4, h: 7 },
    ]);
    expect(toLayoutV2(next)).toBe(next);
    expect(toLayoutV2(old)).toEqual(next);
  });

  it('o layout padrão tem todos os cards e gráficos, na grade', () => {
    expect(DEFAULT_LAYOUT.version).toBe(2);
    const keys = DEFAULT_LAYOUT.sections.flatMap((s) => s.items.map((i) => i.key));
    expect(keys).toEqual(expect.arrayContaining(['grossRevenue', 'sessions', 'hourly', 'funnelMeta', 'byCountry', 'byState']));
    expect(DEFAULT_LAYOUT.sections.find((s) => s.key === 'tracking')?.collapsed).toBe(true);
  });

  it('valida as colunas de Campanhas', () => {
    expect(campaignColumnsError({ campaign: { columns: ['spend', 'roi'], sort: { key: 'profit', dir: 'desc' } } })).toBeNull();
    expect(campaignColumnsError({ campanha: { columns: [] } })).toBe('Nível desconhecido: campanha.');
    expect(campaignColumnsError({ ad: { columns: ['spend', 'spend'] } })).toBe('Coluna repetida em ad.');
    expect(campaignColumnsError({ ad: { columns: ['x y'] } })).toBe('Coluna inválida em ad.');
  });
});

describe('ARPU', () => {
  const arpu = (sales: SummarySale[]) => buildSummary({
    sales, sessions: new Map(), checkouts, settings, exchangeRate: brl, media, expensesBRL: 0,
    tracking: { sessions: null, checkoutClicks: null, matchedSales: null },
  }).cards.find((c) => c.key === 'avgTicket');

  it('é o faturamento bruto ÷ compradores únicos (e-mail, depois documento, depois telefone)', () => {
    const card = arpu([
      sale({ id: 'a', order_external_id: 'o1', amount: 100, customer_email: 'Ana@Mail.com ' }),
      sale({ id: 'b', order_external_id: 'o2', amount: 50, customer_email: 'ana@mail.com' }),
      sale({ id: 'c', order_external_id: 'o3', amount: 30, customer_doc: '123.456.789-00' }),
      sale({ id: 'd', order_external_id: 'o4', amount: 20, customer_doc: '12345678900' }),
      sale({ id: 'e', order_external_id: 'o5', amount: 40, customer_phone: '+55 (11) 99999-0000' }),
      sale({ id: 'f', order_external_id: 'o6', amount: 60 }),
      sale({ id: 'g', order_external_id: 'o7', amount: 99, status: 'pending', customer_email: 'outra@mail.com' }),
    ]);
    // Bruto aprovado 300; compradores: ana, documento, telefone e o pedido sem nada = 4.
    expect(card).toMatchObject({ label: 'ARPU', value: 75 });
  });

  it('sem venda aprovada fica null', () => {
    expect(arpu([sale({ status: 'pending' })])?.value).toBeNull();
  });
});

describe('País e estado', () => {
  it('normaliza o país para ISO-2', () => {
    expect(normalizeCountry('BR')).toBe('BR');
    expect(normalizeCountry(' br ')).toBe('BR');
    expect(normalizeCountry('BRA')).toBe('BR');
    expect(normalizeCountry('Brasil')).toBe('BR');
    expect(normalizeCountry('Brazil')).toBe('BR');
    expect(normalizeCountry('Portugal')).toBe('PT');
    expect(normalizeCountry('Estados Unidos')).toBe('US');
    expect(normalizeCountry('USA')).toBe('US');
    expect(normalizeCountry('OTHER')).toBeNull();
    expect(normalizeCountry('')).toBeNull();
    expect(normalizeCountry(null)).toBeNull();
  });

  it('normaliza a UF', () => {
    expect(normalizeState('SP')).toBe('SP');
    expect(normalizeState('rj')).toBe('RJ');
    expect(normalizeState('BR-MG')).toBe('MG');
    expect(normalizeState('São Paulo')).toBe('SP');
    expect(normalizeState('Sao Paulo')).toBe('SP');
    expect(normalizeState('Portugal')).toBeNull();
    expect(normalizeState(undefined)).toBeNull();
  });

  it('agrega as vendas por país e por estado, com o sem país à parte', () => {
    const order = (country: string | null, state: string | null, amount: number) =>
      ({ lines: [sale({ customer_country: country, customer_state: state })], amount });
    const { byCountry, byState } = geoBreakdown([
      order('BR', 'SP', 100), order('BRA', 'sp', 50), order('Brasil', 'RJ', 30), order('Portugal', 'Portugal', 80),
      order(null, null, 20), order('OTHER', null, 10), order(null, 'MG', 40), order('BR', null, 5),
    ]);
    expect(byCountry).toEqual([
      { label: 'Brasil', code: 'BR', iso3: 'BRA', numeric: '076', sales: 5, revenue: 225, share: 5 / 8 },
      { label: 'Portugal', code: 'PT', iso3: 'PRT', numeric: '620', sales: 1, revenue: 80, share: 1 / 8 },
      { label: 'Sem país', code: '', iso3: '', numeric: '', sales: 2, revenue: 30, share: 2 / 8 },
    ]);
    // Brasil explícito (4) mais a venda sem país com UF válida (MG). Empate em vendas: maior faturamento primeiro.
    expect(byState).toEqual([
      { label: 'São Paulo', code: 'SP', sales: 2, revenue: 150, share: 2 / 5 },
      { label: 'Minas Gerais', code: 'MG', sales: 1, revenue: 40, share: 1 / 5 },
      { label: 'Rio de Janeiro', code: 'RJ', sales: 1, revenue: 30, share: 1 / 5 },
      { label: 'Sem estado', code: '', sales: 1, revenue: 5, share: 1 / 5 },
    ]);
  });
});

describe('Funil', () => {
  it('calcula o percentual sobre a primeira etapa e a taxa sobre a anterior', () => {
    const steps = funnelSteps([
      { label: 'Cliques', value: 200 }, { label: 'Visualizações da página', value: 150 }, { label: 'Inícios de checkout', value: 20 },
      { label: 'Vendas pendentes', value: 5 }, { label: 'Vendas aprovadas', value: 4 },
    ]);
    expect(steps.map((s) => s.pctOfFirst)).toEqual([1, 0.75, 0.1, 0.025, 0.02]);
    expect(steps.map((s) => s.stepRate)).toEqual([null, 0.75, 20 / 150, 0.25, 0.8]);
    const empty = funnelSteps([{ label: 'Cliques', value: 0 }, { label: 'Vendas', value: null }]);
    expect(empty.map((s) => [s.pctOfFirst, s.stepRate])).toEqual([[null, null], [null, null]]);
  });

  it('o funil da Meta vai de cliques a vendas aprovadas', () => {
    const result = buildSummary({
      sales: [sale(), sale({ id: 's3', order_external_id: 'o3', status: 'pending' })], sessions: new Map(), checkouts, settings,
      exchangeRate: brl, media, expensesBRL: 0, tracking: { sessions: null, checkoutClicks: null, matchedSales: null },
    });
    expect(result.charts.funnelMeta.map((p) => [p.label, p.value])).toEqual([
      ['Cliques', 200], ['Visualizações da página', 150], ['Inícios de checkout', 20], ['Vendas pendentes', 2], ['Vendas aprovadas', 1],
    ]);
    expect(result.charts.funnelMeta[3].pendingNow).toBe(1);
    expect(result.charts.byCountry[0]).toEqual(expect.objectContaining({ code: 'BR', sales: 1 }));
  });
});

describe('Taxa de aprovação', () => {
  it('classifica o meio separando débito de crédito', () => {
    expect(approvalMethod('credit_card')).toBe('credit_card');
    expect(approvalMethod('Cartão de Crédito')).toBe('credit_card');
    expect(approvalMethod('CARD')).toBe('credit_card');
    expect(approvalMethod('debit_card')).toBe('debit_card');
    expect(approvalMethod('Cartão de débito')).toBe('debit_card');
    expect(approvalMethod('pix')).toBe('pix');
    expect(approvalMethod('PIX_AUTOMATICO')).toBe('pix');
    expect(approvalMethod('boleto')).toBe('boleto');
    expect(approvalMethod('billet')).toBe('boleto');
    expect(approvalMethod('paypal')).toBeNull();
    expect(approvalMethod(null)).toBeNull();
  });

  it('aprovados (inclui reembolso e chargeback) ÷ gerados do meio; sem pedido, taxa nula', () => {
    const sales = [
      sale({ id: 'a', order_external_id: 'a', payment_method: 'pix', status: 'approved' }),
      sale({ id: 'b', order_external_id: 'b', payment_method: 'pix', status: 'pending' }),
      sale({ id: 'c', order_external_id: 'c', payment_method: 'pix', status: 'refunded' }),
      sale({ id: 'd', order_external_id: 'd', payment_method: 'pix', status: 'refused' }),
      sale({ id: 'e', order_external_id: 'e', payment_method: 'credit_card', status: 'refused' }),
      sale({ id: 'f', order_external_id: 'f', payment_method: 'credit_card', status: 'chargeback' }),
      sale({ id: 'g', order_external_id: 'g', payment_method: 'debit_card', status: 'approved' }),
      // Order bump do pedido g (mesmo pedido): conta uma vez.
      sale({ id: 'g2', order_external_id: 'g', payment_method: 'debit_card', status: 'approved' }),
      sale({ id: 'h', order_external_id: 'h', payment_method: null, status: 'approved' }),
    ];
    const result = buildSummary({
      sales, sessions: new Map(), checkouts, settings, exchangeRate: brl, media, expensesBRL: 0,
      tracking: { sessions: 0, checkoutClicks: 0, matchedSales: 0 },
    });
    expect(result.charts.approvalRate).toEqual([
      { label: 'Cartão de crédito', method: 'credit_card', approved: 1, generated: 2, rate: 0.5 },
      { label: 'Cartão de débito', method: 'debit_card', approved: 1, generated: 1, rate: 1 },
      { label: 'Pix', method: 'pix', approved: 2, generated: 4, rate: 0.5 },
      { label: 'Boleto', method: 'boleto', approved: 0, generated: 0, rate: null },
    ]);
    // Vendas e faturamento seguem só com as aprovadas: a, g e h.
    expect(result.cards.find((c) => c.key === 'sales')?.value).toBe(3);
    // Pix pago ÷ gerado: a e c foram pagos; b pendente e d recusado não.
    expect(result.cards.find((c) => c.key === 'pixConversion')?.value).toBe(0.5);
  });

  it('pedido de status desconhecido não entra na conta', () => {
    expect(approvalRates([{ status: 'other', lines: [{ payment_method: 'pix' }] }])[2]).toMatchObject({ generated: 0, rate: null });
  });
});
