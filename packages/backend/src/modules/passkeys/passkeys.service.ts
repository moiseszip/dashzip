import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { PasskeysRepository, type StoredCredential } from './passkeys.repository';

/**
 * Passkeys (WebAuthn) como segundo fator, feitas no backend porque o MFA
 * nativo do Supabase hospedado não aceita WebAuthn.
 * Doc: docs/features/30-settings/settings.md, seção "Passkeys".
 *
 * Nada aqui vai para log: desafio, credencial, chave pública e token ficam
 * só no banco e na resposta.
 */

/**
 * Domínio da passkey, por instância. `APP_URL` é o endereço público do painel;
 * `PASSKEY_RP_ID` (opcional) usa o domínio-pai, para a mesma passkey valer em
 * mais de um subdomínio listado em `PASSKEY_ORIGINS` (opcional, por vírgula).
 */
export interface PasskeySettings {
  rpID: string | null;
  origins: string[];
}

const cleanOrigin = (value: string) => {
  try { return new URL(value.trim()).origin; } catch { return null; }
};

export function passkeySettings(env: { appUrl?: string; rpId?: string; origins?: string }): PasskeySettings {
  const origins = [env.appUrl, ...(env.origins ?? '').split(',')]
    .map((value) => (value ? cleanOrigin(value) : null))
    .filter((value): value is string => !!value);
  const unique = [...new Set(origins)];
  const rpID = env.rpId?.trim() || (unique[0] ? new URL(unique[0]).hostname : null);
  // O rpID precisa ser o host de cada origem ou um domínio-pai dele.
  const valid = unique.filter((origin) => rpID && (new URL(origin).hostname === rpID || new URL(origin).hostname.endsWith(`.${rpID}`)));
  return { rpID: valid.length ? rpID : null, origins: valid };
}

export const RP_NAME = 'dash.zip';

/** Desafio vale 5 minutos e uma vez só. */
export const CHALLENGE_TTL_MS = 5 * 60_000;
/** Tempo que o navegador espera o Face ID, a digital ou a chave. */
export const CEREMONY_TIMEOUT_MS = 120_000;
export const ATTEMPT_WINDOW_MS = 15 * 60_000;
/** Respostas erradas de passkey na janela antes de travar. */
export const MAX_FAILURES = 5;
/** Desafios pedidos na janela (cadastro + login) antes de travar. */
export const MAX_CHALLENGES = 30;
export const MAX_PASSKEYS = 10;

const LOCALHOST_ORIGIN = /^http:\/\/localhost(?::\d{1,5})?$/;

export interface RelyingParty {
  rpID: string;
  origin: string;
}

/**
 * Domínio e origem da cerimônia. Só aceita as origens da instância (APP_URL e
 * PASSKEY_ORIGINS). Em dev local (fora da Vercel) aceita http://localhost:<porta>.
 * Origem desconhecida cai na principal, e a verificação recusa.
 */
export function resolveRelyingParty(origin: string | undefined, allowLocalhost: boolean, settings: PasskeySettings): RelyingParty {
  if (allowLocalhost && origin && LOCALHOST_ORIGIN.test(origin)) return { rpID: 'localhost', origin };
  if (!settings.rpID || !settings.origins.length) {
    throw new ServiceUnavailableException('Passkeys indisponíveis: defina APP_URL com o endereço do painel.');
  }
  if (origin && settings.origins.includes(origin)) return { rpID: settings.rpID, origin };
  return { rpID: settings.rpID, origin: settings.origins[0] };
}

/** Nome do dispositivo: sem espaços sobrando, de 1 a 60 caracteres. */
export function cleanPasskeyName(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

export interface PasskeySummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  deviceType: string | null;
  backedUp: boolean;
}

function summary(row: StoredCredential): PasskeySummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    deviceType: row.device_type,
    backedUp: row.backed_up,
  };
}

interface AuthUser {
  id: string;
  email?: string | null;
  factors?: { status?: string; factor_type?: string }[] | null;
}

class TooManyAttempts extends HttpException {
  constructor() {
    super('Muitas tentativas com passkey. Espere 15 minutos ou use o código do app.', HttpStatus.TOO_MANY_REQUESTS);
  }
}

const INVALID = 'Não foi possível confirmar a passkey. Tente de novo.';
const EXPIRED = 'O pedido expirou. Toque no botão de novo.';

@Injectable()
export class PasskeysService {
  private readonly allowLocalhost: boolean;
  private readonly settings: PasskeySettings;

