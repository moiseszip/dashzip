import { FinanceSettings } from '../../finance/finance-totals';
import {
  attribute, AttributableSale, buildMetrics, deliveryFromInsight, EMPTY_DELIVERY, Hierarchy, idFromUtm,
  revenueOf, saleKeys, sumMetrics,
} from '../campaign-attribution';
import { budgetLevelOf, rowOf, writeParams } from '../campaign-actions.service';
import { classifyMetaError } from '../meta-graph.client';

const settings: FinanceSettings = {
  salesTaxPercent: 10, usdAdTaxPercent: 3.5, checkoutRules: [], extraFees: [], mediaTaxRules: [], productCosts: [],
};
const checkouts = [{ id: 'w', platform: 'wiapy', use_commission_value: false }];
const rate = (currency: string) => (currency === 'BRL' ? 1 : currency === 'USD' ? 5 : null);

const sale = (fields: Partial<AttributableSale> = {}): AttributableSale => ({
  id: 's1', external_id: 'e1', order_external_id: 'o1', checkout_integration_id: 'w',
  amount: 100, currency: 'BRL', status: 'approved', sold_at: '2026-11-21T12:00:00.000Z',
  metadata: { payment_fee: 4 }, utm_campaign: null, utm_medium: null, utm_content: null, ad_id: null, ...fields,
});

const hierarchy: Hierarchy = {
  ads: new Map([['120200000000000001', { adsetId: '120200000000000010', campaignId: '120200000000000100', accountId: 'act_111' }]]),
  adsets: new Map([['120200000000000010', { campaignId: '120200000000000100', accountId: 'act_111' }]]),
  campaigns: new Map([
    ['120200000000000100', { accountId: 'act_111' }],
    ['120200000000000200', { accountId: 'act_111' }],
  ]),
};

describe('ID na UTM', () => {
  it('lê o ID depois do último | e ignora o click ID depois de ::', () => {
    expect(idFromUtm('ARC | Vídeo 03|120200000000000001')).toBe('120200000000000001');
    expect(idFromUtm('Anúncio|120200000000000001::fbclid123::')).toBe('120200000000000001');
    expect(idFromUtm('ARC%20%7C%20teste%7C120200000000000100')).toBe('120200000000000100');
    expect(idFromUtm('120200000000000100')).toBe('120200000000000100');
  });

  it('recusa macro literal, marcador da sessão e texto sem ID', () => {
    expect(idFromUtm('{{campaign.name}}|{{campaign.id}}')).toBeNull();
    expect(idFromUtm('stl_9f2c')).toBeNull();
    expect(idFromUtm('organico')).toBeNull();
    expect(idFromUtm(null)).toBeNull();
  });

  it('prefere a sessão e completa campo a campo com a venda', () => {
    const keys = saleKeys([
      { utm_campaign: 'A|120200000000000100', utm_content: null },
      { utm_campaign: 'B|120200000000000200', utm_content: 'Ad|120200000000000001' },
    ]);
    expect(keys).toEqual({ campaignId: '120200000000000100', adsetId: null, adId: '120200000000000001' });
  });
});

describe('Atribuição', () => {
  it('usa as UTMs da sessão casada mesmo com outras na venda', () => {
    const sessions = new Map([['s1', { utm_campaign: 'A|120200000000000100' }]]);
    const result = attribute([sale({ utm_campaign: 'B|120200000000000200' })], sessions, hierarchy, 'campaign');
    expect([...result.byObject.keys()]).toEqual(['120200000000000100']);
  });

  it('ignora utm_source reescrito e utm_term stl_, e usa o anúncio para achar conjunto e campanha', () => {
    const lines = [sale({ utm_content: 'Ad|120200000000000001', utm_campaign: 'X|120200000000000200' })];
    const noSessions = new Map();
    expect([...attribute(lines, noSessions, hierarchy, 'campaign').byObject.keys()]).toEqual(['120200000000000100']);
    expect([...attribute(lines, noSessions, hierarchy, 'adset').byObject.keys()]).toEqual(['120200000000000010']);
    expect([...attribute(lines, noSessions, hierarchy, 'account').byObject.keys()]).toEqual(['act_111']);
  });

  it('venda só com a campanha não aparece no conjunto nem no anúncio', () => {
    const lines = [sale({ utm_campaign: 'A|120200000000000100' })];
    expect(attribute(lines, new Map(), hierarchy, 'adset').byObject.size).toBe(0);
    expect(attribute(lines, new Map(), hierarchy, 'adset').untracked).toHaveLength(0);
    expect(attribute(lines, new Map(), hierarchy, 'campaign').byObject.get('120200000000000100')).toHaveLength(1);
  });

  it('ID desconhecido e venda sem UTM viram não trackeadas', () => {
    const result = attribute([
      sale({ id: 'a', order_external_id: 'a', utm_campaign: 'Z|999999999999' }),
      sale({ id: 'b', order_external_id: 'b' }),
    ], new Map(), hierarchy, 'campaign');
    expect(result.untracked.map((line) => line.id)).toEqual(['a', 'b']);
  });

  it('bump segue o pedido principal', () => {
    const result = attribute([
      sale({ utm_content: 'Ad|120200000000000001' }),
      sale({ id: 's2', amount: 20, sold_at: '2026-11-21T12:00:05.000Z', metadata: null }),
    ], new Map(), hierarchy, 'ad');
    expect(result.byObject.get('120200000000000001')).toHaveLength(2);
  });
});

