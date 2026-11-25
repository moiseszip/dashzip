import { describe, expect, it } from 'vitest';
import { passwordErrorMessage, passwordStrength, validatePasswordChange } from './password';

describe('troca de senha', () => {
  it('exige senha atual, nova com 8+ caracteres, diferente da atual, e confirmação igual', () => {
    expect(validatePasswordChange({ current: '', next: '', confirm: '' })).toEqual({
      current: 'Digite a senha atual.', next: 'Digite a nova senha.', confirm: 'Repita a nova senha.',
    });
    expect(validatePasswordChange({ current: 'velha-123', next: 'curta', confirm: 'curta' }).next).toBe('Use pelo menos 8 caracteres.');
    expect(validatePasswordChange({ current: 'mesma-senha', next: 'mesma-senha', confirm: 'mesma-senha' }).next)
      .toBe('A nova senha precisa ser diferente da atual.');
    expect(validatePasswordChange({ current: 'velha-123', next: ' com-espaco ', confirm: ' com-espaco ' }).next)
      .toBe('Tire os espaços do começo e do fim.');
    expect(validatePasswordChange({ current: 'velha-123', next: 'Nova-Senha-2026', confirm: 'Nova-Senha-2025' }).confirm)
      .toBe('As senhas não batem.');
    expect(validatePasswordChange({ current: 'velha-123', next: 'Nova-Senha-2026', confirm: 'Nova-Senha-2026' })).toEqual({});
  });

  it('senha fraca avisa mas não bloqueia', () => {
    expect(validatePasswordChange({ current: 'x', next: '12345678', confirm: '12345678' })).toEqual({});
    expect(passwordStrength('12345678').strength).toBe('weak');
    expect(passwordStrength('12345678').hints[0]).toBe('Essa senha é muito comum.');
    expect(passwordStrength('operador2026!', 'operador@exemplo.com').strength).toBe('weak');
    expect(passwordStrength('abcdefgh').strength).toBe('weak');
    expect(passwordStrength('Gatinho2026').strength).toBe('fair');
    expect(passwordStrength('Correto-Cavalo-Bateria-9').strength).toBe('strong');
    expect(passwordStrength('').strength).toBe('empty');
  });

  it('traduz os erros do Supabase', () => {
    expect(passwordErrorMessage({ code: 'same_password' })).toBe('A nova senha precisa ser diferente da atual.');
    expect(passwordErrorMessage({ code: 'weak_password', message: 'Password should be at least 6 characters' })).toMatch(/fraca/);
    expect(passwordErrorMessage({ code: 'reauthentication_needed' })).toMatch(/saia e entre/);
    expect(passwordErrorMessage({ message: 'Algo novo' })).toBe('Algo novo');
    expect(passwordErrorMessage(null)).toMatch(/Não foi possível/);
  });
});
