import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Eye, EyeOff, ShieldCheck, Fingerprint } from 'lucide-react';
import { isValidTotpCode } from '@/lib/mfa';
import {
  isFresh, passkeyErrorMessage, passkeysSupported, prepareAuthentication, type PreparedAuthentication,
} from '@/lib/passkeys';
import { Logo } from '@/components/Logo';

/**
 * Só entrar. Não há mais "Criar conta": as contas nascem em
 * Configurações > Usuários, e só quem administra vê aquela aba.
 */
export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { login, user, mfaRequired, mfaMethods, verifyMfa, verifyPasskey, logout } = useAuth();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  // Sessão aberta só com a senha de quem tem 2FA: falta o código ou a passkey.
  const askCode = !!user && mfaRequired;
  const supported = passkeysSupported();
  const canPasskey = mfaMethods.passkey;
  const canCode = mfaMethods.totp;
  // Passkey é o padrão quando a conta tem uma.
  const [method, setMethod] = useState<'passkey' | 'code' | null>(null);
  const activeMethod = method ?? (canPasskey && (supported || !canCode) ? 'passkey' : 'code');
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const prepared = useRef<PreparedAuthentication | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const emailChanged = searchParams.get('email_changed') === '1';

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const result = await login(email, password);
      if (result.success && result.mfaRequired) {
        // O formulário vira o passo do código (askCode); nada de entrar ainda.
        setPassword('');
      } else if (result.success) {
        toast({
          title: 'Login realizado!',
          description: 'Bem-vindo de volta.',
        });
        if (emailChanged) {
          setSearchParams({}, { replace: true });
        }
        navigate('/finance');
      } else {
        toast({
          title: 'Erro ao entrar',
          description: 'E-mail ou senha incorretos.',
          variant: 'destructive',
        });
      }
    } catch {
      toast({
        title: 'Erro',
        description: 'Ocorreu um erro ao fazer login.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  // Desafio buscado antes do toque: no iPhone o Face ID só abre se o navegador
  // for chamado logo depois do toque, sem esperar a rede.
  const prepare = useCallback(async () => {
    try {
      prepared.current = await prepareAuthentication();
    } catch (error) {
      prepared.current = null;
      setPasskeyError(passkeyErrorMessage(error));
    }
  }, []);

  useEffect(() => {
    if (askCode && activeMethod === 'passkey' && supported && !isFresh(prepared.current)) prepare();
  }, [askCode, activeMethod, supported, prepare]);

  useEffect(() => {
    if (!askCode) {
      prepared.current = null;
      setMethod(null);
      setPasskeyError(null);
    }
  }, [askCode]);

  async function handlePasskey() {
    if (passkeyBusy) return;
    if (!supported) {
      setPasskeyError('Este navegador não suporta passkey. Use o código do app ou outro navegador.');
      return;
    }
    setPasskeyBusy(true);
    setPasskeyError(null);
    try {
      if (!isFresh(prepared.current)) await prepare();
      const current = prepared.current;
      if (!current) return;
      prepared.current = null; // uso único
      const result = await verifyPasskey(current);
      if (!result.ok) {
        setPasskeyError(result.error ?? 'Não foi possível usar a passkey.');
        prepare();
        return;
      }
      if (emailChanged) setSearchParams({}, { replace: true });
      toast({ title: 'Login realizado!', description: 'Bem-vindo de volta.' });
      navigate('/finance');
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function handleCode(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidTotpCode(code)) {
      setCodeError('Digite os 6 dígitos do app autenticador.');
      return;
    }
    setVerifying(true);
    setCodeError(null);
    const result = await verifyMfa(code);
    setVerifying(false);
    if (!result.ok) {
      setCodeError(result.error ?? 'Código inválido.');
      setCode('');
      return;
    }
    if (emailChanged) setSearchParams({}, { replace: true });
    toast({ title: 'Login realizado!', description: 'Bem-vindo de volta.' });
    navigate('/finance');
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background py-12">
      {/* Subtle ambient glow */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 -left-24 h-72 w-72 rounded-full bg-primary/8 blur-[120px]" />
        <div className="absolute bottom-1/4 -right-24 h-72 w-72 rounded-full bg-primary/6 blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-sm px-4 animate-dash-in">
        {/* Logo */}
        <div className="mb-8 text-center">
          <Logo size="lg" className="justify-center" />
          <p className="mt-2 text-sm text-muted-foreground">Acesse seu painel de controle</p>
        </div>

        <div className="liquid-glass rounded-lg p-6">
          {emailChanged && (
            <div
              className="mb-4 rounded-md border border-accent-readable/30 bg-primary/10 px-4 py-3 text-sm"
              role="status"
            >
              <p className="font-medium text-accent-readable">Seu e-mail foi alterado.</p>
              <p className="text-muted-foreground mt-1">
                Use o <strong>novo endereço</strong> para entrar.
              </p>
            </div>
          )}

          {askCode && activeMethod === 'passkey' ? (
            <div className="space-y-5" aria-labelledby="mfa-title">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent-readable" strokeWidth={1.5} />
                <div>
                  <h2 id="mfa-title" className="text-sm font-medium text-foreground">Verificação em duas etapas</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Confirme com a sua passkey: Face ID, Touch ID, Windows Hello ou chave de segurança.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                onClick={handlePasskey}
                disabled={passkeyBusy}
                className="h-14 w-full gap-3 text-base font-medium"
                aria-describedby={passkeyError ? 'passkey-error' : undefined}
              >
                {passkeyBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Fingerprint className="h-6 w-6" strokeWidth={1.5} />}
                Usar passkey
              </Button>
              {!supported && (
                <p className="text-xs text-muted-foreground">Este navegador não suporta passkey.</p>
              )}
              {passkeyError && (
                <p id="passkey-error" className="text-xs text-destructive" role="alert">{passkeyError}</p>
              )}
              {canCode && (
                <button
                  type="button"
                  onClick={() => { setMethod('code'); setPasskeyError(null); }}
                  className="w-full text-center text-sm text-foreground underline-offset-4 hover:underline"
                >
                  Usar código
                </button>
              )}
              <button
                type="button"
                onClick={() => { setPasskeyError(null); logout(); }}
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Entrar com outra conta
              </button>
            </div>
          ) : askCode ? (
            <form onSubmit={handleCode} className="space-y-5" aria-labelledby="mfa-title">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent-readable" strokeWidth={1.5} />
                <div>
                  <h2 id="mfa-title" className="text-sm font-medium text-foreground">Verificação em duas etapas</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Abra o app autenticador e digite o código de 6 dígitos do dash.zip.
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="mfa-code" className="text-xs uppercase tracking-wider text-muted-foreground">
                  Código
                </Label>
                <Input
                  id="mfa-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  placeholder="000000"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/[^\d ]/g, ''));
                    setCodeError(null);
                  }}
                  aria-invalid={!!codeError}
                  aria-describedby={codeError ? 'mfa-code-error' : undefined}
                  className="text-center font-mono text-lg tracking-[0.4em]"
                  autoFocus
                />
                {codeError && (
                  <p id="mfa-code-error" className="text-xs text-destructive" role="alert">{codeError}</p>
                )}
              </div>
              <Button type="submit" className="w-full h-11 text-sm font-medium" disabled={verifying}>
                {verifying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirmar
              </Button>
              {canPasskey && (
                <button
                  type="button"
                  onClick={() => { setMethod('passkey'); setCodeError(null); }}
                  className="w-full text-center text-sm text-foreground underline-offset-4 hover:underline"
                >
                  Usar passkey
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setCode('');
                  setCodeError(null);
                  logout();
                }}
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Entrar com outra conta
              </button>
            </form>
          ) : (
          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs uppercase tracking-wider text-muted-foreground">
                E-mail
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="relative space-y-2">
              <Label htmlFor="password" className="text-xs uppercase tracking-wider text-muted-foreground">
                Senha
              </Label>
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-[30px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <div className="flex justify-end">
              <Link
                to="/forgot-password"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Esqueci minha senha
              </Link>
            </div>
            <Button type="submit" className="w-full h-11 text-sm font-medium" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Entrar
            </Button>
          </form>
          )}
        </div>
        <div className="mt-5 text-center">
          <Link to="/docs" className="text-sm text-muted-foreground hover:text-foreground">
            Documentação
          </Link>
        </div>
      </div>
    </div>
  );
}