describe('Métricas da linha', () => {
  it('calcula lucro, ROI, ROAS e CPA na régua combinada', () => {
    const revenue = revenueOf([sale()], checkouts, settings, rate);
    // Bruto 100, taxa 4, líquido 96 e imposto de 9,60.
    expect(revenue).toEqual({ sales: 1, grossRevenue: 100, netRevenue: 96, salesTax: 9.6, productCost: 0, afterDeductions: 86.4 });
    const delivery = { ...EMPTY_DELIVERY, spendNative: 10, impressions: 1000, clicks: 20, video3s: 300, video75: 50 };
    const metrics = buildMetrics(delivery, 50, 1.75, revenue);
    expect(metrics).toMatchObject({
      spend: 50, mediaTax: 1.75, profit: 34.65, roas: 2, cpa: 50, cpc: 2.5, cpm: 50, ctr: 0.02, hook: 0.3, hold: 0.05,
    });
    expect(metrics.roi).toBeCloseTo(86.4 / 51.75);
    expect(metrics.margin).toBeCloseTo(34.65 / 96);
    const rules = buildMetrics(delivery, 50, 1.75, revenue, 'rules');
    expect(rules.netRevenue).toBe(86.4);
    expect(rules.roi).toBeCloseTo((86.4 - 1.75) / 50);
  });

  it('pedido reembolsado sai das vendas', () => {
    const revenue = revenueOf([sale({ status: 'refunded' })], checkouts, settings, rate);
    expect(revenue.sales).toBe(0);
  });

  it('conta que falhou fica indisponível (null), não zero', () => {
    const metrics = buildMetrics(null, null, null, { sales: 2, grossRevenue: 200, netRevenue: 170, salesTax: 0, productCost: 0, afterDeductions: 170 });
    expect(metrics.spend).toBeNull();
    expect(metrics.profit).toBeNull();
    expect(metrics.roi).toBeNull();
    expect(metrics.sales).toBe(2);
  });

  it('sem gasto, ROI e ROAS ficam null; CPA é zero e sem venda é null', () => {
    const metrics = buildMetrics(EMPTY_DELIVERY, 0, 0, { sales: 1, grossRevenue: 100, netRevenue: 86, salesTax: 0, productCost: 0, afterDeductions: 86 });
    expect(metrics).toMatchObject({ roi: null, roas: null, cpa: 0, profit: 86 });
    expect(buildMetrics(EMPTY_DELIVERY, 10, 0, { sales: 0, grossRevenue: 0, netRevenue: 0, salesTax: 0, productCost: 0, afterDeductions: 0 }).cpa).toBeNull();
  });

  it('totais somam as linhas e recalculam as razões', () => {
    const a = buildMetrics({ ...EMPTY_DELIVERY, impressions: 1000, clicks: 10 }, 20, 0, { sales: 1, grossRevenue: 60, netRevenue: 50, salesTax: 0, productCost: 0, afterDeductions: 50 });
    const b = buildMetrics({ ...EMPTY_DELIVERY, impressions: 3000, clicks: 30 }, 80, 5, { sales: 1, grossRevenue: 140, netRevenue: 120, salesTax: 12, productCost: 8, afterDeductions: 100 });
    const total = sumMetrics([{ ...a, accountCurrency: 'BRL' }, { ...b, accountCurrency: 'BRL' }]);
    expect(total).toMatchObject({ spend: 100, sales: 2, grossRevenue: 200, netRevenue: 170, salesTax: 12, profit: 45, roas: 2, cpa: 50, ctr: 0.01, reach: null });
    expect(total.roi).toBeCloseTo(158 / 105);
    expect(total.margin).toBeCloseTo(45 / 170);
  });

  it('lê LPV, IC e vídeo das ações da Meta sem contar IC duas vezes', () => {
    const delivery = deliveryFromInsight({
      spend: '12.34', impressions: '500', inline_link_clicks: '9',
      actions: [
        { action_type: 'landing_page_view', value: '7' },
        { action_type: 'offsite_conversion.fb_pixel_initiate_checkout', value: '3' },
        { action_type: 'omni_initiated_checkout', value: '3' },
        { action_type: 'video_view', value: '120' },
      ],
      video_play_actions: [{ action_type: 'video_view', value: '400' }],
      video_p75_watched_actions: [{ action_type: 'video_view', value: '25' }],
    });
    expect(delivery).toMatchObject({ spendNative: 12.34, landingPageViews: 7, initiateCheckouts: 3, video3s: 120, videoPlays: 400, video75: 25 });
  });
});

