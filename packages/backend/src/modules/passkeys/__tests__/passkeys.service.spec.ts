import { HttpException, UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import {
  PasskeysService, resolveRelyingParty, passkeySettings, cleanPasskeyName, MAX_FAILURES, CHALLENGE_TTL_MS,
} from '../passkeys.service';
import {
  PasskeysRepository, type ChallengeKind, type NewChallenge, type NewCredential, type StoredCredential,
} from '../passkeys.repository';
import { AuthGuard, SessionGuard, needsSecondFactor, tokenSessionId, MFA_REQUIRED_MESSAGE } from '../../../common/guards/auth.guard';

// Cerimônia real precisa de autenticador; a verificação criptográfica é da
// biblioteca. Aqui se testa o que é nosso: desafio de uso único, sessão,
// limite de tentativas, contador, elevação e regra do último fator.
jest.mock('@simplewebauthn/server', () => {
  const actual = jest.requireActual('@simplewebauthn/server');
  return { ...actual, verifyRegistrationResponse: jest.fn(), verifyAuthenticationResponse: jest.fn() };
});
const mockedVerifyRegistration = verifyRegistrationResponse as jest.Mock;
const mockedVerifyAuthentication = verifyAuthenticationResponse as jest.Mock;

interface ChallengeRow extends NewChallenge { id: string; used_at: string | null; succeeded: boolean | null; created_at: string }

class MemoryRepo extends PasskeysRepository {
  challenges: ChallengeRow[] = [];
  credentials: StoredCredential[] = [];
  elevations = new Map<string, { userId: string; credentialId: string }>();
  private seq = 0;
  clock = () => new Date().toISOString();
  private id() {
    this.seq += 1;
    return `00000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`;
  }
  async countChallengesSince(userId: string, since: string) {
    return this.challenges.filter((c) => c.user_id === userId && c.created_at >= since).length;
  }
  async countFailuresSince(userId: string, since: string) {
    return this.challenges.filter((c) => c.user_id === userId && c.kind === 'authentication' && c.succeeded === false && (c.used_at ?? '') >= since).length;
  }
  async insertChallenge(row: NewChallenge) {
    const id = this.id();
    this.challenges.push({ ...row, id, used_at: null, succeeded: null, created_at: this.clock() });
    return id;
  }
  async consumeChallenge(q: { id: string; userId: string; sessionId: string; kind: ChallengeKind; nowIso: string }) {
    const c = this.challenges.find((x) => x.id === q.id && x.user_id === q.userId && x.session_id === q.sessionId
      && x.kind === q.kind && x.used_at === null && x.expires_at > q.nowIso);
    if (!c) return null;
    c.used_at = q.nowIso;
    return { id: c.id, challenge: c.challenge, rp_id: c.rp_id, origin: c.origin };
  }
  async finishChallenge(id: string, succeeded: boolean) {
    const c = this.challenges.find((x) => x.id === id);
    if (c) c.succeeded = succeeded;
  }
  async purgeChallenges() {}
  async listCredentials(userId: string) {
    return this.credentials.filter((c) => c.user_id === userId);
  }
  async findByCredentialId(userId: string, credentialId: string) {
    return this.credentials.find((c) => c.user_id === userId && c.credential_id === credentialId) ?? null;
  }
  async findById(userId: string, id: string) {
    return this.credentials.find((c) => c.user_id === userId && c.id === id) ?? null;
  }
  async insertCredential(row: NewCredential) {
    if (this.credentials.some((c) => c.credential_id === row.credential_id)) throw Object.assign(new Error('duplicate'), { code: 'duplicate' });
    const stored = { ...row, id: this.id(), created_at: this.clock(), last_used_at: null };
    this.credentials.push(stored);
    return stored;
  }
  async recordUse(id: string, counter: number, usedAt: string) {
    const c = this.credentials.find((x) => x.id === id)!;
    c.counter = counter;
    c.last_used_at = usedAt;
  }
  async deleteCredential(userId: string, id: string) {
    const before = this.credentials.length;
    this.credentials = this.credentials.filter((c) => !(c.user_id === userId && c.id === id));
    return this.credentials.length < before;
  }
  async elevateSession(sessionId: string, userId: string, credentialId: string) {
    this.elevations.set(sessionId, { userId, credentialId });
  }
  async sessionState(userId: string, sessionId: string) {
    return {
      hasPasskeys: this.credentials.some((c) => c.user_id === userId),
      elevated: this.elevations.get(sessionId)?.userId === userId,
    };
  }
}

const user = { id: '11111111-1111-4111-8111-111111111111', email: 'pessoa@exemplo.com', factors: [] as { status: string }[] };
const SESSION = '22222222-2222-4222-8222-222222222222';
const OTHER_SESSION = '33333333-3333-4333-8333-333333333333';
const PROD_ORIGIN = 'https://painel.exemplo.com.br';
const PROD_RP_ID = 'exemplo.com.br';
const ENV: Record<string, string> = { APP_URL: PROD_ORIGIN, PASSKEY_RP_ID: PROD_RP_ID, PASSKEY_ORIGINS: 'https://track.exemplo.com.br' };
const config = (vercel?: string) => ({ get: (k: string) => (k === 'VERCEL' ? vercel : ENV[k]) }) as unknown as ConfigService;

function registrationOk(id = 'cred-1') {
  mockedVerifyRegistration.mockResolvedValueOnce({
    verified: true,
    registrationInfo: {
      credential: { id, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal', 'hybrid'] },
      credentialDeviceType: 'multiDevice',
      credentialBackedUp: true,
    },
  });
}

async function register(service: PasskeysService, name = 'iPhone', id = 'cred-1', session = SESSION) {
  const { challengeId } = await service.registrationOptions(user, session, PROD_ORIGIN);
  registrationOk(id);
  return service.registrationVerify(user, session, { challengeId, name, response: { id, response: {} } as never });
}

describe('PasskeysService', () => {
  let repo: MemoryRepo;
  let service: PasskeysService;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new MemoryRepo();
    service = new PasskeysService(repo, config('1'));
  });

  it('rpID e origem: só as origens da instância; localhost só fora da Vercel', () => {
    const settings = passkeySettings({ appUrl: PROD_ORIGIN, rpId: PROD_RP_ID, origins: 'https://track.exemplo.com.br' });
    expect(resolveRelyingParty(PROD_ORIGIN, false, settings)).toEqual({ rpID: PROD_RP_ID, origin: PROD_ORIGIN });
    expect(resolveRelyingParty('https://track.exemplo.com.br', false, settings)).toEqual({ rpID: PROD_RP_ID, origin: 'https://track.exemplo.com.br' });
    expect(resolveRelyingParty('https://exemplo.com.br', false, settings)).toEqual({ rpID: PROD_RP_ID, origin: PROD_ORIGIN });
    expect(resolveRelyingParty('http://localhost:5173', true, settings)).toEqual({ rpID: 'localhost', origin: 'http://localhost:5173' });
    expect(resolveRelyingParty('http://localhost:5173', false, settings)).toEqual({ rpID: PROD_RP_ID, origin: PROD_ORIGIN });
    expect(resolveRelyingParty('https://evil.example', true, settings)).toEqual({ rpID: PROD_RP_ID, origin: PROD_ORIGIN });
    expect(resolveRelyingParty('http://localhost.evil.com', true, settings).rpID).toBe(PROD_RP_ID);
  });

  it('sem PASSKEY_RP_ID usa o host do APP_URL e descarta origem fora do domínio', () => {
    expect(passkeySettings({ appUrl: 'https://painel.cliente.com/' })).toEqual({ rpID: 'painel.cliente.com', origins: ['https://painel.cliente.com'] });
    expect(passkeySettings({ appUrl: 'https://painel.cliente.com', rpId: 'cliente.com', origins: 'https://outro.com' }).origins)
      .toEqual(['https://painel.cliente.com']);
    expect(() => resolveRelyingParty(PROD_ORIGIN, false, passkeySettings({}))).toThrow('APP_URL');
  });

  it('nome do dispositivo limpo e com limite', () => {
    expect(cleanPasskeyName('  iPhone   do\nOperador ')).toBe('iPhone do Operador');
    expect(cleanPasskeyName('x'.repeat(80))).toHaveLength(60);
  });

  it('opções de cadastro: rpID de produção, sem tipo de autenticador forçado, desafio guardado com validade curta', async () => {
    const now = new Date('2026-11-23T12:00:00Z');
    const { challengeId, options } = await service.registrationOptions(user, SESSION, PROD_ORIGIN, now);
    expect(options.rp.id).toBe(PROD_RP_ID);
    expect(options.authenticatorSelection?.authenticatorAttachment).toBeUndefined();
    expect(options.authenticatorSelection?.residentKey).toBe('preferred');
    const row = repo.challenges.find((c) => c.id === challengeId)!;
    expect(row.challenge).toBe(options.challenge);
    expect(new Date(row.expires_at).getTime() - now.getTime()).toBe(CHALLENGE_TTL_MS);
  });

  it('cadastro grava a credencial, eleva a sessão e confere origem e rpID', async () => {
    const saved = await register(service, '  iPhone 15 ');
    expect(saved.name).toBe('iPhone 15');
    expect(repo.credentials).toHaveLength(1);
    expect(repo.credentials[0].public_key).toBe(Buffer.from([1, 2, 3]).toString('base64url'));
    expect(repo.elevations.get(SESSION)?.userId).toBe(user.id);
    expect(mockedVerifyRegistration).toHaveBeenCalledWith(expect.objectContaining({ expectedOrigin: PROD_ORIGIN, expectedRPID: PROD_RP_ID }));
  });

  it('desafio é de uso único e da mesma sessão', async () => {
    const { challengeId } = await service.registrationOptions(user, SESSION, PROD_ORIGIN);
    registrationOk();
    await service.registrationVerify(user, SESSION, { challengeId, name: 'A', response: {} as never });
    await expect(service.registrationVerify(user, SESSION, { challengeId, name: 'B', response: {} as never })).rejects.toThrow('expirou');

    const other = await service.registrationOptions(user, SESSION, PROD_ORIGIN);
    await expect(service.registrationVerify(user, OTHER_SESSION, { challengeId: other.challengeId, name: 'C', response: {} as never })).rejects.toThrow('expirou');
  });

  it('desafio expirado é recusado', async () => {
    const now = new Date();
    const { challengeId } = await service.registrationOptions(user, SESSION, PROD_ORIGIN, now);
    const later = new Date(now.getTime() + CHALLENGE_TTL_MS + 1);
    await expect(service.registrationVerify(user, SESSION, { challengeId, name: 'A', response: {} as never }, later)).rejects.toThrow('expirou');
  });

  it('passkey repetida vira 409', async () => {
    await register(service, 'A', 'cred-1');
    await expect(register(service, 'B', 'cred-1')).rejects.toThrow('já está cadastrada');
  });

  it('login: assinatura válida eleva só esta sessão e atualiza o contador', async () => {
    await register(service, 'iPhone', 'cred-1', OTHER_SESSION);
    const { challengeId, options } = await service.authenticationOptions(user, SESSION, PROD_ORIGIN);
    expect(options.allowCredentials?.map((c) => c.id)).toEqual(['cred-1']);
    mockedVerifyAuthentication.mockResolvedValueOnce({ verified: true, authenticationInfo: { newCounter: 7 } });
    await expect(service.authenticationVerify(user, SESSION, { challengeId, response: { id: 'cred-1' } as never })).resolves.toEqual({ ok: true });
    expect(repo.elevations.has(SESSION)).toBe(true);
    expect(repo.credentials[0].counter).toBe(7);
    expect(repo.credentials[0].last_used_at).not.toBeNull();
  });

  it('login: credencial de outra conta ou assinatura inválida não eleva', async () => {
    await register(service, 'iPhone', 'cred-1', OTHER_SESSION);
    const a = await service.authenticationOptions(user, SESSION, PROD_ORIGIN);
    await expect(service.authenticationVerify(user, SESSION, { challengeId: a.challengeId, response: { id: 'de-outro' } as never })).rejects.toThrow('Não foi possível');
    expect(mockedVerifyAuthentication).not.toHaveBeenCalled();

    const b = await service.authenticationOptions(user, SESSION, PROD_ORIGIN);
    mockedVerifyAuthentication.mockRejectedValueOnce(new Error('counter went backwards'));
    await expect(service.authenticationVerify(user, SESSION, { challengeId: b.challengeId, response: { id: 'cred-1' } as never })).rejects.toThrow('Não foi possível');
    expect(repo.elevations.has(SESSION)).toBe(false);
  });

  it(`trava depois de ${MAX_FAILURES} falhas`, async () => {
    await register(service, 'iPhone', 'cred-1', OTHER_SESSION);
    for (let i = 0; i < MAX_FAILURES; i++) {
      const { challengeId } = await service.authenticationOptions(user, SESSION, PROD_ORIGIN);
      mockedVerifyAuthentication.mockResolvedValueOnce({ verified: false, authenticationInfo: { newCounter: 0 } });
      await expect(service.authenticationVerify(user, SESSION, { challengeId, response: { id: 'cred-1' } as never })).rejects.toThrow();
    }
    const error = await service.authenticationOptions(user, SESSION, PROD_ORIGIN).catch((e) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
  });

  it('sem passkey não há opções de login', async () => {
    await expect(service.authenticationOptions(user, SESSION, PROD_ORIGIN)).rejects.toThrow('Nenhuma passkey');
  });

  it('remover a última passkey (sem TOTP) exige confirmação com passkey', async () => {
    const saved = await register(service);
    await expect(service.remove(user, SESSION, saved.id, {})).rejects.toThrow('Confirme com a passkey');
    expect(repo.credentials).toHaveLength(1);

    const { challengeId } = await service.authenticationOptions(user, SESSION, PROD_ORIGIN);
    mockedVerifyAuthentication.mockResolvedValueOnce({ verified: true, authenticationInfo: { newCounter: 1 } });
    await expect(service.remove(user, SESSION, saved.id, { challengeId, response: { id: 'cred-1' } as never }))
      .resolves.toEqual({ ok: true, lastFactorRemoved: true });
    expect(repo.credentials).toHaveLength(0);
  });

  it('remover com outra passkey ou com TOTP ativo não pede confirmação', async () => {
    const first = await register(service, 'A', 'cred-1');
    await register(service, 'B', 'cred-2');
    await expect(service.remove(user, SESSION, first.id, {})).resolves.toEqual({ ok: true, lastFactorRemoved: false });

    const onlyOne = repo.credentials[0];
    const withTotp = { ...user, factors: [{ status: 'verified' }] };
    await expect(service.remove(withTotp, SESSION, onlyOne.id, {})).resolves.toEqual({ ok: true, lastFactorRemoved: false });
  });

  it('não remove passkey de outra conta', async () => {
    const saved = await register(service);
    const intruder = { id: '44444444-4444-4444-8444-444444444444', factors: [] };
    await expect(service.remove(intruder, SESSION, saved.id, {})).rejects.toThrow('não encontrada');
  });
});

describe('AuthGuard com passkey', () => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = (claims: object) => `${b64({ alg: 'none' })}.${b64(claims)}.sig`;
  const ctx = (token: string) => {
    const request: any = { headers: { authorization: `Bearer ${token}` } };
    return { request, context: { switchToHttp: () => ({ getRequest: () => request }) } as any };
  };
  const supabase = (state: { hasPasskeys: boolean; elevated: boolean } | Error, factors: { status: string }[] = []) => ({
    getUserFromToken: async () => ({ id: user.id, factors }),
    passkeySessionState: jest.fn(async () => {
      if (state instanceof Error) throw state;
      return state;
    }),
  }) as any;

  it('needsSecondFactor considera TOTP, passkey e elevação', () => {
    const aal1 = jwt({ aal: 'aal1', session_id: SESSION });
    expect(needsSecondFactor({}, aal1, { hasPasskeys: true, elevated: false })).toBe(true);
    expect(needsSecondFactor({}, aal1, { hasPasskeys: true, elevated: true })).toBe(false);
    expect(needsSecondFactor({ factors: [{ status: 'verified' }] }, aal1, { hasPasskeys: false, elevated: true })).toBe(false);
    expect(needsSecondFactor({}, jwt({ aal: 'aal2' }), { hasPasskeys: true, elevated: false })).toBe(false);
    expect(needsSecondFactor({}, aal1, { hasPasskeys: false, elevated: false })).toBe(false);
    expect(tokenSessionId(aal1)).toBe(SESSION);
    expect(tokenSessionId(jwt({ session_id: 'x' }))).toBeNull();
  });

  it('aal1 com passkey e sem elevação: 401 com a mensagem do segundo fator', async () => {
    const { context } = ctx(jwt({ aal: 'aal1', session_id: SESSION }));
    await expect(new AuthGuard(supabase({ hasPasskeys: true, elevated: false })).canActivate(context))
      .rejects.toThrow(new UnauthorizedException(MFA_REQUIRED_MESSAGE));
  });

  it('sessão elevada pela passkey passa, mesmo com TOTP na conta', async () => {
    const { context, request } = ctx(jwt({ aal: 'aal1', session_id: SESSION }));
    const sb = supabase({ hasPasskeys: true, elevated: true }, [{ status: 'verified' }]);
    await expect(new AuthGuard(sb).canActivate(context)).resolves.toBe(true);
    expect(sb.passkeySessionState).toHaveBeenCalledWith(user.id, SESSION);
    expect(request.sessionId).toBe(SESSION);
  });

  it('aal2 não consulta o banco', async () => {
    const sb = supabase({ hasPasskeys: true, elevated: false });
    await expect(new AuthGuard(sb).canActivate(ctx(jwt({ aal: 'aal2', session_id: SESSION })).context)).resolves.toBe(true);
    expect(sb.passkeySessionState).not.toHaveBeenCalled();
  });

  it('erro ao consultar a passkey fecha (503)', async () => {
    await expect(new AuthGuard(supabase(new Error('db'))).canActivate(ctx(jwt({ aal: 'aal1', session_id: SESSION })).context))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('SessionGuard aceita aal1 (para o passo da passkey) mas exige session_id', async () => {
    const sb = supabase({ hasPasskeys: true, elevated: false });
    await expect(new SessionGuard(sb).canActivate(ctx(jwt({ aal: 'aal1', session_id: SESSION })).context)).resolves.toBe(true);
    await expect(new SessionGuard(sb).canActivate(ctx(jwt({ aal: 'aal1' })).context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
