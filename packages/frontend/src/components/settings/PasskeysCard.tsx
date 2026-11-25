import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Fingerprint, KeyRound, Loader2, Plus, Trash2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { listTotpFactors } from '@/lib/mfa';
import {
  isFresh, isLastFactor, listPasskeys, passkeyErrorMessage, passkeysSupported, prepareAuthentication,
  prepareRegistration, registerPasskey, removePasskey, signChallenge,
  type Passkey, type PreparedAuthentication, type PreparedRegistration,
} from '@/lib/passkeys';

const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Sugestão de nome pelo aparelho; a pessoa pode trocar. */
export function suggestDeviceName(userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string {
  if (/iPhone/i.test(userAgent)) return 'iPhone';
  if (/iPad/i.test(userAgent)) return 'iPad';
  if (/Android/i.test(userAgent)) return 'Android';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'Mac';
  if (/Windows/i.test(userAgent)) return 'Windows';
  return 'Meu dispositivo';
}

/**
 * Passkeys como segundo fator: adicionar com nome, listar e remover.
 * Convive com o TOTP; o login oferece os dois. Remover o último segundo
 * fator pede confirmação com a própria passkey.
 */
export function PasskeysCard() {
  const { refreshMfa } = useAuth();
  const supported = passkeysSupported();
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [totpActive, setTotpActive] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const preparedRegistration = useRef<PreparedRegistration | null>(null);

  const [target, setTarget] = useState<Passkey | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const preparedAuthentication = useRef<PreparedAuthentication | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, totp] = await Promise.all([
        listPasskeys(),
        listTotpFactors(supabase.auth).then((f) => f.some((x) => x.status === 'verified')).catch(() => false),
      ]);
      setPasskeys(list);
      setTotpActive(totp);
      setLoadError(null);
    } catch (error) {
      setPasskeys([]);
      setLoadError(passkeyErrorMessage(error));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // O desafio é buscado ao abrir o diálogo: no toque, o navegador abre o
  // Face ID na hora (o Safari do iPhone exige isso).
  const prepareAdd = useCallback(async () => {
    try {
      preparedRegistration.current = await prepareRegistration();
    } catch (error) {
      preparedRegistration.current = null;
      setAddError(passkeyErrorMessage(error));
    }
  }, []);

  const openAdd = () => {
    setName(suggestDeviceName());
    setAddError(null);
    setAddOpen(true);
    prepareAdd();
  };

  const adicionar = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) {
      setAddError('Dê um nome para reconhecer o aparelho (ex.: iPhone do trabalho).');
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      if (!isFresh(preparedRegistration.current)) await prepareAdd();
      const prepared = preparedRegistration.current;
      if (!prepared) return;
      preparedRegistration.current = null; // uso único
      await registerPasskey(prepared, clean);
      setAddOpen(false);
      await Promise.all([load(), refreshMfa()]);
      toast({ title: 'Passkey adicionada', description: 'No próximo login, toque em "Usar passkey".' });
    } catch (error) {
      setAddError(passkeyErrorMessage(error));
      prepareAdd();
    } finally {
      setAdding(false);
    }
  };

  const last = !!passkeys && isLastFactor(passkeys, totpActive);

  const prepareRemove = useCallback(async () => {
    try {
      preparedAuthentication.current = await prepareAuthentication();
    } catch (error) {
      preparedAuthentication.current = null;
      setRemoveError(passkeyErrorMessage(error));
    }
  }, []);

  const openRemove = (passkey: Passkey) => {
    setTarget(passkey);
    setRemoveError(null);
    preparedAuthentication.current = null;
    if (isLastFactor(passkeys ?? [], totpActive)) prepareRemove();
  };

  const remover = async () => {
    if (!target) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      let confirmation;
      if (last) {
        if (!isFresh(preparedAuthentication.current)) await prepareRemove();
        const prepared = preparedAuthentication.current;
        if (!prepared) return;
        preparedAuthentication.current = null;
        confirmation = await signChallenge(prepared);
      }
      await removePasskey(target.id, confirmation);
      setTarget(null);
      await Promise.all([load(), refreshMfa()]);
      toast({
        title: 'Passkey removida',
        description: last ? 'A conta ficou sem segundo fator: o login volta a pedir só a senha.' : undefined,
      });
    } catch (error) {
      setRemoveError(passkeyErrorMessage(error));
      if (last) prepareRemove();
    } finally {
      setRemoving(false);
    }
  };

  return (
    <section aria-labelledby="mfa-passkey-heading" className="space-y-4 border-t border-border pt-5">
      <div className="space-y-1">
        <h4 id="mfa-passkey-heading" className="text-sm font-medium text-foreground">Passkeys</h4>
        <p className="text-sm text-muted-foreground">Confirme o login com Face ID, Touch ID, Windows Hello ou uma chave de segurança.</p>
      </div>
      <div className="space-y-4">
        <p className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="passkey-support">
          {supported ? (
            <>
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" strokeWidth={1.5} />
              Este navegador suporta passkey.
            </>
          ) : (
            <>
              <XCircle className="h-4 w-4 shrink-0 text-destructive" strokeWidth={1.5} />
              Este navegador não suporta passkey (sem PublicKeyCredential).
            </>
          )}
        </p>

        {passkeys === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando...
          </div>
        ) : passkeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma passkey cadastrada.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border" aria-label="Passkeys cadastradas">
            {passkeys.map((passkey) => (
              <li key={passkey.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{passkey.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Criada em {dateFormat.format(new Date(passkey.createdAt))}
                      {passkey.lastUsedAt && ` · usada em ${dateFormat.format(new Date(passkey.lastUsedAt))}`}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={() => openRemove(passkey)}
                  aria-label={`Remover ${passkey.name}`}
                  title="Remover"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <Button onClick={openAdd} disabled={!supported || passkeys === null} className="gap-2">
          <Plus className="h-4 w-4" strokeWidth={1.5} />
          Adicionar passkey
        </Button>
        {loadError && <p className="text-xs text-destructive">{loadError}</p>}
      </div>

      <Dialog open={addOpen} onOpenChange={(open) => { if (!adding) setAddOpen(open); }}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={adicionar} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Adicionar passkey</DialogTitle>
              <DialogDescription>
                Dê um nome para reconhecer o aparelho. Depois, confirme com Face ID, Touch ID, Windows Hello ou a chave de segurança.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1">
              <Label htmlFor="passkey-name" className="text-xs">Nome do dispositivo</Label>
              <Input
                id="passkey-name"
                value={name}
                maxLength={60}
                onChange={(e) => { setName(e.target.value); setAddError(null); }}
                aria-invalid={!!addError}
                aria-describedby={addError ? 'passkey-name-error' : undefined}
                autoComplete="off"
              />
              {addError && <p id="passkey-name-error" className="text-xs text-destructive" role="alert">{addError}</p>}
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={() => setAddOpen(false)} disabled={adding}>Cancelar</Button>
              <Button type="submit" disabled={adding} className="gap-2">
                {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" strokeWidth={1.5} />}
                Criar passkey
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!target} onOpenChange={(open) => { if (!removing && !open) setTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remover a passkey “{target?.name}”?</DialogTitle>
            <DialogDescription>
              {last
                ? 'É o único segundo fator da conta. Para confirmar que é você, use esta passkey agora. Depois disso o login pede só a senha.'
                : 'Este aparelho deixa de servir como segundo fator. Os outros continuam valendo.'}
            </DialogDescription>
          </DialogHeader>
          {removeError && <p className="text-xs text-destructive" role="alert">{removeError}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => setTarget(null)} disabled={removing}>Cancelar</Button>
            <Button type="button" variant="destructive" onClick={remover} disabled={removing} className="gap-2">
              {removing && <Loader2 className="h-4 w-4 animate-spin" />}
              {last ? 'Confirmar com passkey e remover' : 'Remover'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
