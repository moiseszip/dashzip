import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { Masked } from '@/components/Masked';
import { Loader2, UserPlus } from 'lucide-react';

interface UserRow {
  user_id: string;
  name: string | null;
  email: string | null;
  created_at: string;
  active: boolean | null;
  role: 'admin' | 'user';
}

/**
 * Criação de usuários pelo admin.
 *
 * A senha é definida aqui e entregue à pessoa: não há e-mail de convite nem
 * cadastro público. O backend recusa tudo isso para quem não está em
 * ADMIN_EMAILS, então esconder a aba é conveniência, não a proteção.
 */
export function UsersCard() {
  const { toast } = useToast();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const carregar = async () => {
    try {
      setUsers(await api.get<UserRow[]>('/users'));
    } catch (err) {
      toast({
        title: 'Erro ao carregar usuários',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const criar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await api.post('/users', { name, email, password });
      toast({
        title: 'Usuário criado',
        description: `${email} já pode entrar com a senha que você definiu.`,
      });
      setOpen(false);
      setPassword('');
      await carregar();
    } catch (err) {
      toast({
        title: 'Erro ao criar usuário',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (saving) return;
          if (next) {
            setName('');
            setEmail('');
          }
          setPassword('');
          setOpen(next);
        }}
      >
        <DialogTrigger asChild>
          <Button className="gap-2">
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Adicionar usuário
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <form onSubmit={criar} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Adicionar usuário</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="novo-nome">Nome</Label>
                <Input
                  id="novo-nome"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nome da pessoa"
                  disabled={saving}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="novo-email">E-mail</Label>
                <Input
                  id="novo-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="pessoa@email.com"
                  disabled={saving}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="nova-senha">Senha</Label>
              <Input
                id="nova-senha"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo de 8 caracteres"
                minLength={8}
                disabled={saving}
                required
                autoComplete="new-password"
              />
              <p className="text-xs text-muted-foreground">
                Anote antes de salvar: a senha não é exibida de novo. Quem receber pode
                trocá-la depois em Conta.
              </p>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={saving}>Cancelar</Button>
              </DialogClose>
              <Button type="submit" disabled={saving} className="gap-2">
                {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Criar usuário
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle>Usuários</CardTitle>
          <CardDescription>Quem tem acesso ao painel hoje.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando...
            </div>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum usuário cadastrado.</p>
          ) : (
            <div className="divide-y divide-border/60">
              {users.map((u) => (
                <div
                  key={u.user_id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0"
                >
                  <div>
                    <div className="text-sm font-medium"><Masked kind="person" value={u.name} fallback="(sem nome)" /></div>
                    <div className="text-xs text-muted-foreground"><Masked kind="email" value={u.email} /></div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium">
                      {u.role === 'admin' ? 'Admin' : 'Usuário'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      desde {new Date(u.created_at).toLocaleDateString('pt-BR')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
