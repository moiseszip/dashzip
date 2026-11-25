import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isFresh, isLastFactor, passkeyErrorMessage, passkeysSupported, prepareAuthentication, prepareRegistration,
  registerPasskey, removePasskey, verifyPasskeyLogin, PREPARED_MAX_AGE_MS, type Passkey,
} from './passkeys';
import { secondFactorState } from './mfa';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession: vi.fn() } } }));

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// PublicKeyCredential e navigator.credentials simulados (o jsdom não tem).
class FakePublicKeyCredential {}
const credentials = { create: vi.fn(), get: vi.fn() };

function fakeAssertion() {
  return {
    id: 'cred-1',
    rawId: enc('cred-1'),
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {
      authenticatorData: enc('auth-data'),
      clientDataJSON: enc('{"type":"webauthn.get"}'),
      signature: enc('assinatura'),
      userHandle: enc('user'),
    },
    getClientExtensionResults: () => ({}),
  };
}

function fakeAttestation() {
  return {
    id: 'cred-1',
    rawId: enc('cred-1'),
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {
      attestationObject: enc('att'),
      clientDataJSON: enc('{"type":"webauthn.create"}'),
      getTransports: () => ['internal', 'hybrid'],
      getPublicKeyAlgorithm: () => -7,
      getPublicKey: () => enc('pk'),
      getAuthenticatorData: () => enc('auth-data'),
    },
    getClientExtensionResults: () => ({}),
  };
}

function http() {
  return {
    get: vi.fn(),
    post: vi.fn(async (path: string): Promise<any> => {
      if (path === '/passkeys/authentication/options') {
        return { challengeId: 'ch-a', options: { challenge: b64url('desafio'), rpId: 'painel.exemplo.com.br', timeout: 120000, allowCredentials: [{ id: b64url('cred-1'), type: 'public-key' }] } };
      }
      if (path === '/passkeys/registration/options') {
        return {
          challengeId: 'ch-r',
          options: {
            challenge: b64url('desafio'), rp: { id: 'painel.exemplo.com.br', name: 'dash.zip' },
            user: { id: b64url('u1'), name: 'p@x.com', displayName: 'p@x.com' },
            pubKeyCredParams: [{ alg: -7, type: 'public-key' }], timeout: 120000,
          },
        };
      }
      if (path === '/passkeys/registration/verify') return { id: 'pk1', name: 'iPhone', createdAt: '2026-11-23T00:00:00Z', lastUsedAt: null };
      return { ok: true };
    }),
  };
}