  constructor(private readonly repo: PasskeysRepository, config: ConfigService) {
    // Na Vercel (produção) nunca aceita localhost.
    this.allowLocalhost = config.get<string>('VERCEL') !== '1';
    this.settings = passkeySettings({
      appUrl: config.get<string>('APP_URL'),
      rpId: config.get<string>('PASSKEY_RP_ID'),
      origins: config.get<string>('PASSKEY_ORIGINS'),
    });
  }

  rp(origin: string | undefined) {
    return resolveRelyingParty(origin, this.allowLocalhost, this.settings);
  }

  async status(userId: string, sessionId: string) {
    const state = await this.repo.sessionState(userId, sessionId);
    return { hasPasskeys: state.hasPasskeys, elevated: state.elevated };
  }

  async list(userId: string): Promise<PasskeySummary[]> {
    return (await this.repo.listCredentials(userId)).map(summary);
  }

  private async guardChallengeRate(userId: string, now: Date) {
    const since = new Date(now.getTime() - ATTEMPT_WINDOW_MS).toISOString();
    const [issued, failures] = await Promise.all([
      this.repo.countChallengesSince(userId, since),
      this.repo.countFailuresSince(userId, since),
    ]);
    if (issued >= MAX_CHALLENGES || failures >= MAX_FAILURES) throw new TooManyAttempts();
    // Faxina: desafios com mais de um dia não servem para nada.
    await this.repo.purgeChallenges(userId, new Date(now.getTime() - 86_400_000).toISOString()).catch(() => undefined);
  }

