import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { NoWorkspace } from '@/components/NoWorkspace';
import { RuleEditor } from '@/components/rules/RuleEditor';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { useToast } from '@/hooks/use-toast';
import { useMask } from '@/contexts/StreamingModeContext';
import { costsApi } from '@/lib/costs';
import {
  ACTION_LABELS,
  LEVEL_LABELS,
  OPERATOR_SYMBOLS,
  formatMetricValue,
  frequencyLabel,
  isBudgetAction,
  rulesApi,
  windowLabel,
  type MetricUnit,
  type Rule,
  type RuleBody,
} from '@/lib/rules';
import { getActiveTimezone } from '@/lib/timezone';

/** Data e hora no fuso do painel ativo. */
const when = (iso: string | null) => (iso
  ? new Intl.DateTimeFormat('pt-BR', { timeZone: getActiveTimezone(), day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  : '—');

export default function Rules() {
  const { activeWorkspace } = useWorkspaceContext();
  const { mask } = useMask();
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Regras</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeWorkspace ? `${mask('workspace', activeWorkspace.name)} · ` : ''}pausar, ativar e ajustar orçamento na Meta quando os números baterem
          </p>
        </div>
        {activeWorkspace ? <RulesPanel key={activeWorkspace.id} id={activeWorkspace.id} /> : <NoWorkspace />}
      </div>
    </DashboardLayout>
  );
}

function describe(rule: Rule, units: Map<string, MetricUnit>, labels: Map<string, string>) {
  const action = ACTION_LABELS[rule.action.type];
  const target = `${LEVEL_LABELS[rule.level].many} ${rule.targetStatus === 'active' ? 'ativos' : 'pausados'}`;
  const budget = isBudgetAction(rule.action.type) && rule.action.value !== null
    ? ` em ${rule.action.valueType === 'percentage' ? `${rule.action.value}%` : rule.action.value}${rule.action.limit !== null ? ` (limite ${rule.action.limit})` : ''}`
    : '';
  const conditions = rule.conditions.map((c) => {
    const unit = units.get(c.metric);
    const b = c.valueB !== null ? ` e ${formatMetricValue(c.valueB, unit)}` : '';
    return `${labels.get(c.metric) ?? c.metric} ${OPERATOR_SYMBOLS[c.operator]} ${formatMetricValue(c.valueA, unit)}${b}`;
  }).join(' e ');
  return `${action} ${target}${budget} quando ${conditions} · ${windowLabel(rule.window).toLowerCase()}`;
}

function schedule(rule: Rule) {
  const parts = [frequencyLabel(rule.frequencyMinutes)];
  if (rule.dailyHour !== null) parts.push(`às ${String(rule.dailyHour).padStart(2, '0')}h`);
  if (rule.hourStart !== null && rule.hourEnd !== null) parts.push(`entre ${String(rule.hourStart).padStart(2, '0')}h e ${String(rule.hourEnd).padStart(2, '0')}h`);
  if (rule.maxRunsPerDay !== null) parts.push(`até ${rule.maxRunsPerDay}× por dia`);
  return parts.join(', ');
}

