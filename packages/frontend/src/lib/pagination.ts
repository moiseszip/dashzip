/** Linhas por página nas tabelas de campanhas (Acompanhamento de testes e Campanhas). */
export const PAGE_SIZE = 25;

/** Fatia a lista na página pedida, corrigindo página fora do intervalo. */
export function paginate<T>(items: T[], page: number, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, page), pages);
  return { items: items.slice((current - 1) * size, current * size), page: current, pages, total: items.length };
}