  /** Opções para cadastrar uma passkey nova (sessão já com o segundo fator, se houver). */
  async registrationOptions(user: AuthUser, sessionId: string, origin: string | undefined, now = new Date()) {
    await this.guardChallengeRate(user.id, now);
    const existing = await this.repo.listCredentials(user.id);
    if (existing.length >= MAX_PASSKEYS) {
      throw new BadRequestException(`Limite de ${MAX_PASSKEYS} passkeys. Remova uma antes de adicionar outra.`);
    }
    const rp = this.rp(origin);
    const label = user.email || 'dash.zip';
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: rp.rpID,
      userName: label,
      userDisplayName: label,
      userID: new TextEncoder().encode(user.id),
      timeout: CEREMONY_TIMEOUT_MS,
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({ id: c.credential_id, transports: c.transports })),
      // Sem preferir tipo de autenticador: Face ID, Touch ID, Windows Hello,
      // celular por QR ou chave de segurança.
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
    const challengeId = await this.repo.insertChallenge({
      user_id: user.id,
      session_id: sessionId,
      kind: 'registration',
      challenge: options.challenge,
      rp_id: rp.rpID,
      origin: rp.origin,
      expires_at: new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString(),
    });
    return { challengeId, options };
  }

  /** Confere o cadastro, grava a credencial e eleva a sessão (como o TOTP faz ao ativar). */
  async registrationVerify(
    user: AuthUser, sessionId: string,
    input: { challengeId: string; name: string; response: RegistrationResponseJSON },
    now = new Date(),
  ): Promise<PasskeySummary> {
    const name = cleanPasskeyName(input.name);
    if (!name) throw new BadRequestException('Dê um nome para a passkey (ex.: iPhone pessoal).');
    const challenge = await this.repo.consumeChallenge({
      id: input.challengeId, userId: user.id, sessionId, kind: 'registration', nowIso: now.toISOString(),
    });
    if (!challenge) throw new BadRequestException(EXPIRED);

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: input.response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: challenge.origin,
        expectedRPID: challenge.rp_id,
        requireUserVerification: false,
      });
    } catch {
      verification = null;
    }
    if (!verification?.verified) {
      await this.repo.finishChallenge(challenge.id, false);
      throw new BadRequestException(INVALID);
    }
    const info = verification.registrationInfo;
    let row: StoredCredential;
    try {
      row = await this.repo.insertCredential({
        user_id: user.id,
        credential_id: info.credential.id,
        public_key: Buffer.from(info.credential.publicKey).toString('base64url'),
        counter: info.credential.counter,
        transports: info.credential.transports ?? input.response.response?.transports ?? [],
        device_type: info.credentialDeviceType,
        backed_up: info.credentialBackedUp,
        name,
      });
    } catch (error) {
      await this.repo.finishChallenge(challenge.id, false);
      if ((error as { code?: string }).code === 'duplicate') throw new ConflictException('Esta passkey já está cadastrada.');
      throw error;
    }
    await this.repo.finishChallenge(challenge.id, true);
    await this.repo.elevateSession(sessionId, user.id, row.id);
    return summary(row);
  }

  /** Opções para o login (ou para confirmar uma remoção) com passkey. */
  async authenticationOptions(user: AuthUser, sessionId: string, origin: string | undefined, now = new Date()) {
    await this.guardChallengeRate(user.id, now);
    const existing = await this.repo.listCredentials(user.id);
    if (existing.length === 0) throw new NotFoundException('Nenhuma passkey cadastrada nesta conta.');
    const rp = this.rp(origin);
    const options = await generateAuthenticationOptions({
      rpID: rp.rpID,
      timeout: CEREMONY_TIMEOUT_MS,
      userVerification: 'preferred',
      allowCredentials: existing.map((c) => ({ id: c.credential_id, transports: c.transports })),
    });
    const challengeId = await this.repo.insertChallenge({
      user_id: user.id,
      session_id: sessionId,
      kind: 'authentication',
      challenge: options.challenge,
      rp_id: rp.rpID,
      origin: rp.origin,
      expires_at: new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString(),
    });
    return { challengeId, options };
  }

  /** Confere a assinatura com a chave guardada e atualiza o contador. Não eleva. */
  private async verifyAssertion(
    user: AuthUser, sessionId: string,
    input: { challengeId: string; response: AuthenticationResponseJSON },
    now: Date,
  ): Promise<StoredCredential> {
    const since = new Date(now.getTime() - ATTEMPT_WINDOW_MS).toISOString();
    if ((await this.repo.countFailuresSince(user.id, since)) >= MAX_FAILURES) throw new TooManyAttempts();

    const challenge = await this.repo.consumeChallenge({
      id: input.challengeId, userId: user.id, sessionId, kind: 'authentication', nowIso: now.toISOString(),
    });
    if (!challenge) throw new BadRequestException(EXPIRED);

    const credentialId = typeof input.response?.id === 'string' ? input.response.id : '';
    const stored = credentialId ? await this.repo.findByCredentialId(user.id, credentialId) : null;
    let verification;
    if (stored) {
      try {
        verification = await verifyAuthenticationResponse({
          response: input.response,
          expectedChallenge: challenge.challenge,
          expectedOrigin: challenge.origin,
          expectedRPID: challenge.rp_id,
          credential: {
            id: stored.credential_id,
            publicKey: new Uint8Array(Buffer.from(stored.public_key, 'base64url')),
            counter: Number(stored.counter),
            transports: stored.transports as never,
          },
          requireUserVerification: false,
        });
      } catch {
        // Assinatura inválida, origem errada ou contador que voltou (clone).
        verification = null;
      }
    }
    if (!stored || !verification?.verified) {
      await this.repo.finishChallenge(challenge.id, false);
      throw new BadRequestException(INVALID);
    }
    await this.repo.finishChallenge(challenge.id, true);
    await this.repo.recordUse(stored.id, verification.authenticationInfo.newCounter, now.toISOString());
    return stored;
  }

  /** Segundo fator do login: assinatura válida eleva esta sessão. */
  async authenticationVerify(
    user: AuthUser, sessionId: string,
    input: { challengeId: string; response: AuthenticationResponseJSON },
    now = new Date(),
  ) {
    const stored = await this.verifyAssertion(user, sessionId, input, now);
    await this.repo.elevateSession(sessionId, user.id, stored.id);
    return { ok: true as const };
  }

  /**
   * Remove uma passkey. Se ela for o último segundo fator da conta (nenhuma
   * outra passkey e nenhum TOTP verificado), exige uma confirmação com passkey
   * feita agora, no mesmo pedido.
   */
  async remove(
    user: AuthUser, sessionId: string, id: string,
    confirmation: { challengeId?: string; response?: AuthenticationResponseJSON },
    now = new Date(),
  ) {
    const all = await this.repo.listCredentials(user.id);
    const target = all.find((c) => c.id === id);
    if (!target) throw new NotFoundException('Passkey não encontrada.');
    const totp = (user.factors ?? []).some((f) => f?.status === 'verified');
    const last = all.length === 1 && !totp;
    if (last) {
      if (!confirmation.challengeId || !confirmation.response) {
        throw new ForbiddenException('Confirme com a passkey para remover o último segundo fator.');
      }
      await this.verifyAssertion(user, sessionId, { challengeId: confirmation.challengeId, response: confirmation.response }, now);
    }
    const removed = await this.repo.deleteCredential(user.id, id);
    if (!removed) throw new NotFoundException('Passkey não encontrada.');
    return { ok: true as const, lastFactorRemoved: last };
  }
}
