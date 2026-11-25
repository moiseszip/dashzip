import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Login from './Login';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const auth = vi.hoisted(() => ({
  user: { id: 'u1', email: 'p@x.com' },
  mfaRequired: true,
  mfaMethods: { totp: true, passkey: true },
  login: vi.fn(),
  verifyMfa: vi.fn(),
  verifyPasskey: vi.fn(),
  logout: vi.fn(),
}));
const navigate = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({ api, MFA_REQUIRED_EVENT: 'dashzip:mfa-required' }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => navigate }));

class FakePublicKeyCredential {}

function renderLogin() {
  return render(<MemoryRouter><Login /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('PublicKeyCredential', FakePublicKeyCredential);
  auth.mfaMethods = { totp: true, passkey: true };
  api.post.mockResolvedValue({ challengeId: 'ch-a', options: { challenge: 'ZGVzYWZpbw', rpId: 'painel.exemplo.com.br', timeout: 120000 } });
  auth.verifyPasskey.mockResolvedValue({ ok: true });
});

afterEach(() => vi.unstubAllGlobals());

describe('Login: segundo fator com passkey', () => {
  it('passkey é o padrão, desafio buscado antes do toque, e entra', async () => {
    renderLogin();
    const button = await screen.findByRole('button', { name: /Usar passkey/ });
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/passkeys/authentication/options'));
    fireEvent.click(button);
    await waitFor(() => expect(auth.verifyPasskey).toHaveBeenCalledWith(expect.objectContaining({ challengeId: 'ch-a' })));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/finance');
  });

  it('erro da passkey aparece e prepara outro desafio', async () => {
    auth.verifyPasskey.mockResolvedValueOnce({ ok: false, error: 'Confirmação cancelada. Toque no botão para tentar de novo.' });
    renderLogin();
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /Usar passkey/ }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/cancelada/);
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('"Usar código" troca para o TOTP e volta', async () => {
    renderLogin();
    fireEvent.click(await screen.findByRole('button', { name: 'Usar código' }));
    expect(screen.getByLabelText('Código')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Usar passkey' }));
    expect(await screen.findByRole('button', { name: /Usar passkey/ })).toBeTruthy();
  });

  it('só TOTP: vai direto ao código', async () => {
    auth.mfaMethods = { totp: true, passkey: false };
    renderLogin();
    expect(await screen.findByLabelText('Código')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Usar passkey/ })).toBeNull();
  });

  it('navegador sem passkey e conta com TOTP: abre no código', async () => {
    vi.stubGlobal('PublicKeyCredential', undefined);
    renderLogin();
    expect(await screen.findByLabelText('Código')).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });
});
