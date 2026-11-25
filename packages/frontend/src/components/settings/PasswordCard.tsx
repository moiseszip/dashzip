import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { Masked } from '@/components/Masked';
import { useMask } from '@/contexts/StreamingModeContext';
import { MIN_PASSWORD_LENGTH, passwordStrength, validatePasswordChange, type PasswordChangeErrors } from '@/lib/password';
import { cn } from '@/lib/utils';

const STRENGTH_LABEL = { empty: '', weak: 'Fraca', fair: 'Razoável', strong: 'Forte' } as const;
const STRENGTH_COLOR = { empty: 'bg-muted', weak: 'bg-destructive', fair: 'bg-amber-500', strong: 'bg-emerald-500' } as const;

function PasswordField({ id, label, value, onChange, autoComplete, error, describedBy }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  error?: string;
  describedBy?: string;
}) {
  const [show, setShow] = useState(false);
  const errorId = `${id}-error`;
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={[error ? errorId : null, describedBy].filter(Boolean).join(' ') || undefined}
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
          aria-label={show ? 'Esconder senha' : 'Mostrar senha'}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {error && <p id={errorId} className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * Troca de senha logado: confere a senha atual (num cliente à parte, sem
 * derrubar a sessão) e grava a nova no Supabase Auth.
 */
export function PasswordCard() {
  const { user, changePassword } = useAuth();
  const { enabled: streaming } = useMask();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const errors = validatePasswordChange({ current, next, confirm });
  // Antes de tentar salvar, só mostra o que já dá para julgar sem incomodar.
  const shown: PasswordChangeErrors = touched ? errors : {
    next: next && errors.next !== 'Digite a nova senha.' ? errors.next : undefined,
    confirm: confirm && errors.confirm === 'As senhas não batem.' ? errors.confirm : undefined,
  };
  const strength = passwordStrength(next, user?.email);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setServerError(null);
    if (Object.keys(errors).length) return;
    setSaving(true);
    const result = await changePassword(current, next);
    setSaving(false);
    if (!result.ok) {
      setServerError(result.error ?? 'Não foi possível trocar a senha.');
      return;
    }
    setCurrent('');
    setNext('');
    setConfirm('');
    setTouched(false);
    toast({ title: 'Senha alterada', description: 'Use a nova senha no próximo login.' });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Senha</CardTitle>
        <CardDescription>
          Conta <Masked kind="email" value={user?.email} fallback="—" />. Para trocar, confirme a senha atual.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={salvar} className="space-y-4" noValidate>
          {/* Campo oculto para o gerenciador de senhas associar a conta certa. */}
          <input type="email" name="username" autoComplete="username" value={streaming ? '' : user?.email ?? ''} readOnly hidden />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2 sm:max-w-[calc(50%-0.375rem)]">
              <PasswordField id="current-password" label="Senha atual" value={current} onChange={setCurrent} autoComplete="current-password" error={shown.current} />
            </div>
            <div className="space-y-2">
              <PasswordField
                id="new-password"
                label="Nova senha"
                value={next}
                onChange={setNext}
                autoComplete="new-password"
                error={shown.next}
                describedBy="new-password-strength"
              />
              <div id="new-password-strength" aria-live="polite" className="space-y-1">
                <div className="flex gap-1" aria-hidden="true">
                  {[1, 2, 3, 4].map((step) => (
                    <span
                      key={step}
                      className={cn('h-1 flex-1 rounded-full', strength.score >= step ? STRENGTH_COLOR[strength.strength] : 'bg-muted')}
                    />
                  ))}
                </div>
                {next ? (
                  <p className="text-xs text-muted-foreground">
                    Força: <span className="font-medium text-foreground">{STRENGTH_LABEL[strength.strength]}</span>
                    {strength.strength === 'weak' && next.length >= MIN_PASSWORD_LENGTH && ' — dá para salvar, mas é fácil de adivinhar.'}
                    {strength.hints[0] && <span className="block">{strength.hints[0]}</span>}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Mínimo de {MIN_PASSWORD_LENGTH} caracteres. Prefira 12 ou mais.</p>
                )}
              </div>
            </div>
            <PasswordField id="confirm-password" label="Repita a nova senha" value={confirm} onChange={setConfirm} autoComplete="new-password" error={shown.confirm} />
          </div>
          {serverError && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {serverError}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {saving ? 'Salvando...' : 'Trocar senha'}
            </Button>
            <Link to="/forgot-password" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              Esqueci a senha atual
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
