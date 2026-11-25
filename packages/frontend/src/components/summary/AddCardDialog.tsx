import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { SummaryResponse } from '@/lib/summary';

/**
 * "Adicionar card": o catálogo inteiro, por categoria, com busca. Qualquer card ou
 * gráfico vai para a seção escolhida; o que já está em outra seção é movido.
 */

export interface CatalogEntry { key: string; label: string; category: string; chart: boolean; hint?: string }

export function catalogEntries(catalog: SummaryResponse['catalog']): CatalogEntry[] {
  return [
    ...catalog.cards.map((c) => ({ key: c.key, label: c.label, category: c.category, chart: false, hint: c.hint })),
    ...catalog.charts.map((c) => ({ key: c.key, label: c.label, category: c.category, chart: true })),
  ];
}

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function AddCardDialog({ open, onOpenChange, sectionTitle, catalog, placedIn, targetSection, onPick }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sectionTitle: string;
  catalog: SummaryResponse['catalog'];
  /** Seção onde cada item já está (título), para mostrar "em Geral" e mover. */
  placedIn: Map<string, { sectionKey: string; title: string }>;
  targetSection: string;
  onPick: (key: string) => void;
}) {
  const [query, setQuery] = useState('');
  const entries = useMemo(() => catalogEntries(catalog), [catalog]);
  const q = fold(query.trim());
  const groups = catalog.categories
    .map((category) => ({
      ...category,
      items: entries.filter((e) => e.category === category.key && (!q || fold(`${e.label} ${e.hint ?? ''}`).includes(q))),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) setQuery(''); }}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Adicionar card</DialogTitle>
          <DialogDescription>Escolha qualquer card ou gráfico para a seção “{sectionTitle || 'sem título'}”.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar card ou gráfico" className="pl-8" aria-label="Buscar card ou gráfico" />
        </div>
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {groups.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nada encontrado.</p>}
          {groups.map((group) => (
            <section key={group.key} className="mb-4" aria-label={group.title}>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.title}</h3>
              <ul className="divide-y divide-border/60 rounded-md border border-border">
                {group.items.map((entry) => {
                  const where = placedIn.get(entry.key);
                  return (
                    <li key={entry.key} className="flex items-center gap-2 px-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm" title={entry.label}>{entry.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {entry.chart ? 'Gráfico' : 'Card'}{entry.hint ? ` · ${entry.hint}` : ''}{where ? ` · em ${where.title || 'seção sem título'}` : ''}
                        </span>
                      </span>
                      <Button
                        size="sm" variant={where ? 'ghost' : 'outline'} className="h-7 shrink-0"
                        disabled={where?.sectionKey === targetSection} onClick={() => onPick(entry.key)}
                      >
                        {where?.sectionKey === targetSection ? 'Nesta seção' : where ? 'Mover para cá' : 'Adicionar'}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
