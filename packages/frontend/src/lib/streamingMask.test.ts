import { describe, expect, it, vi } from 'vitest';
import { createMaskRegistry, SECRET_MASK, utmNamePart } from './streamingMask';

describe('createMaskRegistry', () => {
  it('numera por tipo, na ordem em que cada nome aparece', () => {
    const { mask } = createMaskRegistry();
    expect(mask('campaign', '[CBO] Kit Arch | Frio')).toBe('Campanha 1');
    expect(mask('campaign', '[ABO] Teste criativo')).toBe('Campanha 2');
    expect(mask('adset', 'Aberto 25-55')).toBe('Conjunto 1');
    expect(mask('ad', 'AD07 - video depoimento')).toBe('Anúncio 1');
    expect(mask('product', 'Método Arch')).toBe('Produto 1');
    expect(mask('workspace', 'Arch BR')).toBe('Painel 1');
    expect(mask('account', 'CA 03 - Loja Exemplo')).toBe('Conta 1');
  });

  it('o mesmo nome sempre vira o mesmo apelido (ignora espaços nas pontas e repetidos)', () => {
    const { mask } = createMaskRegistry();
    const first = mask('campaign', 'Campanha Escala');
    mask('campaign', 'Outra');
    expect(mask('campaign', '  Campanha   Escala ')).toBe(first);
    expect(mask('campaign', 'Outra')).toBe('Campanha 2');
  });

  it('tipos diferentes têm numeração independente', () => {
    const { mask } = createMaskRegistry();
    expect(mask('campaign', 'Kit')).toBe('Campanha 1');
    expect(mask('product', 'Kit')).toBe('Produto 1');
  });

  it('dados sem sentido numerar viram máscara fixa', () => {
    const { mask } = createMaskRegistry();
    for (const kind of ['email', 'phone', 'document', 'id', 'url', 'domain', 'token'] as const) {
      expect(mask(kind, 'qualquer@coisa.com')).toBe(SECRET_MASK);
    }
  });

  it('valor vazio passa como veio', () => {
    const { mask } = createMaskRegistry();
    expect(mask('campaign', '')).toBe('');
    expect(mask('campaign', '   ')).toBe('   ');
  });

  it('sobrevive a um F5: retoma do snapshot salvo e avisa quando ganha nome novo', () => {
    const onChange = vi.fn();
    const first = createMaskRegistry(null, onChange);
    first.mask('campaign', 'A');
    first.mask('campaign', 'B');
    const saved = onChange.mock.lastCall![0];
    const again = createMaskRegistry(saved);
    expect(again.mask('campaign', 'B')).toBe('Campanha 2');
    expect(again.mask('campaign', 'C')).toBe('Campanha 3');
  });

  it('ignora snapshot corrompido', () => {
    const reg = createMaskRegistry({ campaign: [['x', 'y' as unknown as number]] });
    expect(reg.mask('campaign', 'z')).toBe('Campanha 1');
  });

  it('scrub troca nomes já apelidados, e-mails e URLs em texto livre', () => {
    const { mask, scrub } = createMaskRegistry();
    mask('campaign', 'Kit Arch Frio');
    const out = scrub('A Meta recusou kit arch frio: ver https://lp.arch.com/oferta ou fale com joao@arch.com');
    expect(out).toBe('A Meta recusou Campanha 1: ver ••••• ou fale com •••••');
  });
});

describe('utmNamePart', () => {
  it('tira o ID do padrão nome|id', () => {
    expect(utmNamePart('cbo-kit|120256873073380460')).toBe('cbo-kit');
    expect(utmNamePart('sem-id')).toBe('sem-id');
    expect(utmNamePart(null)).toBeNull();
  });
});
