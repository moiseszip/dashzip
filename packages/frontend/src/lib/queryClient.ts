import { QueryClient } from '@tanstack/react-query';

/** Cache único do app: o menu usa para buscar os dados de uma tela antes de abri-la. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      // Trocar de aba e voltar em menos de 1 min não refaz a chamada; o cache
      // fica 15 min em memória (nada de histórico persistido).
      staleTime: 60_000,
      gcTime: 15 * 60_000,
    },
  },
});
