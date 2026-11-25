import { Fragment } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { AdAccountsCard } from '@/components/integrations/AdAccountsCard';
import { CheckoutIntegrationsSection } from '@/components/integrations/CheckoutIntegrationsSection';
import { MetaCapiCard } from '@/components/integrations/MetaCapiCard';
import { WiapyCard } from '@/components/integrations/WiapyCard';
import { NoWorkspace } from '@/components/NoWorkspace';
import { Separator } from '@/components/ui/separator';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { Masked } from '@/components/Masked';

/**
 * A configuração do container: o snippet (client web), os webhooks dos
 * checkouts (clients do servidor) e a API de Conversões do Meta (as tags).
 */
export default function Integrations() {
  const { activeWorkspace } = useWorkspaceContext();

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-4xl space-y-8 animate-dash-in">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Integrações</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Contas de anúncio, conversões e checkouts
            {activeWorkspace && (
              <>
                {' '}· painel <span className="font-medium text-foreground"><Masked kind="workspace" value={activeWorkspace.name} /></span>
              </>
            )}
          </p>
        </div>

        {!activeWorkspace ? (
          <NoWorkspace />
        ) : (
          <Fragment key={activeWorkspace.id}>
            <AdAccountsCard dashboardId={activeWorkspace.id} />
            <Separator />
            <MetaCapiCard />
            <Separator />
            <CheckoutIntegrationsSection />
            <WiapyCard />
          </Fragment>
        )}
      </div>
    </DashboardLayout>
  );
}
