import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
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
import { adjustBudget, formatBudgetInput, formatCurrency, parseBudgetInput, type ObjectRow } from '@/lib/campaigns';
import { useMask } from '@/contexts/StreamingModeContext';

type BudgetRow = Pick<ObjectRow, 'id' | 'name' | 'dailyBudget' | 'lifetimeBudget' | 'accountCurrency'>;

interface BudgetDialogProps<T extends BudgetRow> {
  row: T | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (row: T, kind: 'daily' | 'lifetime', value: number) => void;
}

/**
 * Orçamento na moeda da conta (CA em USD recebe valor em dólar). A confirmação
 * mostra o antes e o depois para evitar trocar R$ por US$ sem perceber.
 */
export function BudgetDialog<T extends BudgetRow>({ row, busy, onClose, onConfirm }: BudgetDialogProps<T>) {
  const kind: 'daily' | 'lifetime' = row?.dailyBudget != null || row?.lifetimeBudget == null ? 'daily' : 'lifetime';
  const current = row ? (kind === 'daily' ? row.dailyBudget : row.lifetimeBudget) : null;
  const [value, setValue] = useState('');
  const { mask } = useMask();

  useEffect(() => {
    setValue(current != null ? formatBudgetInput(current) : '');
  }, [row?.id, current]);

  const parsedValue = parseBudgetInput(value);
  const parsed = parsedValue ?? NaN;
  const valid = parsedValue !== null && parsedValue > 0;
  const changed = valid && parsed !== current;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (row && valid && changed) onConfirm(row, kind, Math.round(parsed * 100) / 100);
  };

  return (
    <Dialog open={row !== null} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent>
        {row && (
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Orçamento {kind === 'daily' ? 'diário' : 'total'}</DialogTitle>
              <DialogDescription className="break-words">{mask((row as { level?: 'campaign' | 'adset' | 'ad' }).level ?? 'campaign', row.name)}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="budget-value">Novo valor ({row.accountCurrency})</Label>
              <Input
                id="budget-value"
                inputMode="decimal"
                enterKeyHint="done"
                autoComplete="off"
                autoFocus
                value={value}
                onChange={(event) => setValue(event.target.value)}
                aria-describedby="budget-hint"
                className="h-12 text-lg tabular-nums sm:h-10 sm:text-sm"
              />
              {current != null && current > 0 && (
                <div className="grid grid-cols-4 gap-2" role="group" aria-label="Ajuste rápido sobre o valor atual">
                  {[-20, -10, 10, 20].map((pct) => (
                    <Button key={pct} type="button" variant="outline" className="h-11 px-0 tabular-nums sm:h-9"
                      onClick={() => setValue(formatBudgetInput(adjustBudget(current, pct)))}>
                      {pct > 0 ? '+' : '−'}{Math.abs(pct)}%
                    </Button>
                  ))}
                </div>
              )}
              <p id="budget-hint" className="text-xs text-muted-foreground">
                Atual: {formatCurrency(current, row.accountCurrency)}
                {valid && changed && <> · Novo: {formatCurrency(parsed, row.accountCurrency)}</>}
                . O valor vai direto para a Meta, na moeda da conta.
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
              <Button type="submit" disabled={busy || !valid || !changed}>{busy ? 'Salvando...' : 'Salvar orçamento'}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