function RulesPanel({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { mask: maskName, scrub } = useMask();
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const [running, setRunning] = useState<Rule | null>(null);
  const [removing, setRemoving] = useState<Rule | null>(null);
  const [history, setHistory] = useState<Rule | null>(null);

  const query = useQuery({ queryKey: ['rules', id], queryFn: () => rulesApi.list(id) });
  const accounts = useQuery({ queryKey: ['cost-settings', id], queryFn: () => costsApi.settings(id) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['rules', id] });
  const fail = (title: string) => (error: Error) => toast({ title, description: error.message, variant: 'destructive' });

  const save = useMutation({
    mutationFn: (body: RuleBody) => (editing && editing !== 'new' ? rulesApi.update(id, editing.id, body) : rulesApi.create(id, body)),
    onSuccess: ({ warnings }) => {
      setEditing(null);
      void refresh();
      toast({ title: 'Regra salva', description: warnings.length ? warnings.join(' ') : undefined });
    },
    onError: fail('Regra não salva'),
  });
  const toggle = useMutation({
    mutationFn: ({ rule, enabled }: { rule: Rule; enabled: boolean }) => rulesApi.setEnabled(id, rule.id, enabled),
    onSuccess: () => void refresh(),
    onError: fail('Não foi possível mudar a regra'),
  });
  const run = useMutation({
    mutationFn: (rule: Rule) => rulesApi.run(id, rule.id),
    onSuccess: (row) => {
      setRunning(null);
      void refresh();
      void queryClient.invalidateQueries({ queryKey: ['rule-runs', id] });
      void queryClient.invalidateQueries({ queryKey: ['campaigns', id] });
      toast({
        title: `${row.matched} de ${row.evaluated} itens casaram`,
        description: row.error ?? `${row.succeeded} alterados${row.failed ? `, ${row.failed} com erro` : ''}.`,
        variant: row.failed || row.error ? 'destructive' : undefined,
      });
    },
    onError: fail('A execução falhou'),
  });
  const remove = useMutation({
    mutationFn: (rule: Rule) => rulesApi.remove(id, rule.id),
    onSuccess: () => { setRemoving(null); void refresh(); toast({ title: 'Regra apagada' }); },
    onError: fail('Não foi possível apagar'),
  });

  const catalog = query.data?.catalog;
  const units = new Map((catalog?.metrics ?? []).map((m) => [m.key, m.unit] as [string, MetricUnit]));
  const labels = new Map((catalog?.metrics ?? []).map((m) => [m.key, m.label] as [string, string]));
  const accountOptions = (accounts.data?.accounts ?? []).filter((a) => a.active).map((a) => ({
    id: a.accountId.startsWith('act_') ? a.accountId : `act_${a.accountId}`, name: maskName('account', a.name), currency: a.currency,
  }));

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          As regras leem os mesmos números de Campanhas, com as vendas atribuídas pelo rastreio do dash.zip, e agem pelo System User da Meta.
          Antes de ligar uma regra aqui, desligue a equivalente na UTMify: as duas agindo nas mesmas campanhas entram em conflito.
        </p>
        <Button size="sm" onClick={() => setEditing('new')} disabled={!catalog}><Plus className="mr-1.5 h-4 w-4" /> Nova regra</Button>
      </div>

      {query.isPending && <p role="status" className="text-sm text-muted-foreground">Carregando regras…</p>}
      {query.isError && <p role="alert" className="text-sm text-destructive">{query.error.message}</p>}
      {query.data && query.data.rules.length === 0 && (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Nenhuma regra. Comece pela que você já usa na UTMify e simule antes de ligar.</CardContent></Card>
      )}

      <div className="space-y-3">
        {query.data?.rules.map((rule) => (
          <Card key={rule.id}>
            <CardContent className="flex flex-wrap items-start gap-4 p-4">
              <Switch
                checked={rule.enabled} disabled={toggle.isPending}
                onCheckedChange={(enabled) => toggle.mutate({ rule, enabled })}
                aria-label={rule.enabled ? `Desligar ${scrub(rule.name)}` : `Ligar ${scrub(rule.name)}`}
              />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium">{scrub(rule.name)}{!rule.enabled && <span className="ml-2 text-xs font-normal text-muted-foreground">desligada</span>}</p>
                <p className="text-sm text-muted-foreground">{describe(rule, units, labels)}</p>
                <p className="text-xs text-muted-foreground">
                  {schedule(rule)} · última execução {when(rule.lastRunAt)}
                  {rule.lastRun && ` (${rule.lastRun.matched} casaram, ${rule.lastRun.succeeded} alterados${rule.lastRun.failed ? `, ${rule.lastRun.failed} erros` : ''})`}
                  {rule.runsToday > 0 && ` · ${rule.runsToday} hoje`}
                </p>
                {rule.lastRun?.error && <p className="text-xs text-destructive">{rule.lastRun.error}</p>}
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Executar ${scrub(rule.name)} agora`} onClick={() => setRunning(rule)}><Play className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Histórico de ${scrub(rule.name)}`} onClick={() => setHistory(rule)}><History className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Editar ${scrub(rule.name)}`} onClick={() => setEditing(rule)}><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Apagar ${scrub(rule.name)}`} onClick={() => setRemoving(rule)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {catalog && (
        <RuleEditor
          open={editing !== null}
          rule={editing && editing !== 'new' ? editing : null}
          catalog={catalog}
          accounts={accountOptions}
          dashboardId={id}
          busy={save.isPending}
          onClose={() => setEditing(null)}
          onSave={(body) => save.mutate(body)}
        />
      )}

      <Dialog open={running !== null} onOpenChange={(open) => { if (!open && !run.isPending) setRunning(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Executar "{scrub(running?.name)}" agora?</DialogTitle>
            <DialogDescription>
              A regra avalia os números e age na Meta de verdade (até 40 itens). Para ver o que ela faria sem agir, use Simular no editor.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRunning(null)} disabled={run.isPending}>Cancelar</Button>
            <Button onClick={() => running && run.mutate(running)} disabled={run.isPending}>{run.isPending ? 'Executando...' : 'Executar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(open) => { if (!open && !remove.isPending) setRemoving(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apagar "{scrub(removing?.name)}"?</DialogTitle>
            <DialogDescription>A regra e o histórico dela são apagados. Para só parar, desligue a regra.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)} disabled={remove.isPending}>Cancelar</Button>
            <Button variant="destructive" onClick={() => removing && remove.mutate(removing)} disabled={remove.isPending}>{remove.isPending ? 'Apagando...' : 'Apagar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <HistoryDialog dashboardId={id} rule={history} onClose={() => setHistory(null)} />
    </>
  );
}

function HistoryDialog({ dashboardId, rule, onClose }: { dashboardId: string; rule: Rule | null; onClose: () => void }) {
  const runs = useInfiniteQuery({
    queryKey: ['rule-runs', dashboardId, rule?.id],
    queryFn: ({ pageParam }) => rulesApi.runs(dashboardId, rule!.id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    enabled: rule !== null,
  });
  const rows = runs.data?.pages.flatMap((p) => p.runs) ?? [];
  const { mask, scrub } = useMask();
  return (
    <Dialog open={rule !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Histórico de "{scrub(rule?.name)}"</DialogTitle>
          <DialogDescription>Execuções agendadas e manuais dos últimos 90 dias, da mais nova para a mais antiga.</DialogDescription>
        </DialogHeader>
        {runs.isPending && <p role="status" className="text-sm text-muted-foreground">Carregando…</p>}
        {runs.isError && <p role="alert" className="text-sm text-destructive">{runs.error.message}</p>}
        {!runs.isPending && rows.length === 0 && <p className="text-sm text-muted-foreground">A regra ainda não rodou.</p>}
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="py-2.5 text-sm">
              <details>
                <summary className="cursor-pointer">
                  <span className="tabular-nums">{when(row.ran_at)}</span>
                  <span className="ml-2 text-muted-foreground">{row.trigger === 'manual' ? 'manual' : 'agendada'}</span>
                  <span className="ml-2">{row.matched} de {row.evaluated} casaram · {row.succeeded} alterados{row.failed ? ` · ${row.failed} erros` : ''}</span>
                </summary>
                {row.error && <p className="mt-1 text-xs text-destructive">{scrub(row.error)}</p>}
                {row.actions.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs">
                    {row.actions.map((a, i) => (
                      <li key={`${a.objectId}:${i}`} className="flex flex-wrap gap-x-2">
                        <span className={a.ok ? '' : 'text-destructive'}>{a.ok ? '✓' : '✗'}</span>
                        <span className="max-w-xs truncate" title={mask(rule?.level ?? 'campaign', a.name)}>{mask(rule?.level ?? 'campaign', a.name)}</span>
                        <span className="text-muted-foreground">{String(a.before ?? '—')} → {String(a.after ?? '—')}</span>
                        {a.message && <span className="text-destructive">{scrub(a.message)}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            </li>
          ))}
        </ul>
        {runs.hasNextPage && (
          <Button variant="outline" size="sm" onClick={() => runs.fetchNextPage()} disabled={runs.isFetchingNextPage}>
            {runs.isFetchingNextPage ? 'Carregando...' : 'Carregar mais'}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
