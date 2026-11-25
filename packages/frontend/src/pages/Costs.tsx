import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/DashboardLayout';
import { NoWorkspace } from '@/components/NoWorkspace';
import { ExpensesTab } from '@/components/costs/ExpensesTab';
import { FeesTab } from '@/components/costs/FeesTab';
import { ProductsTab } from '@/components/costs/ProductsTab';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { useMask } from '@/contexts/StreamingModeContext';
import { useToast } from '@/hooks/use-toast';
import { costsApi, type CostSettings, type CostSettingsInput } from '@/lib/costs';

const TABS = ['fees', 'products', 'expenses'] as const;
type Tab = typeof TABS[number];

export default function Costs() {
  const { activeWorkspace } = useWorkspaceContext();
  const { mask } = useMask();
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Custos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeWorkspace ? `${mask('workspace', activeWorkspace.name)} · ` : ''}impostos, taxas, custo de produto e despesas que saem do lucro em Resultado e Campanhas
          </p>
        </div>
        {activeWorkspace ? <CostsPanel key={activeWorkspace.id} id={activeWorkspace.id} /> : <NoWorkspace />}
      </div>
    </DashboardLayout>
  );
}

function toInput(settings: CostSettings): CostSettingsInput {
  return {
    salesTaxPercent: settings.salesTaxPercent,
    checkoutRules: settings.checkoutRules,
    extraFees: settings.extraFees,
    mediaTaxRules: settings.mediaTaxRules,
    productCosts: settings.productCosts,
  };
}

function CostsPanel({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'fees';
  const query = useQuery({ queryKey: ['cost-settings', id], queryFn: () => costsApi.settings(id) });
  const [draft, setDraft] = useState<CostSettingsInput | null>(null);
  const current = draft ?? (query.data ? toInput(query.data) : null);

  const save = useMutation({
    mutationFn: (input: CostSettingsInput) => costsApi.saveSettings(id, input),
    onSuccess: (next) => {
      queryClient.setQueryData(['cost-settings', id], next);
      setDraft(null);
      // A régua de custos vale para Resultado, Campanhas e Acompanhamento de testes.
      void queryClient.invalidateQueries({ queryKey: ['campaigns', id] });
      void queryClient.invalidateQueries({ queryKey: ['summary', id] });
      void queryClient.invalidateQueries({ queryKey: ['test-matrix', id] });
      void queryClient.invalidateQueries({ queryKey: ['test-checkout-health', id] });
      toast({ title: 'Custos salvos' });
    },
    onError: (error: Error) => toast({ title: 'Não foi possível salvar', description: error.message, variant: 'destructive' }),
  });

  const update = (next: CostSettingsInput) => setDraft(next);

  return (
    <Tabs value={tab} onValueChange={(value) => setParams({ tab: value }, { replace: true })} className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList className="no-scrollbar max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="fees">Taxas e impostos</TabsTrigger>
          <TabsTrigger value="products">Custo de produto</TabsTrigger>
          <TabsTrigger value="expenses">Despesas</TabsTrigger>
        </TabsList>
        {tab !== 'expenses' && draft && (
          <div className="flex items-center gap-2" role="status">
            <span className="text-xs text-muted-foreground">Alterações não salvas</span>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={save.isPending}>Descartar</Button>
            <Button size="sm" onClick={() => save.mutate(draft)} disabled={save.isPending}>{save.isPending ? 'Salvando...' : 'Salvar'}</Button>
          </div>
        )}
      </div>

      {query.isPending && tab !== 'expenses' && <p role="status" className="text-sm text-muted-foreground">Carregando configuração…</p>}
      {query.isError && tab !== 'expenses' && <p role="alert" className="text-sm text-destructive">{query.error.message}</p>}

      <TabsContent value="fees">
        {query.data && current && <FeesTab settings={query.data} value={current} onChange={update} />}
      </TabsContent>
      <TabsContent value="products">
        {query.data && current && <ProductsTab settings={query.data} value={current} onChange={update} />}
      </TabsContent>
      <TabsContent value="expenses">
        <ExpensesTab dashboardId={id} />
      </TabsContent>
    </Tabs>
  );
}
