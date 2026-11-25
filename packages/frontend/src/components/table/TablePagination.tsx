import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Rodapé "1–25 de 80" com anterior/próxima. Some quando tudo cabe numa página. */
export function TablePagination({ page, pages, total, size, noun, onPage }: {
  page: number;
  pages: number;
  total: number;
  size: number;
  noun: string;
  onPage: (page: number) => void;
}) {
  if (total <= size) return null;
  const from = (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  return (
    <nav className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground" aria-label="Paginação">
      <span className="tabular-nums">{from}–{to} de {total} {noun}</span>
      <div className="flex items-center gap-1">
        <Button type="button" size="sm" variant="outline" className="h-8 px-2" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Página anterior">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <span className="min-w-[4.5rem] text-center tabular-nums" aria-live="polite">Página {page} de {pages}</span>
        <Button type="button" size="sm" variant="outline" className="h-8 px-2" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Próxima página">
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
