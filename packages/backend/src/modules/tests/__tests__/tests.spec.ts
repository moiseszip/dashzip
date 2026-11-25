import { parseActivities } from '../../campaigns/campaigns.service';
import { normalizeOffers, offerMatcher, offersError, TestOffer } from '../offers';

const offers: TestOffer[] = [
  { id: 'curso', name: 'Curso Exemplo', codes: ['CUR'], accountIds: ['act_11111'], products: [] },
  { id: 'ir', name: 'Mapa Fácil do Novo IR', codes: ['IR'], accountIds: [], products: [] },
  { id: 'nutri', name: 'Mapa da Nutri', codes: ['Mapa da Nutri'], accountIds: [], products: [] },
];

describe('Oferta da campanha', () => {
  const offerOf = offerMatcher(offers);

  it('reconhece o código como palavra inteira, respeitando maiúsculas', () => {
    expect(offerOf('CUR | Vídeo 03 | ABO', 'act_11111')).toBe('curso');
    expect(offerOf('[IR] teste 2', '999')).toBe('ir');
    expect(offerOf('Campanha para ir ao ar', '999')).toBeNull();
    expect(offerOf('CURSO teste', 'act_11111')).toBeNull();
    expect(offerOf('Mapa da Nutri - LP B', '999')).toBe('nutri');
  });

  it('respeita as contas da oferta', () => {
    expect(offerOf('CUR | Vídeo 03', 'act_22222')).toBeNull();
    expect(offerOf('CUR | Vídeo 03', '11111')).toBe('curso');
  });

  it('valida e normaliza o cadastro', () => {
    expect(offersError(offers)).toBeNull();
    expect(offersError([{ ...offers[0], codes: [] }])).toBe('Códigos inválidos em Curso Exemplo.');
    expect(offersError([offers[0], offers[0]])).toBe('Oferta repetida: curso.');
    expect(offersError([{ ...offers[0], cor: 'azul' }])).toBe('Campo desconhecido em Curso Exemplo: cor.');
    expect(normalizeOffers([{ ...offers[0], accountIds: ['11111', 'act_11111'], codes: [' CUR ', 'CUR'] }])[0])
      .toMatchObject({ accountIds: ['act_11111'], codes: ['CUR'] });
  });
});

describe('Última mudança', () => {
  const campaigns = new Set(['c1']);
  const byAdset = new Map([['s1', 'c1']]);
  const byAd = new Map([['a1', 'c1']]);

  it('lê status e orçamento, acha a campanha pelo conjunto e mostra o System User como dash.zip', () => {
    const changes = parseActivities([
      { event_type: 'update_campaign_run_status', event_time: '2026-11-22T12:00:00+0000', object_id: 'c1', actor_name: 'Operador Exemplo',
        extra_data: JSON.stringify({ old_value: 'Active', new_value: 'Paused' }) },
      { event_type: 'update_ad_set_budget', event_time: '2026-11-22T13:00:00+0000', object_id: 's1', actor_name: 'Conversions System User',
        extra_data: { old_value: { old_value: 2000 }, new_value: { new_value: 3000 } } },
      { event_type: 'update_ad_run_status', event_time: '2026-11-22T14:00:00+0000', object_id: 'a1', extra_data: { new_value: 'Active' } },
      { event_type: 'create_ad', event_time: '2026-11-22T15:00:00+0000', object_id: 'a1' },
      { event_type: 'update_campaign_run_status', event_time: '2026-11-22T16:00:00+0000', object_id: 'outra', extra_data: { new_value: 'Paused' } },
    ], campaigns, byAdset, byAd);
    expect(changes).toEqual([
      expect.objectContaining({ campaignId: 'c1', kind: 'paused', level: 'campaign', actor: 'Operador Exemplo' }),
      expect.objectContaining({ campaignId: 'c1', kind: 'budget', level: 'adset', actor: 'dash.zip', from: 20, to: 30 }),
      expect.objectContaining({ campaignId: 'c1', kind: 'activated', level: 'ad', actor: 'Meta' }),
    ]);
  });
});
