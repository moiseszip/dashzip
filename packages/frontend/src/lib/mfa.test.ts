import { describe, expect, it, vi } from 'vitest';
import {
  disableTotp, formatSecret, isValidTotpCode, listTotpFactors, mfaErrorMessage, needsSecondFactor, startTotpEnrollment,
  svgDataUri, verifyLoginCode, verifyTotp,
} from './mfa';

type AnyAuth = Parameters<typeof needsSecondFactor>[0];

function mockAuth(overrides: Record<string, unknown> = {}) {
  const factors = [
    { id: 'velho', factor_type: 'totp', status: 'unverified', friendly_name: 'dash.zip x', created_at: '2026-11-01T00:00:00Z' },
    { id: 'ativo', factor_type: 'totp', status: 'verified', friendly_name: 'dash.zip y', created_at: '2026-11-02T00:00:00Z' },
    { id: 'tel', factor_type: 'phone', status: 'verified', friendly_name: null, created_at: '2026-11-03T00:00:00Z' },
  ];
  const mfa = {
    getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null }),
    listFactors: vi.fn().mockResolvedValue({ data: { all: factors }, error: null }),
    unenroll: vi.fn().mockResolvedValue({ data: {}, error: null }),
    enroll: vi.fn().mockResolvedValue({
      data: { id: 'novo', type: 'totp', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: 'ABCDEFGHIJKLMNOP', uri: 'otpauth://totp/x' } },
      error: null,
    }),
    challengeAndVerify: vi.fn().mockResolvedValue({ data: {}, error: null }),
    ...overrides,
  };
  const auth = { mfa, refreshSession: vi.fn().mockResolvedValue({ data: {}, error: null }) };
  return { auth: auth as unknown as AnyAuth, mfa, raw: auth };
}

describe('2FA (TOTP)', () => {
  it('valida e normaliza o código de 6 dígitos', () => {
    expect(isValidTotpCode('123456')).toBe(true);
    expect(isValidTotpCode('123 456')).toBe(true);
    expect(isValidTotpCode('12345')).toBe(false);
    expect(isValidTotpCode('12a456')).toBe(false);
    expect(formatSecret('ABCDEFGHIJKLMNOP')).toBe('ABCD EFGH IJKL MNOP');
  });

  it('pede o código só quando há fator verificado e a sessão é aal1', async () => {
    const { auth, mfa } = mockAuth();
    await expect(needsSecondFactor(auth)).resolves.toBe(true);
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValueOnce({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null });
    await expect(needsSecondFactor(auth)).resolves.toBe(false);
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValueOnce({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null });
    await expect(needsSecondFactor(auth)).resolves.toBe(false);
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValueOnce({ data: null, error: new Error('x') });
    await expect(needsSecondFactor(auth)).resolves.toBe(false);
  });

  it('lista só os fatores TOTP', async () => {
    const { auth } = mockAuth();
    const list = await listTotpFactors(auth);
    expect(list.map((f) => f.id)).toEqual(['velho', 'ativo']);
  });

  it('ativação apaga tentativas não confirmadas e devolve QR e chave', async () => {
    const { auth, mfa } = mockAuth();
    const enrollment = await startTotpEnrollment(auth, new Date('2026-11-23T10:00:00Z'));
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'velho' });
    expect(mfa.unenroll).not.toHaveBeenCalledWith({ factorId: 'ativo' });
    expect(mfa.enroll).toHaveBeenCalledWith({ factorType: 'totp', issuer: 'dash.zip', friendlyName: 'dash.zip 2026-11-23T10:00' });
    expect(enrollment).toEqual({ factorId: 'novo', qrCode: 'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E', secret: 'ABCDEFGHIJKLMNOP', uri: 'otpauth://totp/x' });
  });

  it('confirma com challenge + verify e propaga código errado', async () => {
    const { auth, mfa } = mockAuth();
    await verifyTotp(auth, 'novo', '123 456');
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'novo', code: '123456' });
    mfa.challengeAndVerify.mockResolvedValueOnce({ data: null, error: { code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' } });
    await expect(verifyTotp(auth, 'novo', '000000')).rejects.toMatchObject({ code: 'mfa_verification_failed' });
  });

  it('no login usa o fator verificado', async () => {
    const { auth, mfa } = mockAuth();
    await verifyLoginCode(auth, '654321');
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'ativo', code: '654321' });
    mfa.listFactors.mockResolvedValueOnce({ data: { all: [] }, error: null });
    await expect(verifyLoginCode(auth, '654321')).rejects.toThrow(/Nenhum fator/);
  });

  it('desativar exige código válido antes do unenroll', async () => {
    const { auth, mfa, raw } = mockAuth();
    mfa.challengeAndVerify.mockResolvedValueOnce({ data: null, error: { code: 'mfa_verification_failed', message: 'x' } });
    await expect(disableTotp(auth, 'ativo', '000000')).rejects.toBeTruthy();
    expect(mfa.unenroll).not.toHaveBeenCalled();
    await disableTotp(auth, 'ativo', '111111');
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'ativo' });
    expect(raw.refreshSession).toHaveBeenCalled();
  });

  it('reescreve o QR com o SVG codificado (o # da cor quebrava o data URI)', () => {
    expect(svgDataUri('data:image/svg+xml;utf-8,<svg fill="#000"/>')).toBe('data:image/svg+xml;charset=utf-8,%3Csvg%20fill%3D%22%23000%22%2F%3E');
    expect(svgDataUri('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });

  it('mensagens claras', () => {
    expect(mfaErrorMessage({ code: 'mfa_verification_failed' })).toMatch(/Código inválido/);
    expect(mfaErrorMessage({ code: 'mfa_totp_enroll_not_enabled' })).toMatch(/desligada no Supabase/);
    expect(mfaErrorMessage({ message: 'outro' })).toBe('outro');
  });
});
