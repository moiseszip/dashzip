import {
  browserSupportsWebAuthn, startAuthentication, startRegistration,
  type AuthenticationResponseJSON, type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON, type RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { api } from './api';

/**
 * Passkeys (WebAuthn) como segundo fator. A cerimônia é do backend
 * (`/api/passkeys`, @simplewebauthn/server); aqui ficam as chamadas e o
 * navegador (@simplewebauthn/browser). Doc: docs/features/30-settings/settings.md.
 *
 * Nada daqui vai para console: desafio, credencial e token não são logados.
 */

export interface Passkey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  deviceType: string | null;
  backedUp: boolean;
}

export interface PasskeyStatus {
  hasPasskeys: boolean;
  /** Esta sessão já confirmou a passkey (vale como aal2). */
  elevated: boolean;
}

interface Http {
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body?: unknown) => Promise<T>;
}

interface Browser {
  startRegistration: typeof startRegistration;
  startAuthentication: typeof startAuthentication;
}

const defaultHttp: Http = api;
const defaultBrowser: Browser = { startRegistration, startAuthentication };

/** O desafio do servidor vale 5 min; usa um preparado só até 4 min. */
export const PREPARED_MAX_AGE_MS = 4 * 60_000;

export interface PreparedRegistration {
  kind: 'registration';
  challengeId: string;
  options: PublicKeyCredentialCreationOptionsJSON;
  preparedAt: number;
}

export interface PreparedAuthentication {
  kind: 'authentication';
  challengeId: string;
  options: PublicKeyCredentialRequestOptionsJSON;
  preparedAt: number;
}

/** O navegador tem `PublicKeyCredential` e `navigator.credentials`? */
export function passkeysSupported(): boolean {
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
}

export function isFresh(prepared: { preparedAt: number } | null | undefined, now = Date.now()): boolean {
  return !!prepared && now - prepared.preparedAt < PREPARED_MAX_AGE_MS;
}

export function fetchPasskeyStatus(http: Http = defaultHttp) {
  return http.get<PasskeyStatus>('/passkeys/status');
}

export function listPasskeys(http: Http = defaultHttp) {
  return http.get<Passkey[]>('/passkeys');
}

/**
 * Busca o desafio antes do toque. O Safari (iPhone) só abre o Face ID se a
 * chamada ao navegador vier logo depois do toque; buscar o desafio no meio
 * gasta esse tempo. Por isso: prepara antes, toca, chama o navegador direto.
 */
export async function prepareRegistration(http: Http = defaultHttp, now = Date.now()): Promise<PreparedRegistration> {
  const { challengeId, options } = await http.post<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }>('/passkeys/registration/options');
  return { kind: 'registration', challengeId, options, preparedAt: now };
}

export async function prepareAuthentication(http: Http = defaultHttp, now = Date.now()): Promise<PreparedAuthentication> {
  const { challengeId, options } = await http.post<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }>('/passkeys/authentication/options');
  return { kind: 'authentication', challengeId, options, preparedAt: now };
}

/** Abre o autenticador e mede o tempo, para separar "cancelado" de "tempo esgotado". */
async function ceremony<T>(run: () => Promise<T>, timeoutMs: number | undefined): Promise<T> {
  const started = Date.now();
  try {
    return await run();
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      elapsedMs: Date.now() - started,
      timeoutMs: timeoutMs ?? 120_000,
    });
  }
}

/** Cadastra: Face ID / Touch ID / Windows Hello / chave, e grava no servidor com o nome. */
export async function registerPasskey(
  prepared: PreparedRegistration, name: string, http: Http = defaultHttp, browser: Browser = defaultBrowser,
): Promise<Passkey> {
  const response: RegistrationResponseJSON = await ceremony(
    () => browser.startRegistration({ optionsJSON: prepared.options }),
    prepared.options.timeout,
  );
  return http.post<Passkey>('/passkeys/registration/verify', { challengeId: prepared.challengeId, name: name.trim(), response });
}

/** Assina o desafio com a passkey (sem mandar ao servidor ainda). */
export async function signChallenge(
  prepared: PreparedAuthentication, browser: Browser = defaultBrowser,
): Promise<{ challengeId: string; response: AuthenticationResponseJSON }> {
  const response = await ceremony(
    () => browser.startAuthentication({ optionsJSON: prepared.options }),
    prepared.options.timeout,
  );
  return { challengeId: prepared.challengeId, response };
}

/** Segundo fator do login: assinatura válida eleva a sessão no servidor. */
export async function verifyPasskeyLogin(
  prepared: PreparedAuthentication, http: Http = defaultHttp, browser: Browser = defaultBrowser,
): Promise<void> {
  const signed = await signChallenge(prepared, browser);
  await http.post('/passkeys/authentication/verify', signed);
}

/** Remove; `confirmation` só é exigida quando é o último segundo fator. */
export function removePasskey(
  id: string, confirmation?: { challengeId: string; response: AuthenticationResponseJSON }, http: Http = defaultHttp,
) {
  return http.post<{ ok: true; lastFactorRemoved: boolean }>(`/passkeys/${id}/remove`, confirmation ?? {});
}

/** É o último segundo fator? (sem outra passkey e sem TOTP ativo) */
export function isLastFactor(passkeys: Passkey[], totpActive: boolean): boolean {
  return passkeys.length === 1 && !totpActive;
}

/** Mensagem clara para cancelado, sem suporte, tempo esgotado e erros do servidor. */
export function passkeyErrorMessage(error: unknown): string {
  const e = (error ?? {}) as {
    name?: string; code?: string; message?: string; status?: number; elapsedMs?: number; timeoutMs?: number;
  };
  if (e.status === 429) {
    return e.message && !/throttler|too many/i.test(e.message) ? e.message : 'Muitas tentativas. Espere alguns minutos e tente de novo.';
  }
  if (typeof e.status === 'number') return e.message || 'Não foi possível concluir. Tente de novo.';
  if (e.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' || e.name === 'InvalidStateError') {
    return 'Esta passkey já está cadastrada neste aparelho.';
  }
  if (e.code === 'ERROR_INVALID_DOMAIN' || e.code === 'ERROR_INVALID_RP_ID' || e.name === 'SecurityError') {
    return 'Passkey só funciona no endereço oficial do painel. Abra pelo domínio configurado da sua instância.';
  }
  if (e.name === 'NotSupportedError' || /does not support WebAuthn|WebAuthn is not supported/i.test(e.message ?? '')) {
    return 'Este navegador não suporta passkey. Use o código do app ou outro navegador.';
  }
  if (e.name === 'NotAllowedError' || e.name === 'AbortError' || e.code === 'ERROR_CEREMONY_ABORTED') {
    if (typeof e.elapsedMs === 'number' && typeof e.timeoutMs === 'number' && e.elapsedMs >= e.timeoutMs * 0.9) {
      return 'O tempo para confirmar acabou. Toque no botão e confirme de novo.';
    }
    return 'Confirmação cancelada. Toque no botão para tentar de novo.';
  }
  return 'Não foi possível usar a passkey. Tente de novo.';
}
