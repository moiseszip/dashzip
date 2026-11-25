import { useEffect, useMemo, useState } from 'react';

/**
 * Seleção da lista que acompanha a mensagem mais nova, como o Tag Assistant —
 * até a pessoa clicar numa. Clicar na última volta a acompanhar.
 */
export function useFollowSelection<T extends { id: string }>(items: T[]) {
  const [pinned, setPinned] = useState<string | null>(null);

  // Item fixado que sumiu (lista limpa): volta a acompanhar.
  useEffect(() => {
    if (pinned && !items.some((i) => i.id === pinned)) setPinned(null);
  }, [items, pinned]);

  const selected = useMemo(
    () => (pinned ? items.find((i) => i.id === pinned) : undefined) ?? items[items.length - 1] ?? null,
    [items, pinned],
  );

  const select = (id: string) => setPinned(id === items[items.length - 1]?.id ? null : id);

  return { selected, select };
}
