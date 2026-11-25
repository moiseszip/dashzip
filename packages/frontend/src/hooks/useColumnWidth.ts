import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export const clampWidth = (value: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, value)));

/**
 * Largura de uma coluna arrastável, lembrada por usuário neste navegador (localStorage).
 * Sem storage (aba anônima, bloqueio) a coluna volta ao padrão e continua funcionando.
 */
export function useColumnWidth(name: string, fallback: number, min = 160, max = 640) {
  const { user } = useAuth();
  const key = `dashzip:${user?.id ?? 'anon'}:col-width:${name}`;
  const read = useCallback(() => {
    try {
      const saved = Number(localStorage.getItem(key));
      return saved ? clampWidth(saved, min, max) : fallback;
    } catch {
      return fallback;
    }
  }, [key, fallback, min, max]);
  const [width, setWidth] = useState(read);
  useEffect(() => setWidth(read()), [read]);

  /** Durante o arraste só atualiza a tela; `commit` grava ao soltar. */
  const preview = useCallback((next: number) => setWidth(clampWidth(next, min, max)), [min, max]);
  const commit = useCallback((next: number) => {
    const value = clampWidth(next, min, max);
    setWidth(value);
    try { localStorage.setItem(key, String(value)); } catch { /* sem storage: vale só nesta visita */ }
  }, [key, min, max]);

  return { width, preview, commit, min, max, fallback };
}

/**
 * Larguras de várias colunas de uma tabela, lembradas por usuário neste navegador.
 * `widthOf(key, padrão)` devolve a largura salva ou o padrão da coluna.
 */
export function useColumnWidths(name: string, min = 64, max = 480) {
  const { user } = useAuth();
  const key = `dashzip:${user?.id ?? 'anon'}:col-widths:${name}`;
  const read = useCallback((): Record<string, number> => {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }, [key]);
  const [widths, setWidths] = useState<Record<string, number>>(read);
  useEffect(() => setWidths(read()), [read]);

  const widthOf = useCallback((column: string, fallback: number) => {
    const saved = widths[column];
    return saved ? clampWidth(saved, min, max) : fallback;
  }, [widths, min, max]);
  const preview = useCallback((column: string, next: number) => {
    setWidths((current) => ({ ...current, [column]: clampWidth(next, min, max) }));
  }, [min, max]);
  const commit = useCallback((column: string, next: number) => {
    setWidths((current) => {
      const merged = { ...current, [column]: clampWidth(next, min, max) };
      try { localStorage.setItem(key, JSON.stringify(merged)); } catch { /* sem storage: vale só nesta visita */ }
      return merged;
    });
  }, [key, min, max]);
  const reset = useCallback((column: string) => {
    setWidths((current) => {
      const { [column]: _removed, ...rest } = current;
      try { localStorage.setItem(key, JSON.stringify(rest)); } catch { /* sem storage */ }
      return rest;
    });
  }, [key]);

  return { widthOf, preview, commit, reset, min, max };
}
