import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamingModeProvider } from '@/contexts/StreamingModeContext';
import { PasswordCard } from './PasswordCard';
import { TwoFactorCard } from './TwoFactorCard';

const EMAIL = 'dono@painel-secreto.com';
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DP';

const mfa = vi.hoisted(() => ({
  listFactors: vi.fn(),
  enroll: vi.fn(),
  unenroll: vi.fn(),
  challengeAndVerify: vi.fn(),
  getAuthenticatorAssuranceLevel: vi.fn(),
}));
const changePassword = vi.hoisted(() => vi.fn());
const refreshMfa = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { mfa, refreshSession: vi.fn().mockResolvedValue({}) } } }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: EMAIL }, changePassword, refreshMfa }),
}));

function renderCards(streaming: boolean) {
  return render(
    <MemoryRouter>
      <StreamingModeProvider initialEnabled={streaming}>
        <PasswordCard />
        <TwoFactorCard />
      </StreamingModeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mfa.listFactors.mockResolvedValue({ data: { all: [] }, error: null });
  mfa.enroll.mockResolvedValue({
    data: { id: 'f1', type: 'totp', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg></svg>', secret: SECRET, uri: `otpauth://totp/dash.zip:${EMAIL}?secret=${SECRET}` } },
    error: null,
  });
  mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
  mfa.unenroll.mockResolvedValue({ data: {}, error: null });
  changePassword.mockResolvedValue({ ok: true });
});

describe('Configurações > Conta', () => {
  it('modo streaming esconde e-mail, QR e chave TOTP do DOM', async () => {
    const { container } = renderCards(true);
    fireEvent.click(await screen.findByRole('button', { name: /Ativar/ }));
    await screen.findByText('QR code oculto no modo streaming.');
    const html = container.innerHTML;
    expect(html).not.toContain(EMAIL);
    expect(html).not.toContain(SECRET);
    expect(html).not.toContain('JBSW Y3DP');
    expect(container.querySelector('img')).toBeNull();
  });

  it('sem streaming mostra QR e chave em grupos e ativa com o código', async () => {
    const { container } = renderCards(false);
    fireEvent.click(await screen.findByRole('button', { name: /Ativar/ }));
    expect(await screen.findByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP')).toBeInTheDocument();
    expect(container.querySelector('img')?.getAttribute('src')).toContain('data:image/svg+xml');

    const input = screen.getByLabelText('Código de 6 dígitos');
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e ativar' }));
    expect(await screen.findByText('Digite os 6 dígitos que aparecem no app.')).toBeInTheDocument();
    expect(mfa.challengeAndVerify).not.toHaveBeenCalled();

    mfa.listFactors.mockResolvedValue({
      data: { all: [{ id: 'f1', factor_type: 'totp', status: 'verified', friendly_name: 'x', created_at: '2026-11-23T10:00:00Z' }] }, error: null,
    });
    fireEvent.change(input, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e ativar' }));
    await waitFor(() => expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f1', code: '123456' }));
    expect(await screen.findByText('Ativa')).toBeInTheDocument();
    expect(refreshMfa).toHaveBeenCalled();
  });

  it('troca de senha valida antes de chamar o Supabase', async () => {
    renderCards(false);
    fireEvent.click(screen.getByRole('button', { name: 'Trocar senha' }));
    expect(await screen.findByText('Digite a senha atual.')).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Senha atual'), { target: { value: 'velha-senha' } });
    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'Nova-Senha-Forte-26' } });
    fireEvent.change(screen.getByLabelText('Repita a nova senha'), { target: { value: 'Nova-Senha-Forte-26' } });
    fireEvent.click(screen.getByRole('button', { name: 'Trocar senha' }));
    await waitFor(() => expect(changePassword).toHaveBeenCalledWith('velha-senha', 'Nova-Senha-Forte-26'));

    changePassword.mockResolvedValueOnce({ ok: false, error: 'A senha atual está incorreta.' });
    fireEvent.change(screen.getByLabelText('Senha atual'), { target: { value: 'errada' } });
    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'Outra-Senha-Forte-26' } });
    fireEvent.change(screen.getByLabelText('Repita a nova senha'), { target: { value: 'Outra-Senha-Forte-26' } });
    fireEvent.click(screen.getByRole('button', { name: 'Trocar senha' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A senha atual está incorreta.');
  });
});
