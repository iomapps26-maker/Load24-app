import { createClient } from '@supabase/supabase-js';

// Service-role client: bypasses RLS, used only after we've verified the caller's JWT.
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Builds a client scoped to the caller's own JWT, so Postgres RLS policies apply
// exactly as they would if the mobile app talked to Supabase directly.
//
// Memoised by token: under load one user fires many requests in quick
// succession all carrying the same access token (the Home screen alone makes
// ~7), and constructing a fresh @supabase/supabase-js client each time — with
// its GoTrue/PostgREST/Realtime/Storage sub-clients — is steady allocation and
// GC churn on the single event loop. The client only carries a static auth
// header and does no background work (autoRefreshToken/persistSession off), so
// it's safe to share across concurrent requests with the same token. Entries
// expire well before a Supabase access token's ~1h lifetime, and the map is
// size-capped so a burst of distinct tokens can't grow it without bound.
const userClientCache = new Map(); // token -> { client, createdAt }
const USER_CLIENT_TTL_MS = 5 * 60 * 1000;
const USER_CLIENT_CACHE_MAX = 2000;

export function supabaseForUser(accessToken) {
  const now = Date.now();
  const hit = userClientCache.get(accessToken);
  if (hit && now - hit.createdAt < USER_CLIENT_TTL_MS) return hit.client;

  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false }
  });

  if (userClientCache.size >= USER_CLIENT_CACHE_MAX) {
    // Oldest-inserted first (Map preserves insertion order) — cheap eviction,
    // good enough for a cache this is just trimming, not LRU-optimising.
    const oldestKey = userClientCache.keys().next().value;
    userClientCache.delete(oldestKey);
  }
  userClientCache.set(accessToken, { client, createdAt: now });
  return client;
}
