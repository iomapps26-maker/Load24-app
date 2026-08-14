import { useEffect, useRef, useState } from 'react';
import { lookupPincode } from './pincodeLookup';

// Watches a pincode field and, once it's a full 6 digits, resolves it via
// India Post and hands the result to `onFound(city, state)` — the same
// auto-fill UX ProfileSetupScreen introduced for account creation, factored
// out so every other pincode field in the app (Post Load's loading/unloading
// points, Post Truck Availability's current location, ...) doesn't have to
// hand-roll its own copy. Returns whether a lookup is in flight, for an
// inline spinner on the pincode input.
export function usePincodeAutofill(pincode, onFound) {
  const [loading, setLoading] = useState(false);
  // onFound is typically a fresh closure every render (it usually closes
  // over setForm) — a ref keeps the effect keyed only on `pincode`, instead
  // of re-running (and re-fetching) every render.
  const onFoundRef = useRef(onFound);
  onFoundRef.current = onFound;

  useEffect(() => {
    if (pincode.trim().length !== 6) return;
    let cancelled = false;
    setLoading(true);
    lookupPincode(pincode.trim())
      .then((result) => {
        if (cancelled || !result) return;
        onFoundRef.current(result.city, result.state);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pincode]);

  return loading;
}
