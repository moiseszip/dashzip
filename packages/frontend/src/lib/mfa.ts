import type { AuthClient } from '@supabase/auth-js';

/**
 * Autenticação em dois fatores (TOTP) com o MFA nativo do Supabase Auth.
 * Funções puras sobre o cliente de auth, para testar com mock.
 * Doc: docs/features/30-settings/settings.md.
 */

type Auth = InstanceType<typeof AuthClient>;

export interface TotpFactor {
  id: string;
  friendlyName: string | null;
  status: 'verified' | 'unverified';
  createdAt: string;
}

export interface Enrollment {
  factorId: string;
  /** SVG em data URI, pronto para <img>. */
  qrCode: string;
  /** Chave para digitar no app quando não der para ler o QR. */
  secret: string;
  uri: string;
}

export const TOTP_ISSUER = 'dash.zip';

/** Seis dígitos, aceitando espaço no meio ("123 456"). */
export function normalizeTotpCode(code: string): string {
  return code.replace(/\s+/g, '');
}

export function isValidTotpCode(code: string): boolean {
  return /^\d{6}$/.test(normalizeTotpCode(code));
}

/** Chave em grupos de 4 para ler e digitar com menos erro. */
export function formatSecret(secret: string): string {
  return secret.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
}

/** A sessão precisa subir para aal2? Só quando há fator verificado e ela ainda é aal1. */
export async function needsSecondFactor(auth: Auth): Promise<boolean> {
  const { data, error } = await auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return false;
  return data.nextLevel === 'aal2' && data.currentLevel !== 'aal2';
}

export interface SecondFactorState {
  /** Falta o segundo fator nesta sessão. */
  required: boolean;
  /** TOTP verificado no Supabase. */
  totp: boolean;
  /** Passkey cadastrada no backend. */
  passkey: boolean;
}

/**
 * TOTP (Supabase, aal2) e passkey (backend, sessão elevada) convivem: com
 * qualquer um ativo, a sessão só passa depois de um dos dois.
 * Se o backend não responder, decide só pelo TOTP; o backend continua
 * recusando a sessão sem passkey confirmada.
 */
export async function secondFactorState(
  auth: Auth,
  fetchPasskeyStatus: () => Promise<{ hasPasskeys: boolean; elevated: boolean }>,
): Promise<SecondFactorState> {
  const { data, error } = await auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return { required: false, totp: false, passkey: false };
  const totp = data.nextLevel === 'aal2';
  const status = await fetchPasskeyStatus().catch(() => null);
  const passkey = !!status?.hasPasskeys;
  if (data.currentLevel === 'aal2') return { required: false, totp, passkey };
  if (!status) return { required: totp, totp, passkey: false };
  return { required: (totp || passkey) && !status.elevated, totp, passkey };
}

export async function listTotpFactors(auth: Auth): Promise<TotpFactor[]> {
  const { data, error } = await auth.mfa.listFactors();
  if (error) throw error;
  return (data?.all ?? [])
    .filter((factor) => factor.factor_type === 'totp')
    .map((factor) => ({
      id: factor.id,
      friendlyName: factor.friendly_name ?? null,
      status: factor.status as TotpFactor['status'],
      createdAt: factor.created_at,
    }));
}

/**
 * Começa a ativação: apaga tentativas anteriores não confirmadas (o Supabase
 * recusa nome repetido e limita a quantidade) e cria um fator novo.
 */
export async function startTotpEnrollment(auth: Auth, now = new Date()): Promise<Enrollment> {
  const factors = await listTotpFactors(auth);
  for (const factor of factors.filter((f) => f.status === 'unverified')) {
    await auth.mfa.unenroll({ factorId: factor.id });
  }
  const { data, error } = await auth.mfa.enroll({
    factorType: 'totp',
    issuer: TOTP_ISSUER,
    friendlyName: `${TOTP_ISSUER} ${now.toISOString().slice(0, 16)}`,
  });
  if (error || !data) throw error ?? new Error('Não foi possível iniciar a ativação.');
  const totp = (data as { totp?: { qr_code: string; secret: string; uri: string } }).totp;
  if (!totp) throw new Error('O Supabase não devolveu o QR code.');
  return { factorId: data.id, qrCode: svgDataUri(totp.qr_code), secret: totp.secret, uri: totp.uri };
}

/**
 * O supabase-js devolve `data:image/svg+xml;utf-8,<svg…>` com o SVG cru: um
 * "#" de cor no meio vira fragmento de URL e quebra a imagem. Reescreve com o
 * SVG codificado.
 */
export function svgDataUri(qrCode: string): string {
  const match = qrCode.match(/^data:image\/svg\+xml;(?:utf-8|charset=utf-8),([\s\S]*)$/i);
  if (!match || !match[1].trimStart().startsWith('<')) return qrCode;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(match[1])}`;
}

/** Desafio + verificação com o código do app. Sobe a sessão para aal2. */
export async function verifyTotp(auth: Auth, factorId: string, code: string): Promise<void> {
  const { error } = await auth.mfa.challengeAndVerify({ factorId, code: normalizeTotpCode(code) });
  if (error) throw error;
}

/** Confirma a ativação com o primeiro código do app. */
export const confirmTotpEnrollment = verifyTotp;

/** Código do login: usa o primeiro fator TOTP verificado da conta. */
export async function verifyLoginCode(auth: Auth, code: string): Promise<void> {
  const factor = (await listTotpFactors(auth)).find((f) => f.status === 'verified');
  if (!factor) throw new Error('Nenhum fator de dois fatores ativo nesta conta.');
  await verifyTotp(auth, factor.id, code);
}

/** Desativa: exige um código válido antes de remover o fator. */
export async function disableTotp(auth: Auth, factorId: string, code: string): Promise<void> {
  await verifyTotp(auth, factorId, code);
  const { error } = await auth.mfa.unenroll({ factorId });
  if (error) throw error;
  // Token novo sem o fator: o backend para de exigir aal2.
  await auth.refreshSession().catch(() => undefined);
}

/** Mensagem clara para os erros do MFA. */
export function mfaErrorMessage(error: unknown): string {
  const { code = '', message = '' } = (error ?? {}) as { code?: string; message?: string };
  if (code === 'mfa_verification_failed' || /invalid totp|verification failed|invalid code/i.test(message)) {
    return 'Código inválido ou expirado. Confira o horário do celular e digite o código atual.';
  }
  if (code === 'mfa_totp_enroll_not_enabled' || code === 'mfa_totp_verify_not_enabled' || /mfa.*(disabled|not enabled)/i.test(message)) {
    return 'A autenticação em dois fatores está desligada no Supabase deste projeto.';
  }
  if (code === 'too_many_enrolled_mfa_factors') return 'Limite de fatores atingido. Remova um fator antes de criar outro.';
  if (code === 'mfa_challenge_expired') return 'O desafio expirou. Tente de novo.';
  if (code === 'insufficient_aal') return 'Confirme o código de dois fatores antes de continuar.';
  if (/rate limit/i.test(message)) return 'Muitas tentativas. Espere um pouco e tente de novo.';
  return message || 'Não foi possível concluir. Tente de novo.';
}
