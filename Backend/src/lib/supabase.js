import { createClient } from '@supabase/supabase-js';

// Service-role client: bypasses RLS, used only after we've verified the caller's JWT.
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Builds a client scoped to the caller's own JWT, so Postgres RLS policies apply
// exactly as they would if the mobile app talked to Supabase directly.
export function supabaseForUser(accessToken) {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false }
  });
}
