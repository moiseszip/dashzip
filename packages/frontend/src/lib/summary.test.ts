import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ api: {} }));

import { formatCardValue, gainTone } from '@/lib/summary';

describe('cor de ganho/perda', () => {
  it('Lucro e Margem pelo sinal', () => {
    expect(gainTone('profit', 10)).toBe('gain');
    expect(gainTone('profit', -0.01)).toBe('loss');
    expect(gainTone('margin', 0)).toBeNull();
    expect(gainTone('margin', -0.2)).toBe('loss');
  });

  it('ROI e ROAS contra o empate em 1', () => {
    expect(gainTone('roi', 1.3)).toBe('gain');
    expect(gainTone('roi', 0.8)).toBe('loss');
    expect(gainTone('roas', 1)).toBeNull();
    expect(gainTone('roas', 2.4)).toBe('gain');
  });

  it('sem dado ou outro card fica na cor normal', () => {
    expect(gainTone('roi', null)).toBeNull();
    expect(gainTone('spend', -5)).toBeNull();
  });

  it('exibe a margem do card como porcentagem com duas casas', () => {
    expect(formatCardValue('margin', 390 / 1000, 'pct')).toBe('39,00%');
    expect(formatCardValue('margin', null, 'pct')).toBe('—');
  });

  it('ROI sem o "x"; ROAS mantém', () => {
    expect(formatCardValue('roi', 1.5, 'ratio')).toBe('1,50');
    expect(formatCardValue('roas', 1.5, 'ratio')).toBe('1,50x');
    expect(formatCardValue('roi', null, 'ratio')).toBe('—');
  });
});
