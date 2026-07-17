import { supabaseAdmin, supabaseForUser } from '../lib/supabase.js';

// Verifies the Supabase access token sent by the Expo app and attaches:
//   req.user      -> the auth.users record
//   req.supabase  -> a Postgres client scoped to that user (RLS-enforced)
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Invalid or expired token' });

  req.user = data.user;
  req.supabase = supabaseForUser(token);
  next();
}