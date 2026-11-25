import { useEffect, useState } from 'react';

/**
 * Celular: até 767px (abaixo do `md` do Tailwind). É o corte das visões em
 * cards e dos diálogos em bottom sheet; o Resultado usa o próprio (640px).
 */
export const PHONE_QUERY = '(max-width: 767px)';

/** Acompanha uma media query; no primeiro render já devolve o valor certo. */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

export const useIsPhone = () => useMediaQuery(PHONE_QUERY);