beforeEach(() => {
  vi.stubGlobal('PublicKeyCredential', FakePublicKeyCredential);
  Object.defineProperty(navigator, 'credentials', { value: credentials, configurable: true });
  credentials.create.mockReset();
  credentials.get.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('passkeys (navegador simulado)', () => {
  it('detecta suporte pelo PublicKeyCredential', () => {
    expect(passkeysSupported()).toBe(true);
    vi.stubGlobal('PublicKeyCredential', undefined);
    expect(passkeysSupported()).toBe(false);
  });

  it('desafio preparado vale até 4 minutos', () => {
    expect(isFresh({ preparedAt: 1000 }, 1000 + PREPARED_MAX_AGE_MS - 1)).toBe(true);
    expect(isFresh({ preparedAt: 1000 }, 1000 + PREPARED_MAX_AGE_MS)).toBe(false);
    expect(isFresh(null)).toBe(false);
  });

  it('login: assina o desafio preparado e manda ao servidor', async () => {
    const h = http();
    credentials.get.mockResolvedValue(fakeAssertion());
    const prepared = await prepareAuthentication(h);
    await verifyPasskeyLogin(prepared, h);

    const call = credentials.get.mock.calls[0][0];
    expect(new Uint8Array(call.publicKey.challenge)).toEqual(new Uint8Array(enc('desafio')));
    expect(call.publicKey.rpId).toBe('painel.exemplo.com.br');
    expect(h.post).toHaveBeenLastCalledWith('/passkeys/authentication/verify', expect.objectContaining({
      challengeId: 'ch-a',
      response: expect.objectContaining({ id: 'cred-1', rawId: b64url('cred-1'), type: 'public-key' }),
    }));
  });

  it('cadastro: cria a credencial e grava com o nome', async () => {
    const h = http();
    credentials.create.mockResolvedValue(fakeAttestation());
    const prepared = await prepareRegistration(h);
    const saved = await registerPasskey(prepared, '  iPhone  ', h);
    expect(saved.name).toBe('iPhone');
    const call = credentials.create.mock.calls[0][0];
    expect(call.publicKey.rp.id).toBe('painel.exemplo.com.br');
    expect(h.post).toHaveBeenLastCalledWith('/passkeys/registration/verify', expect.objectContaining({
      challengeId: 'ch-r', name: 'iPhone', response: expect.objectContaining({ id: 'cred-1' }),
    }));
  });

  it('cancelado no Face ID não chama o servidor e explica', async () => {
    const h = http();
    credentials.get.mockRejectedValue(Object.assign(new Error('The operation either timed out or was not allowed.'), { name: 'NotAllowedError' }));
    const prepared = await prepareAuthentication(h);
    const error = await verifyPasskeyLogin(prepared, h).catch((e) => e);
    expect(h.post).not.toHaveBeenCalledWith('/passkeys/authentication/verify', expect.anything());
    expect(passkeyErrorMessage(error)).toMatch(/cancelada/);
  });

  it('mensagens: tempo esgotado, sem suporte, já cadastrada, domínio, limite e servidor', () => {
    expect(passkeyErrorMessage({ name: 'NotAllowedError', elapsedMs: 119_000, timeoutMs: 120_000 })).toMatch(/tempo/);
    expect(passkeyErrorMessage(new Error('WebAuthn is not supported in this browser'))).toMatch(/não suporta/);
    expect(passkeyErrorMessage({ name: 'InvalidStateError' })).toMatch(/já está cadastrada/);
    expect(passkeyErrorMessage({ code: 'ERROR_INVALID_RP_ID' })).toMatch(/endereço oficial/);
    expect(passkeyErrorMessage({ status: 429, message: 'ThrottlerException: Too Many Requests' })).toMatch(/Muitas tentativas/);
    expect(passkeyErrorMessage({ status: 429, message: 'Muitas tentativas com passkey. Espere 15 minutos.' })).toMatch(/15 minutos/);
    expect(passkeyErrorMessage({ status: 400, message: 'O pedido expirou. Toque no botão de novo.' })).toMatch(/expirou/);
  });

  it('último fator e remoção com confirmação', async () => {
    const one: Passkey[] = [{ id: 'a', name: 'A', createdAt: '', lastUsedAt: null, deviceType: null, backedUp: false }];
    expect(isLastFactor(one, false)).toBe(true);
    expect(isLastFactor(one, true)).toBe(false);
    expect(isLastFactor([...one, { ...one[0], id: 'b' }], false)).toBe(false);
    const h = http();
    await removePasskey('a', undefined, h);
    expect(h.post).toHaveBeenLastCalledWith('/passkeys/a/remove', {});
  });
});

describe('secondFactorState (TOTP + passkey)', () => {
  const auth = (currentLevel: string, nextLevel: string) => ({
    mfa: { getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({ data: { currentLevel, nextLevel }, error: null }) },
  }) as never;

  it('só passkey: pede até a sessão ser elevada', async () => {
    expect(await secondFactorState(auth('aal1', 'aal1'), async () => ({ hasPasskeys: true, elevated: false })))
      .toEqual({ required: true, totp: false, passkey: true });
    expect((await secondFactorState(auth('aal1', 'aal1'), async () => ({ hasPasskeys: true, elevated: true }))).required).toBe(false);
  });

  it('TOTP + passkey: qualquer um dos dois libera', async () => {
    expect(await secondFactorState(auth('aal1', 'aal2'), async () => ({ hasPasskeys: true, elevated: false })))
      .toEqual({ required: true, totp: true, passkey: true });
    expect((await secondFactorState(auth('aal2', 'aal2'), async () => ({ hasPasskeys: true, elevated: false }))).required).toBe(false);
    expect((await secondFactorState(auth('aal1', 'aal2'), async () => ({ hasPasskeys: true, elevated: true }))).required).toBe(false);
  });

  it('backend fora do ar: decide pelo TOTP', async () => {
    const down = async () => { throw new Error('rede'); };
    expect((await secondFactorState(auth('aal1', 'aal2'), down)).required).toBe(true);
    expect((await secondFactorState(auth('aal1', 'aal1'), down)).required).toBe(false);
  });

  it('sem fator nenhum: não pede', async () => {
    expect((await secondFactorState(auth('aal1', 'aal1'), async () => ({ hasPasskeys: false, elevated: false }))).required).toBe(false);
  });
});
