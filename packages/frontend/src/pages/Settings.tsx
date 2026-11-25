import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PasswordCard } from '@/components/settings/PasswordCard';
import { AppearanceCard } from '@/components/settings/AppearanceCard';
import { UsersCard } from '@/components/settings/UsersCard';
import { DashboardsCard } from '@/components/settings/DashboardsCard';
import { TimezoneCard } from '@/components/settings/TimezoneCard';
import { TwoFactorCard } from '@/components/settings/TwoFactorCard';
import { SalesNotificationsCard } from '@/components/settings/SalesNotificationsCard';
import { PasskeysCard } from '@/components/settings/PasskeysCard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { Masked } from '@/components/Masked';
import { restartWelcomeTour } from '@/components/WelcomeTour';
import { api } from '@/lib/api';
import { readCachedAdmin, writeCachedAdmin } from '@/lib/workspaceCache';
import { LogOut } from 'lucide-react';

// Painéis abre por padrão: criar, renomear e excluir painéis saiu da barra
// lateral e mora aqui. Endereço antigo (?tab=plan, ?tab=costs) cai nela por
// não estar nesta lista.
const VALID_TABS = ['dashboards', 'profile', 'appearance', 'notifications', 'users'] as const;
const DEFAULT_TAB = 'dashboards';

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, logout } = useAuth();
  // A aba Usuarios so existe para quem administra. O servidor recusa as rotas
  // de qualquer forma; isto e so para nao mostrar uma aba que daria 403.
  // A última resposta fica guardada no aparelho: a aba aparece na hora e a
  // consulta só confirma em segundo plano.
  const { data: permissions } = useQuery({
    queryKey: ['users-permissions', user?.id],
    queryFn: async () => {
      const result = await api.get<{ is_admin: boolean }>('/users/permissions');
      if (user?.id) writeCachedAdmin(user.id, result.is_admin);
      return result;
    },
    enabled: !!user?.id,
    staleTime: 10 * 60 * 1000,
    placeholderData: () => {
      const cached = readCachedAdmin(user?.id);
      return cached === undefined ? undefined : { is_admin: cached };
    },
  });
  const isAdmin = permissions?.is_admin ?? false;

  const currentTab = useMemo(() => {
    const tabFromUrl = searchParams.get('tab');
    if (tabFromUrl && VALID_TABS.includes(tabFromUrl as typeof VALID_TABS[number])) {
      return tabFromUrl;
    }
    return DEFAULT_TAB;
  }, [searchParams]);

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value }, { replace: true });
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-4xl space-y-6 animate-dash-in">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Configurações</h1>
          <p className="text-sm text-muted-foreground/70 mt-1">Painéis, fuso, conta, segurança e preferências</p>
        </div>

        <Tabs value={currentTab} onValueChange={handleTabChange} className="space-y-6">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 sm:inline-flex sm:w-auto [&>button]:min-h-10 sm:[&>button]:min-h-0">
            <TabsTrigger value="dashboards">Painéis</TabsTrigger>
            <TabsTrigger value="profile">Conta</TabsTrigger>
            <TabsTrigger value="appearance">Aparência</TabsTrigger>
            <TabsTrigger value="notifications">Notificações</TabsTrigger>
            {isAdmin && <TabsTrigger value="users">Usuários</TabsTrigger>}
          </TabsList>

          <TabsContent value="dashboards" className="space-y-6">
            <DashboardsCard />
            <TimezoneCard />
          </TabsContent>

          <TabsContent value="profile" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Tutorial</CardTitle>
                <CardDescription>Reveja o passo a passo das seções do Dash.zip.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="min-h-11" onClick={restartWelcomeTour}>Rever tutorial</Button>
              </CardContent>
            </Card>
            <PasswordCard />
            <Card>
              <CardHeader>
                <CardTitle>Autenticação em dois fatores</CardTitle>
                <CardDescription>Além da senha, confirme o login com um app autenticador ou uma passkey.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <TwoFactorCard />
                <PasskeysCard />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="appearance">
            <AppearanceCard />
          </TabsContent>

          <TabsContent value="notifications">
            <SalesNotificationsCard />
          </TabsContent>

          {isAdmin && (
            <TabsContent value="users">
              <UsersCard />
            </TabsContent>
          )}
        </Tabs>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-foreground/5 pt-6">
          <p className="min-w-0 truncate text-sm text-muted-foreground/80">
            {user?.email ? (
              <>
                Conectado como <span className="text-foreground"><Masked kind="email" value={user.email} /></span>
              </>
            ) : (
              'Sessão ativa'
            )}
          </p>
          <Button variant="outline" onClick={logout} className="shrink-0 gap-2">
            <LogOut strokeWidth={1.5} />
            Sair
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
