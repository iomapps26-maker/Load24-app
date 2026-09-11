import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      // Keep a short cache so quick back-and-forth navigation stays instant,
      // but treat anything older than this as stale so it refetches the
      // moment a screen regains focus (App.jsx wires screen navigation and
      // app foreground to react-query's focusManager / refetchQueries). Net
      // effect: open any screen and you see live server data, not a cache
      // left over from a minute ago.
      staleTime: 10_000,
      refetchOnMount: true,
      refetchOnReconnect: true,
      // Needs focus events to fire — React Native has none out of the box,
      // so lib/reactQueryFocus.js bridges AppState into focusManager.
      refetchOnWindowFocus: true
    }
  }
});
