import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMask } from '@/contexts/StreamingModeContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  ACTION_LABELS,
  LEVEL_LABELS,
  OPERATOR_LABELS,
  OPERATOR_SYMBOLS,
  definitionOf,
  emptyRule,
  formatMetricValue,
  frequencyLabel,
  isBudgetAction,
  rulesApi,
  validateRule,
  windowLabel,
  type MetricUnit,
  type Rule,
  type RuleActionType,
  type RuleBody,
  type RuleCondition,
  type RulesCatalog,
  type SimulationResponse,
} from '@/lib/rules';

const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-2 text-sm';
const HOURS = Array.from({ length: 24 }, (_, h) => h);

function toNumber(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Percentuais (ctr, hook, hold) aparecem em % na tela e vão em fração para a API. */
function ConditionValue({ unit, value, onChange, label }: {
  unit: MetricUnit | undefined;
  value: number | null;
  onChange: (v: number | null) => void;
  label: string;
}) {
  const shown = value === null ? '' : unit === 'pct' ? String(Math.round(value * 10_000) / 100) : String(value);
  const suffix = unit === 'BRL' ? 'R$' : unit === 'pct' ? '%' : unit === 'native' ? 'moeda da conta' : '';
  return (
    <div className="relative">
      <Input
        inputMode="decimal" aria-label={label} className={cn('h-9', suffix && 'pr-14')} value={shown}
        onChange={(e) => {
          const n = toNumber(e.target.value);
          onChange(n === null ? null : unit === 'pct' ? n / 100 : n);
        }}
      />
      {suffix && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">{suffix}</span>}
    </div>
  );
}

export function RuleEditor({ open, rule, catalog, accounts, dashboardId, busy, onClose, onSave }: {
  open: boolean;
  rule: Rule | null;
  catalog: RulesCatalog;
  accounts: { id: string; name: string; currency: string }[];
  dashboardId: string;
  busy: boolean;
  onClose: () => void;
  onSave: (body: RuleBody) => void;
}) {
  const [form, setForm] = useState<RuleBody>(emptyRule);
  const units = new Map(catalog.metrics.map((m) => [m.key, m.unit]));
  const simulation = useMutation({ mutationFn: (body: RuleBody) => rulesApi.simulate(dashboardId, definitionOf(body)) });

  useEffect(() => {
    if (!open) return;
    if (rule) {
      const { id: _id, lastRunAt: _l, runsToday: _r, createdAt: _c, updatedAt: _u, lastRun: _lr, ...body } = rule;
      setForm(body);
    } else {
      setForm(emptyRule());
    }
    simulation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rule]);

  const set = (patch: Partial<RuleBody>) => { setForm((f) => ({ ...f, ...patch })); simulation.reset(); };
  const setCondition = (index: number, patch: Partial<RuleCondition>) =>
    set({ conditions: form.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)) });
  const setAction = (type: RuleActionType) => {
    const budget = isBudgetAction(type);
    set({
      action: { type, valueType: type === 'set_budget' ? 'amount' : budget ? (form.action.valueType ?? 'percentage') : null, value: budget ? form.action.value : null, limit: budget && type !== 'set_budget' ? form.action.limit : null },
      // Pausar só age em ativos e ativar só em pausados: o alvo acompanha a ação.
      targetStatus: type === 'pause' ? 'active' : type === 'activate' ? 'paused' : form.targetStatus,
      level: budget && form.level === 'ad' ? 'adset' : form.level,
    });
  };

  const error = validateRule(form);
  const budget = isBudgetAction(form.action.type);

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value && !busy) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{rule ? 'Editar regra' : 'Nova regra'}</DialogTitle>
          <DialogDescription>Todas as condições precisam bater. Simule antes de ligar: a regra age na Meta de verdade.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <Label className="grid gap-1.5">Nome
            <Input value={form.name} maxLength={80} autoFocus onChange={(e) => set({ name: e.target.value })} placeholder="Ex.: Pausar anúncio sem venda" />
          </Label>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Ação</legend>
            <div className="grid gap-2 sm:grid-cols-4">
              <Label className="grid gap-1 sm:col-span-2">O que fazer
                <select className={selectClass} value={form.action.type} onChange={(e) => setAction(e.target.value as RuleActionType)}>
                  {catalog.actions.map((a) => <option key={a} value={a}>{ACTION_LABELS[a]}</option>)}
                </select>
              </Label>
              {budget && form.action.type !== 'set_budget' && (
                <Label className="grid gap-1">Em
                  <select className={selectClass} value={form.action.valueType ?? 'percentage'} onChange={(e) => set({ action: { ...form.action, valueType: e.target.value as 'percentage' | 'amount' } })}>
                    <option value="percentage">Percentual</option>
                    <option value="amount">Valor</option>
                  </select>
                </Label>
              )}
              {budget && (
                <Label className="grid gap-1">{form.action.valueType === 'percentage' ? 'Percentual (%)' : 'Valor (moeda da conta)'}
                  <Input inputMode="decimal" value={form.action.value ?? ''} onChange={(e) => set({ action: { ...form.action, value: toNumber(e.target.value) } })} />
                </Label>
              )}
              {budget && form.action.type !== 'set_budget' && (
                <Label className="grid gap-1 sm:col-span-2">{form.action.type === 'increase_budget' ? 'Orçamento máximo' : 'Orçamento mínimo'} (moeda da conta, opcional)
                  <Input inputMode="decimal" value={form.action.limit ?? ''} onChange={(e) => set({ action: { ...form.action, limit: toNumber(e.target.value) } })} />
                </Label>
              )}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Em quais itens</legend>
            <div className="grid gap-2 sm:grid-cols-4">
              <Label className="grid gap-1">Nível
                <select className={selectClass} value={form.level} onChange={(e) => set({ level: e.target.value as RuleBody['level'] })}>
                  {(['campaign', 'adset', 'ad'] as const).map((l) => <option key={l} value={l} disabled={l === 'ad' && budget}>{LEVEL_LABELS[l].many[0].toUpperCase() + LEVEL_LABELS[l].many.slice(1)}</option>)}
                </select>
              </Label>
              <Label className="grid gap-1">Status
                <select className={selectClass} value={form.targetStatus} disabled={form.action.type === 'pause' || form.action.type === 'activate'} onChange={(e) => set({ targetStatus: e.target.value as RuleBody['targetStatus'] })}>
                  <option value="active">Ativos (entregando)</option>
                  <option value="paused">Pausados</option>
                </select>
              </Label>
              <Label className="grid gap-1 sm:col-span-2">Nome contém (opcional)
                <Input value={form.nameContains ?? ''} maxLength={100} onChange={(e) => set({ nameContains: e.target.value.trim() ? e.target.value : null })} placeholder="Ex.: [TESTE]" />
              </Label>
            </div>
            {accounts.length > 1 && (
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="text-muted-foreground">Contas:</span>
                {accounts.map((a) => (
                  <label key={a.id} className="flex items-center gap-1.5">
                    <input
                      type="checkbox" className="accent-primary" checked={form.accountIds.includes(a.id)}
                      onChange={(e) => set({ accountIds: e.target.checked ? [...form.accountIds, a.id] : form.accountIds.filter((x) => x !== a.id) })}
                    />
                    {a.name} <span className="text-xs text-muted-foreground">{a.currency}</span>
                  </label>
                ))}
                {form.accountIds.length === 0 && <span className="text-xs text-muted-foreground">(nenhuma marcada = todas)</span>}
              </div>
            )}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Quando</legend>
            <Label className="grid max-w-xs gap-1">Janela dos números
              <select className={selectClass} value={form.window} onChange={(e) => set({ window: e.target.value as RuleBody['window'] })}>
                {catalog.windows.map((w) => <option key={w} value={w}>{windowLabel(w)}</option>)}
              </select>
            </Label>
            {form.conditions.map((condition, index) => {
              const unit = units.get(condition.metric);
              const range = condition.operator === 'between' || condition.operator === 'not_between';
              return (
                <div key={index} className="grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-[1.4fr_1fr_1fr_1fr_auto] sm:items-end">
                  <Label className="grid gap-1 text-xs">Métrica
                    <select className={selectClass} value={condition.metric} onChange={(e) => setCondition(index, { metric: e.target.value as RuleCondition['metric'] })}>
                      {catalog.metrics.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                    </select>
                  </Label>
                  <Label className="grid gap-1 text-xs">Comparação
                    <select className={selectClass} value={condition.operator} onChange={(e) => {
                      const operator = e.target.value as RuleCondition['operator'];
                      setCondition(index, { operator, valueB: operator === 'between' || operator === 'not_between' ? (condition.valueB ?? condition.valueA) : null });
                    }}>
                      {catalog.operators.map((o) => <option key={o} value={o}>{OPERATOR_LABELS[o]}</option>)}
                    </select>
                  </Label>
                  <div className="grid gap-1 text-xs font-medium">Valor
                    <ConditionValue unit={unit} value={condition.valueA} label="Valor" onChange={(v) => setCondition(index, { valueA: v ?? 0 })} />
                  </div>
                  <div className="grid gap-1 text-xs font-medium">{range ? 'e' : ''}
                    {range && <ConditionValue unit={unit} value={condition.valueB} label="Segundo valor" onChange={(v) => setCondition(index, { valueB: v })} />}
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label="Remover condição" disabled={form.conditions.length === 1}
                    onClick={() => set({ conditions: form.conditions.filter((_, i) => i !== index) })}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
            <Button type="button" variant="outline" size="sm" disabled={form.conditions.length >= 10}
              onClick={() => set({ conditions: [...form.conditions, { metric: 'sales', operator: 'lte', valueA: 0, valueB: null }] })}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Condição
            </Button>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Agenda</legend>
            <div className="grid gap-2 sm:grid-cols-4">
              <Label className="grid gap-1">Frequência
                <select className={selectClass} value={form.frequencyMinutes} onChange={(e) => {
                  const frequencyMinutes = Number(e.target.value);
                  set({ frequencyMinutes, dailyHour: frequencyMinutes === 1440 ? form.dailyHour : null });
                }}>
                  {catalog.frequencies.map((f) => <option key={f} value={f}>{frequencyLabel(f)}</option>)}
                </select>
              </Label>
              {form.frequencyMinutes === 1440 && (
                <Label className="grid gap-1">Hora (opcional)
                  <select className={selectClass} value={form.dailyHour ?? ''} onChange={(e) => set({ dailyHour: e.target.value === '' ? null : Number(e.target.value) })}>
                    <option value="">Qualquer</option>
                    {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}h</option>)}
                  </select>
                </Label>
              )}
              <Label className="grid gap-1">Máximo por dia
                <Input type="number" min="1" max="288" placeholder="Sem limite" value={form.maxRunsPerDay ?? ''}
                  onChange={(e) => set({ maxRunsPerDay: e.target.value === '' ? null : Number(e.target.value) })} />
              </Label>
              <div className="grid gap-1">
                <span className="text-sm font-medium">Só entre (horário de Brasília)</span>
                <div className="flex items-center gap-1">
                  <select aria-label="Início da faixa" className={selectClass} value={form.hourStart ?? ''} onChange={(e) => {
                    const v = e.target.value === '' ? null : Number(e.target.value);
                    set({ hourStart: v, hourEnd: v === null ? null : (form.hourEnd ?? 23) });
                  }}>
                    <option value="">Qualquer hora</option>
                    {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}h</option>)}
                  </select>
                  {form.hourStart !== null && (
                    <select aria-label="Fim da faixa" className={selectClass} value={form.hourEnd ?? ''} onChange={(e) => set({ hourEnd: Number(e.target.value) })}>
                      {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}h</option>)}
                    </select>
                  )}
                </div>
              </div>
            </div>
          </fieldset>

          {simulation.data && <SimulationResult result={simulation.data} units={units} />}
          {simulation.isError && <p role="alert" className="text-sm text-destructive">{(simulation.error as Error).message}</p>}
          {error && <p className="text-sm text-muted-foreground">{error}</p>}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button type="button" variant="outline" onClick={() => simulation.mutate(form)} disabled={!!error || simulation.isPending}>
            {simulation.isPending ? 'Simulando...' : 'Simular agora'}
          </Button>
          <Button type="button" onClick={() => onSave(form)} disabled={!!error || busy}>{busy ? 'Salvando...' : 'Salvar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SimulationResult({ result, units }: { result: SimulationResponse; units: Map<string, MetricUnit> }) {
  const { mask, scrub } = useMask();
  return (
    <section className="space-y-2 rounded-lg border border-border p-3" aria-live="polite">
      <p className="text-sm font-semibold">
        Simulação: {result.matches.length} de {result.evaluated} itens casariam agora
        <span className="ml-1 font-normal text-muted-foreground">({result.since === result.until ? result.since.split('-').reverse().join('/') : `${result.since.split('-').reverse().join('/')} a ${result.until.split('-').reverse().join('/')}`})</span>
      </p>
      {result.warnings.map((w) => <p key={w} className="rounded-md bg-foreground/5 px-2 py-1.5 text-sm">{scrub(w)}</p>)}
      {result.matches.length > 0 && (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="p-1.5">Item</th><th className="p-1.5">Condições</th><th className="p-1.5">Ação</th>
              </tr>
            </thead>
            <tbody>
              {result.matches.map((m) => (
                <tr key={m.objectId} className="border-b border-border/60 align-top">
                  <td className="max-w-[16rem] p-1.5"><span className="block truncate" title={mask(m.level, m.name)}>{mask(m.level, m.name)}</span></td>
                  <td className="p-1.5 text-xs">
                    {m.conditions.map((c, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {c.ok ? <Check className="h-3 w-3 text-success" aria-label="bate" /> : <X className="h-3 w-3 text-destructive" aria-label="não bate" />}
                        {formatMetricValue(c.actual, units.get(c.metric))} {OPERATOR_SYMBOLS[c.operator]} {formatMetricValue(c.valueA, units.get(c.metric))}
                        {c.valueB !== null && <> e {formatMetricValue(c.valueB, units.get(c.metric))}</>}
                      </span>
                    ))}
                  </td>
                  <td className="whitespace-nowrap p-1.5 text-xs">
                    {m.action.skipped ? <span className="text-muted-foreground">{m.action.skipped}</span> : <>{String(m.action.before ?? '—')} → {String(m.action.after ?? '—')}</>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
