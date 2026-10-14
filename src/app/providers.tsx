import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CACHE_VALIDADE_MS } from '../api/cliente';

/**
 * Cache das consultas à API. Sem nova tentativa automática (quem repete é o polling/`incompleto`, no ritmo
 * combinado com o servidor), e sem polling com a aba em segundo plano: ao voltar a ela, o que venceu é
 * consultado na hora.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      gcTime: CACHE_VALIDADE_MS,
      refetchOnWindowFocus: true,
      refetchIntervalInBackground: false,
      refetchOnReconnect: true,
    },
  },
});

export function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