describe('Ações', () => {
  const cbo = { id: '1', account_id: '111', daily_budget: '5000' };
  const abo = { id: '2', account_id: '111', campaign: {}, daily_budget: '2500' };

  it('orçamento na moeda da conta vira centavos no nível certo', () => {
    expect(writeParams({ objectId: '1', level: 'campaign', action: 'set_daily_budget', value: 75.5 }, cbo, 'USD'))
      .toEqual({ daily_budget: '7550' });
    expect(writeParams({ objectId: '2', level: 'adset', action: 'set_daily_budget', value: 30 }, abo, 'BRL'))
      .toEqual({ daily_budget: '3000' });
  });

  it('recusa orçamento no nível errado, valor inválido e moeda sem centavos', () => {
    const cboAdset = { id: '3', account_id: '111', campaign: { daily_budget: '5000' } };
    expect(() => writeParams({ objectId: '3', level: 'adset', action: 'set_daily_budget', value: 10 }, cboAdset, 'USD'))
      .toThrow(expect.objectContaining({ code: 'BUDGET_NOT_ON_THIS_LEVEL' }));
    expect(() => writeParams({ objectId: '1', level: 'campaign', action: 'set_lifetime_budget', value: 10 }, cbo, 'USD'))
      .toThrow(expect.objectContaining({ code: 'BUDGET_NOT_ON_THIS_LEVEL' }));
    expect(() => writeParams({ objectId: '1', level: 'campaign', action: 'set_daily_budget', value: 0.5 }, cbo, 'USD'))
      .toThrow(expect.objectContaining({ code: 'INVALID_VALUE' }));
    expect(() => writeParams({ objectId: '1', level: 'campaign', action: 'set_daily_budget', value: 10 }, cbo, 'JPY'))
      .toThrow(expect.objectContaining({ code: 'UNSUPPORTED_CURRENCY' }));
  });

  it('pausar e ativar mandam só o status', () => {
    expect(writeParams({ objectId: '9', level: 'ad', action: 'pause' }, { id: '9' }, 'USD')).toEqual({ status: 'PAUSED' });
    expect(writeParams({ objectId: '9', level: 'ad', action: 'activate' }, { id: '9' }, 'USD')).toEqual({ status: 'ACTIVE' });
  });

  it('linha devolvida mostra onde o orçamento mora', () => {
    expect(budgetLevelOf('adset', { id: '3', campaign: { daily_budget: '5000' } })).toBe('campaign');
    expect(rowOf('campaign', { id: '1', status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '5000' }))
      .toEqual({ status: 'ACTIVE', effectiveStatus: 'ACTIVE', dailyBudget: 50, lifetimeBudget: null, budgetLevel: 'campaign' });
    expect(rowOf('adset', { id: '3', status: 'PAUSED', campaign: { daily_budget: '5000' }, daily_budget: undefined }).dailyBudget).toBeNull();
  });
});

describe('Erros da Meta', () => {
  it('traduz os códigos da Graph API', () => {
    expect(classifyMetaError(400, { error: { code: 190, message: 'expired' } }).code).toBe('TOKEN_INVALID');
    expect(classifyMetaError(400, { error: { code: 17, message: 'limit' } }).code).toBe('RATE_LIMITED');
    expect(classifyMetaError(403, { error: { code: 200, message: 'perm' } }).code).toBe('MISSING_PERMISSION');
    expect(classifyMetaError(400, { error: { code: 100, error_user_msg: 'Your budget is too low. The minimum is $1.00' } }).code).toBe('LOW_BUDGET');
    expect(classifyMetaError(400, { error: { code: 100, message: 'Invalid parameter' } })).toMatchObject({ code: 'META_REJECTED', message: 'Invalid parameter' });
    expect(classifyMetaError(503, null).code).toBe('META_UNAVAILABLE');
  });
});
