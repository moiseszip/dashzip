import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, Globe, Loader2, Search } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { useMask } from '@/contexts/StreamingModeContext';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import {
  allTimezones, COMMON_TIMEZONES, DEFAULT_TIMEZONE, searchTimezones, timezoneLabel, timezoneOffsetLabel,
} from '@/lib/timezone';
import { cn } from '@/lib/utils';

const MAX_RESULTS = 80;

function nowIn(timeZone: string) {
  try {
    return new Intl.DateTimeFormat('pt-BR', { timeZone, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date());
  } catch {
    return '';
  }
}

/**
 * Fuso do painel ativo. Decide o que é "hoje", "ontem" e "este mês" nos
 * seletores de data e onde o backend corta os dias de vendas, campanhas,
 * testes e regras. Padrão: São Paulo.
 */
export function TimezoneCard() {
  const { activeWorkspace, timezone } = useWorkspaceContext();
  const { updateWorkspaceTimezone } = useWorkspaces();
  const { mask } = useMask();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(timezone);
  const [saving, setSaving] = useState(false);

  // Trocar de painel (ou o fuso salvo chegar da API) recomeça a escolha.
  useEffect(() => {
    setOpen(false);
    setSelected(timezone);
    setQuery('');
  }, [timezone, activeWorkspace?.id]);

  const all = useMemo(() => allTimezones(), []);
  const commonIds = useMemo(() => new Set(COMMON_TIMEZONES.map((tz) => tz.id)), []);
  const results = useMemo(() => {
    if (!query.trim()) return null;
    return searchTimezones(query, all).slice(0, MAX_RESULTS);
  }, [query, all]);

  if (!activeWorkspace) return null;

  const dirty = selected !== timezone;

  const salvar = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    const ok = await updateWorkspaceTimezone(activeWorkspace.id, selected);
    setSaving(false);
    if (ok) {
      setOpen(false);
      toast({
        title: 'Fuso salvo',
        description: `${timezoneLabel(selected)} (${timezoneOffsetLabel(selected)}). Os seletores de data e os cortes do dia já usam o novo fuso.`,
      });
    }
  };

  const option = (id: string) => {
    const isSelected = id === selected;
    return (
      <li key={id}>
        <button
          type="button"
          aria-pressed={isSelected}
          disabled={saving}
          onClick={() => setSelected(id)}
          className={cn(
            'flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
            isSelected ? 'bg-primary/10 text-foreground' : 'hover:bg-foreground/5',
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{timezoneLabel(id)}</span>
            {timezoneLabel(id) !== id && <span className="block truncate text-xs text-muted-foreground">{id}</span>}
          </span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{timezoneOffsetLabel(id)}</span>
          <Check className={cn('h-4 w-4 shrink-0 text-accent-readable', isSelected ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
        </button>
      </li>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
          Fuso horário
        </CardTitle>
        <CardDescription>
          Vale para o painel <span className="font-medium text-foreground">{mask('workspace', activeWorkspace.name)}</span>: define o que é
          "hoje", "ontem" e "este mês" e onde cada dia começa no Resultado, Campanhas, Testes, Vendas e regras.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            if (saving) return;
            if (next) {
              setSelected(timezone);
              setQuery('');
            }
            setOpen(next);
          }}
        >
          <DialogTrigger asChild>
            <button
              type="button"
              aria-label={`Trocar fuso horário. Atual: ${timezoneLabel(timezone)}`}
              className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60"
            >
              <span className="min-w-0 space-y-0.5">
                <span className="block font-medium text-foreground">
                  {timezoneLabel(timezone)}
                  {timezone === DEFAULT_TIMEZONE && <span className="font-normal text-muted-foreground"> (padrão)</span>}
                </span>
                <span className="block text-muted-foreground">{timezoneOffsetLabel(timezone)} · agora {nowIn(timezone)}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          </DialogTrigger>
          <DialogContent
            className="sm:max-w-md"
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              titleRef.current?.focus();
            }}
          >
            <DialogHeader>
              <DialogTitle ref={titleRef} tabIndex={-1}>Trocar fuso horário</DialogTitle>
              <DialogDescription>{mask('workspace', activeWorkspace.name)}</DialogDescription>
            </DialogHeader>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar fuso"
                aria-label="Buscar fuso horário"
                disabled={saving}
                className="pl-9"
              />
            </div>
            <ul aria-label="Fusos horários" className="max-h-[min(42dvh,18rem)] space-y-0.5 overflow-y-auto overscroll-contain rounded-md border border-border p-1">
              {results === null ? (
                <>
                  {COMMON_TIMEZONES.map((tz) => option(tz.id))}
                  {!commonIds.has(selected) && option(selected)}
                </>
              ) : results.length ? (
                results.map(option)
              ) : (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhum fuso encontrado.</li>
              )}
            </ul>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={saving}>Cancelar</Button>
              </DialogClose>
              <Button onClick={() => void salvar()} disabled={!dirty || saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                Salvar fuso
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
