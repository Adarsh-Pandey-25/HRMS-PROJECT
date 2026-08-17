import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 15 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 1,
      // Refetch when revisiting a screen if data was invalidated by a mutation
      refetchOnMount: true,
    },
    mutations: {
      retry: 0,
    },
  },
});
