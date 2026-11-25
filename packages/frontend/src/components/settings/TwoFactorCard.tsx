import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Loader2, ShieldCheck, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useMask } from '@/contexts/StreamingModeContext';
import { SecretMask, StreamingHidden } from '@/components/Masked';
import {
  confirmTotpEnrollment, disableTotp, formatSecret, isValidTotpCode, listTotpFactors, mfaErrorMessage,
  startTotpEnrollment, type Enrollment, type TotpFactor,
} from '@/lib/mfa';

const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

function CodeInput({ id, value, onChange, error, autoFocus }: {
  id: string; value: string; onChange: (v: string) => void; error?: string | null; autoFocus?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">Código de 6 dígitos</Label>
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        placeholder="000000"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d ]/g, ''))}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        className="max-w-[12rem] text-center font-mono text-lg tracking-[0.4em]"
        autoFocus={autoFocus}
      />
      {error && <p id={`${id}-error`} className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  );
}

/**
 * Autenticação em dois fatores (TOTP) com o MFA nativo do Supabase: QR code
 * e chave para o app autenticador, confirmação com o primeiro código e
 * desativação pedindo um código válido.
 */
export function TwoFactorCard() {
  const { refreshMfa, mfaMethods } = useAuth();
  const hasPasskey = !!mfaMethods?.passkey;
  const { enabled: streaming } = useMask();
  const [factors, setFactors] = useState<TotpFactor[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [starting, setStarting] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [disableError, setDisableError] = useState<string | null>(null);
  const [disabling, setDisabling] = useState(false);

  const load = useCallback(async () => {
    try {
      setFactors(await listTotpFactors(supabase.auth));
      setLoadError(null);
    } catch (error) {
      setLoadError(mfaErrorMessage(error));
      setFactors([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const active = factors?.find((f) => f.status === 'verified') ?? null;

  const iniciar = async () => {
    setStarting(true);
    setCode('');
    setCodeError(null);
    try {
      setEnrollment(await startTotpEnrollment(supabase.auth));
    } catch (error) {
      toast({ title: 'Não foi possível iniciar a ativação', description: mfaErrorMessage(error), variant: 'destructive' });
    } finally {
      setStarting(false);
    }
  };

  const cancelar = async () => {
    const pending = enrollment;
    setEnrollment(null);
    setCode('');
    setCodeError(null);
    // Fator não confirmado não protege nada: apaga para não acumular.
    if (pending) await supabase.auth.mfa.unenroll({ factorId: pending.factorId }).catch(() => undefined);
  };

  const confirmar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrollment) return;
    if (!isValidTotpCode(code)) {
      setCodeError('Digite os 6 dígitos que aparecem no app.');
      return;
    }
    setConfirming(true);
    setCodeError(null);
    try {
      await confirmTotpEnrollment(supabase.auth, enrollment.factorId, code);
      setEnrollment(null);
      setCode('');
      await Promise.all([load(), refreshMfa()]);
      toast({ title: 'Dois fatores ativados', description: 'No próximo login, o painel vai pedir o código do app.' });
    } catch (error) {
      setCodeError(mfaErrorMessage(error));
    } finally {
      setConfirming(false);
    }
  };

  const copiar = async () => {
    if (!enrollment) return;
    try {
      await navigator.clipboard.writeText(enrollment.secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: 'Não deu para copiar', description: 'Selecione a chave e copie manualmente.', variant: 'destructive' });
    }
  };

  const desativar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!active) return;
    if (!isValidTotpCode(disableCode)) {
      setDisableError('Digite os 6 dígitos que aparecem no app.');
      return;
    }
    setDisabling(true);
    setDisableError(null);
    try {
      await disableTotp(supabase.auth, active.id, disableCode);
      setDisableOpen(false);
      setDisableCode('');
      await Promise.all([load(), refreshMfa()]);
      toast({
        title: 'Dois fatores desativados',
        description: hasPasskey ? 'O login continua pedindo a passkey.' : 'O login volta a pedir só a senha.',
      });
    } catch (error) {
      setDisableError(mfaErrorMessage(error));
    } finally {
      setDisabling(false);
    }
  };

  return (
    <section aria-labelledby="mfa-app-heading" className="space-y-4">
      <div className="space-y-1">
        <h4 id="mfa-app-heading" className="text-sm font-medium text-foreground">App autenticador</h4>
        <p className="text-sm text-muted-foreground">Use o código de 6 dígitos gerado pelo seu app.</p>
      </div>
      <div className="space-y-4">
        {factors === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando...
          </div>
        ) : active ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-500" strokeWidth={1.5} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Ativa
                  <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">TOTP</span>
                </p>
                <p className="text-xs text-muted-foreground">Desde {dateFormat.format(new Date(active.createdAt))}</p>
              </div>
            </div>
            <Button
              variant="outline"
              className="shrink-0 gap-2"
              onClick={() => {
                setDisableCode('');
                setDisableError(null);
                setDisableOpen(true);
              }}
            >
              <ShieldOff className="h-4 w-4" strokeWidth={1.5} />
              Desativar
            </Button>
          </div>
        ) : enrollment ? (
          <form onSubmit={confirmar} className="space-y-4">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>No app autenticador, adicione uma conta lendo o QR code (ou digite a chave).</li>
              <li>Digite o código de 6 dígitos que o app mostrar para confirmar.</li>
            </ol>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              {streaming ? (
                <StreamingHidden className="sm:w-44">QR code oculto no modo streaming.</StreamingHidden>
              ) : (
                <img
                  src={enrollment.qrCode}
                  alt="QR code para o app autenticador"
                  className="h-44 w-44 shrink-0 rounded-md border border-border bg-white p-2"
                />
              )}
              <div className="min-w-0 flex-1 space-y-3">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Chave para digitar no app</p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-muted/40 px-2 py-1.5 font-mono text-xs text-foreground">
                      {streaming ? <SecretMask /> : formatSecret(enrollment.secret)}
                    </code>
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={copiar} aria-label="Copiar chave" title="Copiar chave">
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <CodeInput id="totp-enroll-code" value={code} onChange={(v) => { setCode(v); setCodeError(null); }} error={codeError} autoFocus />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={confirming}>
                {confirming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirmar e ativar
              </Button>
              <Button type="button" variant="ghost" onClick={cancelar} disabled={confirming}>Cancelar</Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Nenhum app autenticador configurado.</p>
            <Button onClick={iniciar} disabled={starting} className="shrink-0 gap-2">
              {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" strokeWidth={1.5} />}
              Ativar
            </Button>
          </div>
        )}
        {loadError && <p className="text-xs text-destructive">{loadError}</p>}
      </div>

      <Dialog open={disableOpen} onOpenChange={(open) => { if (!disabling) setDisableOpen(open); }}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={desativar} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Desativar o app autenticador?</DialogTitle>
              <DialogDescription>
                Para confirmar que é você, digite o código atual do app autenticador.{' '}
                {hasPasskey ? 'A passkey continua valendo no login.' : 'Depois disso o login pede só a senha.'}
              </DialogDescription>
            </DialogHeader>
            <CodeInput id="totp-disable-code" value={disableCode} onChange={(v) => { setDisableCode(v); setDisableError(null); }} error={disableError} autoFocus />
            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={() => setDisableOpen(false)} disabled={disabling}>Cancelar</Button>
              <Button type="submit" variant="destructive" disabled={disabling}>
                {disabling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Desativar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
