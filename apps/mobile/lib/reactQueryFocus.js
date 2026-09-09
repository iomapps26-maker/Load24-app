import { AppState } from 'react-native';
import { focusManager } from '@tanstack/react-query';

// react-query's `refetchOnWindowFocus` needs focus events to work. The web
// build gets them from the browser; React Native emits none, so without this
// bridge "refetch when the user comes back to the app" never fires and the
// screen keeps showing whatever was cached before the app was backgrounded.
//
// Wiring it to AppState means returning to the foreground refetches every
// on-screen query that's past its staleTime — wallet balance, load list, bid
// statuses, KYC state — so the app catches up to the server instead of
// sitting on a stale cache. Backgrounding sets focus false so nothing keeps
// refetching while the app isn't visible.
//
// Imported for its side effect once, from App.jsx, before the app renders.
focusManager.setEventListener((handleFocus) => {
  const subscription = AppState.addEventListener('change', (state) => {
    handleFocus(state === 'active');
  });
  return () => subscription.remove();
});
