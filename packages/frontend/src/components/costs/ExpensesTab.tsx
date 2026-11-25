import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useToast } from '@/hooks/use-toast';
import {
  CATEGORY_LABELS,
  costsApi,
  displayDate,
  formatBRL,
  type Expense,
  type ExpenseCategory,
  type ExpenseInput,
} from '@/lib/costs';
import { dayInPanel } from '@/lib/timezone';

type PeriodKey = 'this-month' | 'last-month' | '90' | 'this-year';

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'this-month', label: 'Este mês' },
  { key: 'last-month', label: 'Mês passado' },
  { key: '90', label: 'Últimos 90 dias' },
  { key: 'this-year', label: 'Este ano' },
];

function periodRange(key: PeriodKey) {
  const today = dayInPanel();
  const [y, m] = today.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (key === 'this-month') return { since: `${y}-${pad(m)}-01`, until: today };
  if (key === 'last-month') {
    const year = m === 1 ? y - 1 : y;
    const month = m === 1 ? 12 : m - 1;
    return { since: `${year}-${pad(month)}-01`, until: `${year}-${pad(month)}-${pad(lastDay(year, month))}` };
  }
  if (key === 'this-year') return { since: `${y}-01-01`, until: today };
  const start = new Date(`${today}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 89);
  return { since: start.toISOString().slice(0, 10), until: today };
}

const EMPTY: ExpenseInput = {
  description: '', category: 'tools', amountBRL: 0, kind: 'single',
  date: null, startDate: null, endDate: null, recurringDay: null,
};

export function ExpensesTab({ dashboardId }: { dashboardId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [period, setPeriod] = useState<PeriodKey>('this-month');
  const range = useMemo(() => periodRange(period), [period]);
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const [removing, setRemoving] = useState<Expense | null>(null);

  const query = useQuery({
    queryKey: ['expenses', dashboardId, range.since, range.until],
    queryFn: () => costsApi.expenses(dashboardId, range.since, range.until),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['expenses', dashboardId] });
    void queryClient.invalidateQueries({ queryKey: ['finance', dashboardId] });
    void queryClient.invalidateQueries({ queryKey: ['summary', dashboardId] });
  };
  const fail = (error: Error) => toast({ title: 'Não foi possível salvar', description: error.message, variant: 'destructive' });

  const save = useMutation({
    mutationFn: ({ id, input }: { id?: string; input: ExpenseInput }) =>
      id ? costsApi.updateExpense(dashboardId, id, input) : costsApi.createExpense(dashboardId, input),
    onSuccess: () => { invalidate(); setEditing(null); toast({ title: 'Despesa salva' }); },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => costsApi.deleteExpense(dashboardId, id),
    onSuccess: () => { invalidate(); setRemoving(null); toast({ title: 'Despesa apagada' }); },
    onError: fail,
  });

  const data = query.data;
  const byCategory = useMemo(() => {
    const totals = new Map<ExpenseCategory, number>();
    for (const o of data?.occurrences ?? []) totals.set(o.category, (totals.get(o.category) ?? 0) + o.amountBRL);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <select aria-label="Período das despesas" className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)}>
          {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <Button size="sm" onClick={() => setEditing('new')}><Plus className="mr-1.5 h-4 w-4" /> Nova despesa</Button>
      </div>

      {query.isPending && <p role="status" className="text-sm text-muted-foreground">Carregando despesas…</p>}
      {query.isError && <p role="alert" className="text-sm text-destructive">{query.error.message}</p>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardContent className="space-y-1 p-5">
                <p className="text-sm text-muted-foreground">Total no período</p>
                <p className="text-2xl font-semibold tabular-nums">{formatBRL(data.totalBRL)}</p>
                <p className="text-xs text-muted-foreground">{displayDate(data.since)} a {displayDate(data.until)} · sai do lucro em Resultado</p>
              </CardContent>
            </Card>
            {byCategory.slice(0, 3).map(([category, total]) => (
              <Card key={category}>
                <CardContent className="space-y-1 p-5">
                  <p className="text-sm text-muted-foreground">{CATEGORY_LABELS[category]}</p>
                  <p className="text-2xl font-semibold tabular-nums">{formatBRL(total)}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Lançamentos do período</CardTitle></CardHeader>
            <CardContent>
              {data.occurrences.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma despesa neste período.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="p-2">Data</th><th className="p-2">Descrição</th><th className="p-2">Categoria</th><th className="p-2 text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.occurrences.map((o) => (
                        <tr key={`${o.expenseId}:${o.date}`} className="border-b border-border/60">
                          <td className="whitespace-nowrap p-2 tabular-nums">{displayDate(o.date)}</td>
                          <td className="p-2">{o.description}</td>
                          <td className="p-2 text-muted-foreground">{CATEGORY_LABELS[o.category]}</td>
                          <td className="whitespace-nowrap p-2 text-right tabular-nums">{formatBRL(o.amountBRL)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Cadastros</CardTitle></CardHeader>
            <CardContent>
              {data.expenses.length === 0 ? (
                <p className="text-sm text-muted-foreground">Cadastre ferramentas, equipe, contabilidade e outros gastos fixos ou avulsos.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.expenses.map((expense) => (
                    <li key={expense.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{expense.description}</p>
                        <p className="text-xs text-muted-foreground">
                          {CATEGORY_LABELS[expense.category]} · {formatBRL(expense.amountBRL)} ·{' '}
                          {expense.kind === 'single'
                            ? `em ${displayDate(expense.date)}`
                            : `todo dia ${expense.recurringDay}, desde ${displayDate(expense.startDate)}${expense.endDate ? ` até ${displayDate(expense.endDate)}` : ''}`}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Editar ${expense.description}`} onClick={() => setEditing(expense)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Apagar ${expense.description}`} onClick={() => setRemoving(expense)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <ExpenseDialog
        expense={editing}
        busy={save.isPending}
        onClose={() => setEditing(null)}
        onSubmit={(input) => save.mutate({ id: editing && editing !== 'new' ? editing.id : undefined, input })}
      />

      <Dialog open={removing !== null} onOpenChange={(open) => { if (!open && !remove.isPending) setRemoving(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apagar "{removing?.description}"?</DialogTitle>
            <DialogDescription>
              {removing?.kind === 'recurring'
                ? 'Todas as ocorrências desta despesa recorrente saem do resultado, inclusive as de meses passados. Para encerrar a partir de hoje, edite e informe a data final.'
                : 'A despesa sai do resultado do período.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)} disabled={remove.isPending}>Cancelar</Button>
            <Button variant="destructive" onClick={() => removing && remove.mutate(removing.id)} disabled={remove.isPending}>
              {remove.isPending ? 'Apagando...' : 'Apagar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ExpenseDialog({ expense, busy, onClose, onSubmit }: {
  expense: Expense | 'new' | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: ExpenseInput) => void;
}) {
  const [form, setForm] = useState<ExpenseInput>(EMPTY);
  const [amount, setAmount] = useState('');

  useEffect(() => {
    if (expense === null) return;
    if (expense === 'new') {
      setForm({ ...EMPTY, date: dayInPanel() });
      setAmount('');
    } else {
      const { id: _id, ...rest } = expense;
      setForm(rest);
      setAmount(String(expense.amountBRL).replace('.', ','));
    }
  }, [expense]);

  const parsed = Number(amount.replace(/\./g, '').replace(',', '.'));
  const validAmount = amount.trim() !== '' && Number.isFinite(parsed) && parsed > 0;
  const valid = form.description.trim().length > 0 && validAmount &&
    (form.kind === 'single' ? !!form.date : !!form.startDate && !!form.recurringDay && form.recurringDay >= 1 && form.recurringDay <= 28 &&
      (!form.endDate || form.endDate >= form.startDate!));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    onSubmit({
      ...form,
      description: form.description.trim(),
      amountBRL: Math.round(parsed * 100) / 100,
      date: form.kind === 'single' ? form.date : null,
      startDate: form.kind === 'recurring' ? form.startDate : null,
      endDate: form.kind === 'recurring' ? form.endDate || null : null,
      recurringDay: form.kind === 'recurring' ? form.recurringDay : null,
    });
  };

  const set = (patch: Partial<ExpenseInput>) => setForm((current) => ({ ...current, ...patch }));
  const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';

  return (
    <Dialog open={expense !== null} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{expense === 'new' ? 'Nova despesa' : 'Editar despesa'}</DialogTitle>
            <DialogDescription>Entra no lucro do Resultado e do Resumo na data em que ocorre.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Label className="grid gap-1.5 sm:col-span-2">Descrição
              <Input value={form.description} maxLength={120} autoFocus onChange={(e) => set({ description: e.target.value })} placeholder="Ex.: Canva Pro" />
            </Label>
            <Label className="grid gap-1.5">Categoria
              <select className={selectClass} value={form.category} onChange={(e) => set({ category: e.target.value as ExpenseCategory })}>
                {(Object.keys(CATEGORY_LABELS) as ExpenseCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select>
            </Label>
            <Label className="grid gap-1.5">Valor (R$)
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
            </Label>
            <fieldset className="grid gap-1.5 sm:col-span-2">
              <legend className="text-sm font-medium">Frequência</legend>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" name="kind" className="accent-primary" checked={form.kind === 'single'}
                    onChange={() => set({ kind: 'single', date: form.date ?? dayInPanel() })} /> Avulsa
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="kind" className="accent-primary" checked={form.kind === 'recurring'}
                    onChange={() => set({ kind: 'recurring', startDate: form.startDate ?? dayInPanel(), recurringDay: form.recurringDay ?? Math.min(28, Number(dayInPanel().slice(8))) })} /> Todo mês
                </label>
              </div>
            </fieldset>
            {form.kind === 'single' ? (
              <Label className="grid gap-1.5">Data
                <Input type="date" value={form.date ?? ''} onChange={(e) => set({ date: e.target.value || null })} />
              </Label>
            ) : (
              <>
                <Label className="grid gap-1.5">Dia do mês (1 a 28)
                  <Input type="number" min="1" max="28" value={form.recurringDay ?? ''} onChange={(e) => set({ recurringDay: e.target.value === '' ? null : Number(e.target.value) })} />
                </Label>
                <Label className="grid gap-1.5">A partir de
                  <Input type="date" value={form.startDate ?? ''} onChange={(e) => set({ startDate: e.target.value || null })} />
                </Label>
                <Label className="grid gap-1.5">Até (opcional)
                  <Input type="date" value={form.endDate ?? ''} min={form.startDate ?? undefined} onChange={(e) => set({ endDate: e.target.value || null })} />
                </Label>
              </>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button type="submit" disabled={!valid || busy}>{busy ? 'Salvando...' : 'Salvar'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
