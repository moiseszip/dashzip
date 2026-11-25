import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PasskeysCard, suggestDeviceName } from './PasskeysCard';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const mfa = vi.hoisted(() => ({ listFactors: vi.fn() }));
const refreshMfa = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({ api, MFA_REQUIRED_EVENT: 'dashzip:mfa-required' }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { mfa } } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ refreshMfa }) }));

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
class FakePublicKeyCredential {}
const credentials = { create: vi.fn(), get: vi.fn() };

const IPHONE = { id: 'pk1', name: 'iPhone pessoal', createdAt: '2026-11-20T12:00:00Z', lastUsedAt: null, deviceType: 'multiDevice', backedUp: true };

let stored: typeof IPHONE[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('PublicKeyCredential', FakePublicKeyCredential);
  Object.defineProperty(navigator, 'credentials', { value: credentials, configurable: true });
  stored = [IPHONE];
  mfa.listFactors.mockResolvedValue({ data: { all: [] }, error: null });
  api.get.mockImplementation(async () => stored);
  api.post.mockImplementation(async (path: string, body: any) => {
    if (path === '/passkeys/registration/options') {
      return {
        challengeId: 'ch-r',
        options: {
          challenge: b64url('desafio'), rp: { id: 'painel.exemplo.com.br', name: 'dash.zip' },
          user: { id: b64url('u1'), name: 'p@x.com', displayName: 'p@x.com' }, pubKeyCredParams: [{ alg: -7, type: 'public-key' }], timeout: 120000,
        },
      };
    }
    if (path === '/passkeys/authentication/options') {
      return { challengeId: 'ch-a', options: { challenge: b64url('desafio'), rpId: 'painel.exemplo.com.br', timeout: 120000 } };
    }
    if (path === '/passkeys/registration/verify') {
      const saved = { ...IPHONE, id: 'pk2', name: body.name };
      stored = [...stored, saved];
      return saved;
    }
    if (path.endsWith('/remove')) {
      stored = stored.filter((p) => !path.includes(p.id));
      return { ok: true, lastFactorRemoved: stored.length === 0 };
    }
    throw new Error(`rota inesperada ${path}`);
  });
  credentials.create.mockResolvedValue({
    id: 'cred-2', rawId: enc('cred-2'), type: 'public-key', authenticatorAttachment: 'platform',
    response: { attestationObject: enc('att'), clientDataJSON: enc('{}'), getTransports: () => ['internal'] },
    getClientExtensionResults: () => ({}),
  });
  credentials.get.mockResolvedValue({
    id: 'cred-1', rawId: enc('cred-1'), type: 'public-key', authenticatorAttachment: 'platform',
    response: { authenticatorData: enc('a'), clientDataJSON: enc('{}'), signature: enc('s'), userHandle: null },
    getClientExtensionResults: () => ({}),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('Configurações > Passkeys', () => {
  it('sugere o nome pelo aparelho', () => {
    expect(suggestDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('iPhone');
    expect(suggestDeviceName('Mozilla/5.0 (Linux; Android 15)')).toBe('Android');
    expect(suggestDeviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows');
  });

  it('lista com nome e data e mostra o suporte do navegador', async () => {
    render(<PasskeysCard />);
    expect(await screen.findByText('iPhone pessoal')).toBeTruthy();
    expect(screen.getByText(/Criada em 20\/11\/2026/)).toBeTruthy();
    expect(screen.getByTestId('passkey-support').textContent).toMatch(/suporta passkey/);
  });

  it('sem PublicKeyCredential: avisa e não deixa adicionar', async () => {
    vi.stubGlobal('PublicKeyCredential', undefined);
    render(<PasskeysCard />);
    await screen.findByText('iPhone pessoal');
    expect(screen.getByTestId('passkey-support').textContent).toMatch(/não suporta/);
    expect((screen.getByRole('button', { name: /Adicionar passkey/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('adiciona com o nome do dispositivo (desafio buscado ao abrir)', async () => {
    render(<PasskeysCard />);
    await screen.findByText('iPhone pessoal');
    fireEvent.click(screen.getByRole('button', { name: /Adicionar passkey/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/passkeys/registration/options'));
    fireEvent.change(screen.getByLabelText('Nome do dispositivo'), { target: { value: 'MacBook' } });
    fireEvent.click(screen.getByRole('button', { name: /Criar passkey/ }));
    expect(await screen.findByText('MacBook')).toBeTruthy();
    expect(credentials.create).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/passkeys/registration/verify', expect.objectContaining({ challengeId: 'ch-r', name: 'MacBook' }));
    expect(refreshMfa).toHaveBeenCalled();
  });

  it('cancelado no Face ID: mensagem clara e diálogo continua aberto', async () => {
    credentials.create.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    render(<PasskeysCard />);
    await screen.findByText('iPhone pessoal');
    fireEvent.click(screen.getByRole('button', { name: /Adicionar passkey/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/passkeys/registration/options'));
    fireEvent.click(screen.getByRole('button', { name: /Criar passkey/ }));
    expect(await screen.findByText(/Confirmação cancelada/)).toBeTruthy();
    expect(api.post).not.toHaveBeenCalledWith('/passkeys/registration/verify', expect.anything());
  });

  it('remover a última passkey (sem TOTP) pede confirmação com a passkey', async () => {
    render(<PasskeysCard />);
    await screen.findByText('iPhone pessoal');
    fireEvent.click(screen.getByRole('button', { name: 'Remover iPhone pessoal' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/único segundo fator/)).toBeTruthy();
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/passkeys/authentication/options'));
    fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar com passkey e remover/ }));
    await waitFor(() => expect(screen.getByText('Nenhuma passkey cadastrada.')).toBeTruthy());
    expect(credentials.get).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/passkeys/pk1/remove', expect.objectContaining({ challengeId: 'ch-a', response: expect.objectContaining({ id: 'cred-1' }) }));
  });

  it('com TOTP ativo, remover só confirma (não é o último fator)', async () => {
    mfa.listFactors.mockResolvedValue({ data: { all: [{ id: 't', factor_type: 'totp', status: 'verified', created_at: '' }] }, error: null });
    render(<PasskeysCard />);
    await screen.findByText('iPhone pessoal');
    await waitFor(() => expect(mfa.listFactors).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Remover iPhone pessoal' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Remover$/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/passkeys/pk1/remove', {}));
    expect(credentials.get).not.toHaveBeenCalled();
  });
});
