import { useId, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { addMonths, differenceInCalendarDays, eachDayOfInterval, endOfMonth, format, parseISO, startOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useIsPhone } from '@/hooks/useMediaQuery';
import { dayInPanel } from '@/lib/timezone';
import { RESULT_DATE_PRESETS, calendarDay, formatResultRange, resultPresetRange, type ResultDateSelection } from '@/lib/resultDates';
import type { SummaryDateRange } from '@/lib/summary';
import { cn } from '@/lib/utils';

const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const maxDays = 92;

/**
 * Seletor de período padrão do app (Resultado, Acompanhamento de testes, Campanhas e Vendas).
 * `showCompare` mostra a caixa "Comparar com o último período" só onde a tela usa a comparação.
 * No celular abre como bottom sheet, com dias e pré-definidos de 44px de altura.
 */
export function ResultDatePicker({ value, onApply, showCompare = true, className, align = 'start' }: {
  value: ResultDateSelection;
  onApply: (selection: ResultDateSelection) => void;
  showCompare?: boolean;
  className?: string;
  /** Lado do botão em que o painel se alinha; use 'end' quando o botão fica na borda direita. */
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const label = RESULT_DATE_PRESETS.find((option) => option.id === value.preset)?.label ?? formatResultRange(value.range);
  const phone = useIsPhone();
  const trigger = (
    <Button type="button" size="sm" variant="outline" className={cn('h-11 w-full justify-between gap-2 font-normal sm:h-9', className)}
      aria-label={`Data: ${label}`} onClick={phone ? () => setOpen(true) : undefined}>
      <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
    </Button>
  );

  if (phone) {
    return (
      <>
        {trigger}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="gap-0 p-0 pb-[env(safe-area-inset-bottom)] pt-2" aria-describedby={undefined}>
            <DialogTitle className="border-b border-border px-5 pb-3 pt-2 text-base">Selecionar período</DialogTitle>
            <DateRangeForm initial={value} showCompare={showCompare} onApply={(next) => { onApply(next); setOpen(false); }} />
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom" align={align} sideOffset={6} collisionPadding={12} avoidCollisions={false} hideWhenDetached
          aria-labelledby={titleId}
          className="z-50 max-h-[var(--radix-popover-content-available-height)] w-[610px] max-w-[var(--radix-popover-content-available-width)] overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover text-popover-foreground shadow-xl"
        >
          <h2 id={titleId} className="border-b border-border px-5 py-4 font-semibold">Selecionar período</h2>
          <DateRangeForm initial={value} showCompare={showCompare} onApply={(next) => { onApply(next); setOpen(false); }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function DateRangeForm({ initial, onApply, showCompare }: {
  initial: ResultDateSelection;
  showCompare: boolean;
  onApply: (selection: ResultDateSelection) => void;
}) {
  const today = dayInPanel();
  const [preset, setPreset] = useState(initial.preset);
  const [since, setSince] = useState<string | null>(initial.range.since);
  const [until, setUntil] = useState<string | null>(initial.range.until);
  const [compare, setCompare] = useState(initial.compare);
  const [month, setMonth] = useState(() => startOfMonth(parseISO(initial.range.until)));
  const days = eachDayOfInterval({ start: month, end: endOfMonth(month) });
  const range: SummaryDateRange | null = since && until ? { since, until } : null;
  const isTooLong = !!range && differenceInCalendarDays(parseISO(range.until), parseISO(range.since)) >= maxDays;

  function clearRange() {
    setPreset('custom');
    setSince(null);
    setUntil(null);
  }

  function selectDay(day: string) {
    setPreset('custom');
    if (!since || until) {
      setSince(day);
      setUntil(null);
      return;
    }
    setSince(day < since ? day : since);
    setUntil(day < since ? since : day);
  }

  return (
    <form onSubmit={(event) => {
      event.preventDefault();
      if (range && !isTooLong) onApply({ range, preset, compare });
    }}>
      <div className="grid sm:grid-cols-[11rem_minmax(0,1fr)]">
        <div className="border-b border-border p-3 sm:border-b-0 sm:border-r">
          <p className="px-2 pb-2 text-xs font-medium text-muted-foreground">Pré-definidos</p>
          <div className="grid grid-cols-2 gap-0.5 sm:grid-cols-1">
            {RESULT_DATE_PRESETS.map((option) => (
              <Button key={option.id} type="button" variant="ghost" className={cn('h-11 justify-start px-2 font-normal sm:h-8', preset === option.id && 'bg-accent text-accent-foreground')}
                aria-pressed={preset === option.id}
                onClick={() => {
                  // Pré-definido aplica na hora e fecha; o Aplicar fica para o personalizado e a comparação.
                  const next = resultPresetRange(option.id, today);
                  setPreset(option.id);
                  setSince(next.since);
                  setUntil(next.until);
                  setMonth(startOfMonth(parseISO(next.until)));
                  onApply({ range: next, preset: option.id, compare });
                }}
              >{option.label}</Button>
            ))}
          </div>
          <div className="mt-2 border-t border-border pt-2">
            <Button type="button" variant="ghost" className={cn('h-10 w-full justify-start px-2 font-normal sm:h-8', preset === 'custom' && 'bg-accent text-accent-foreground')}
              aria-pressed={preset === 'custom'} onClick={clearRange}>Personalizado</Button>
          </div>
        </div>

        <div className="min-w-0 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <Button type="button" size="icon" variant="ghost" className="h-10 w-10 sm:h-8 sm:w-8"
              aria-label="Mês anterior" onClick={() => setMonth((value) => addMonths(value, -1))}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <p className="text-sm font-medium capitalize" aria-live="polite">{format(month, "MMMM 'de' yyyy", { locale: ptBR })}</p>
            <Button type="button" size="icon" variant="ghost" className="h-10 w-10 sm:h-8 sm:w-8" aria-label="Próximo mês"
              disabled={format(month, 'yyyy-MM') >= today.slice(0, 7)} onClick={() => setMonth((value) => addMonths(value, 1))}>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <div className="mt-2 grid grid-cols-7 gap-0.5 text-center" role="group" aria-label="Calendário do período">
            {weekdays.map((day) => <span key={day} className="py-1 text-xs text-muted-foreground" aria-hidden="true">{day}</span>)}
            {Array.from({ length: month.getDay() }, (_, index) => <span key={`empty-${index}`} aria-hidden="true" />)}
            {days.map((date) => {
              const day = calendarDay(date);
              const boundary = day === since || day === until;
              const inRange = !!range && day > range.since && day < range.until;
              return (
                <button key={day} type="button" disabled={day > today} onClick={() => selectDay(day)}
                  aria-label={format(date, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
                  aria-current={day === today ? 'date' : undefined} aria-pressed={boundary || inRange}
                  className={cn(
                    'h-11 min-w-0 rounded-md text-sm tabular-nums transition-colors hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-35 sm:h-9',
                    inRange && 'bg-primary/10',
                    boundary && 'bg-primary font-medium text-primary-foreground hover:bg-primary/90',
                    day === today && !boundary && 'font-semibold text-primary',
                  )}
                >{date.getDate()}</button>
              );
            })}
          </div>
          <p className={cn('mt-3 min-h-4 text-xs text-muted-foreground', isTooLong && 'text-destructive')} role="status">
            {isTooLong ? 'Selecione um intervalo de até 92 dias.' : range ? formatResultRange(range) : since ? 'Selecione a data final.' : 'Selecione a data inicial.'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
        {showCompare && (
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-primary sm:h-4 sm:w-4" checked={compare} onChange={(event) => setCompare(event.target.checked)} />
            Comparar com o último período
          </label>
        )}
        <div className="ml-auto flex gap-2">
          <Button type="button" size="sm" variant="outline" className="h-11 sm:h-9" disabled={!since} onClick={clearRange}>Limpar</Button>
          <Button type="submit" size="sm" className="h-11 sm:h-9" disabled={!range || isTooLong}>Aplicar</Button>
        </div>
      </div>
    </form>
  );
}
