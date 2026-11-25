/**
 * Regras da troca de senha em Configurações > Conta. Mínimo de 8 caracteres
 * (bloqueia); senha fraca só avisa. Doc: docs/features/30-settings/settings.md.
 */

export const MIN_PASSWORD_LENGTH = 8;

const COMMON = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1', 'senha123', 'senha1234', 'qwerty123', 'qwertyui',
  '11111111', '00000000', 'abcd1234', 'iloveyou', 'admin123', 'brasil123', 'mudar123', 'dashzip1', 'dashzip123',
]);

export type PasswordStrength = 'empty' | 'weak' | 'fair' | 'strong';

export interface StrengthResult {
  strength: PasswordStrength;
  /** 0–4, para a barrinha. */
  score: number;
  hints: string[];
}

/** Força estimada: tamanho, variedade de caracteres, senhas comuns e o próprio e-mail. */
export function passwordStrength(password: string, email?: string | null): StrengthResult {
  if (!password) return { strength: 'empty', score: 0, hints: [] };
  const hints: string[] = [];
  const lower = password.toLowerCase();
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  let score = 0;
  if (password.length >= MIN_PASSWORD_LENGTH) score++;
  if (password.length >= 12) score++;
  if (kinds >= 3) score++;
  if (password.length >= 16 || (kinds === 4 && password.length >= 10)) score++;

  if (password.length < 12) hints.push('Use 12 caracteres ou mais.');
  if (kinds < 3) hints.push('Misture maiúsculas, minúsculas, números e símbolos.');
  const emailName = email?.split('@')[0]?.toLowerCase();
  const common = COMMON.has(lower) || /^(.)\1+$/.test(password) || /^(0123|1234|abcd|qwer)/i.test(password);
  const hasEmail = !!emailName && emailName.length >= 3 && lower.includes(emailName);
  if (common) hints.unshift('Essa senha é muito comum.');
  if (hasEmail) hints.unshift('Não use o seu e-mail na senha.');
  if (common || hasEmail) score = Math.min(score, 1);

  const strength: PasswordStrength = score <= 1 ? 'weak' : score === 2 ? 'fair' : 'strong';
  return { strength, score, hints };
}

export interface PasswordChangeInput {
  current: string;
  next: string;
  confirm: string;
}

export type PasswordChangeErrors = Partial<Record<keyof PasswordChangeInput, string>>;

/** Erros que impedem salvar. Senha fraca não entra aqui: só avisa. */
export function validatePasswordChange({ current, next, confirm }: PasswordChangeInput): PasswordChangeErrors {
  const errors: PasswordChangeErrors = {};
  if (!current) errors.current = 'Digite a senha atual.';
  if (!next) errors.next = 'Digite a nova senha.';
  else if (next.length < MIN_PASSWORD_LENGTH) errors.next = `Use pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  else if (next.trim() !== next) errors.next = 'Tire os espaços do começo e do fim.';
  else if (current && next === current) errors.next = 'A nova senha precisa ser diferente da atual.';
  if (!confirm) errors.confirm = 'Repita a nova senha.';
  else if (next && confirm !== next) errors.confirm = 'As senhas não batem.';
  return errors;
}

/** Mensagem clara para os erros do Supabase Auth na troca de senha. */
export function passwordErrorMessage(error: { code?: string; message?: string } | null | undefined): string {
  const code = error?.code ?? '';
  const message = error?.message ?? '';
  if (code === 'same_password' || /different from the old/i.test(message)) return 'A nova senha precisa ser diferente da atual.';
  if (code === 'weak_password' || /weak|at least/i.test(message)) return 'O Supabase recusou a senha por ser fraca. Use uma mais longa, com letras, números e símbolos.';
  if (code === 'reauthentication_needed' || /reauthenticat/i.test(message)) return 'Por segurança, saia e entre de novo antes de trocar a senha.';
  if (code === 'insufficient_aal' || /aal2/i.test(message)) return 'Confirme o código de dois fatores (saia e entre de novo) antes de trocar a senha.';
  if (code === 'over_request_rate_limit' || /rate limit/i.test(message)) return 'Muitas tentativas. Espere alguns minutos e tente de novo.';
  return message || 'Não foi possível trocar a senha. Tente de novo.';
}
