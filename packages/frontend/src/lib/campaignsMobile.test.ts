import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { adjustBudget, formatBudgetInput, metricTone, parseBudgetInput } from '@/lib/campaigns';

describe('parseBudgetInput', () => {
  it('lê vírgula decimal e milhar com ponto', () => {
    expect(parseBudgetInput('50,5')).toBe(50.5);
    expect(parseBudgetInput('1.234,56')).toBe(1234.56);
    expect(parseBudgetInput('R$ 80,00')).toBe(80);
  });

  it('aceita ponto decimal do teclado numérico, mas ponto + 3 dígitos é milhar', () => {
    expect(parseBudgetInput('50.5')).toBe(50.5);
    expect(parseBudgetInput('50.25')).toBe(50.25);
    expect(parseBudgetInput('1.500')).toBe(1500);
  });

  it('recusa vazio e texto', () => {
    expect(parseBudgetInput('')).toBeNull();
    expect(parseBudgetInput('abc')).toBeNull();
    expect(parseBudgetInput('10,5,3')).toBeNull();
  });
});

describe('adjustBudget', () => {
  it('soma e tira percentual arredondando em centavos', () => {
    expect(adjustBudget(50, 10)).toBe(55);
    expect(adjustBudget(33.33, 20)).toBe(40);
    expect(adjustBudget(50, -20)).toBe(40);
  });

  it('nunca fica zerado ou negativo', () => {
    expect(adjustBudget(0.01, -50)).toBe(0.01);
    expect(adjustBudget(10, -100)).toBe(0.01);
  });
});

describe('formatBudgetInput', () => {
  it('usa vírgula e corta em centavos', () => {
    expect(formatBudgetInput(55)).toBe('55');
    expect(formatBudgetInput(40.5)).toBe('40,5');
    expect(formatBudgetInput(10.006)).toBe('10,01');
  });
});

describe('metricTone', () => {
  it('lucro e margem pelo sinal, ROI em relação a 1', () => {
    expect(metricTone('profit', 10)).toBe('gain');
    expect(metricTone('margin', -0.1)).toBe('loss');
    expect(metricTone('roi', 1.2)).toBe('gain');
    expect(metricTone('roi', 0.8)).toBe('loss');
    expect(metricTone('roi', 1)).toBeNull();
    expect(metricTone('spend', 100)).toBeNull();
    expect(metricTone('profit', null)).toBeNull();
  });
});
