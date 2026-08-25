import { supabaseAdmin } from './supabase.js';
import { sendPushToUser } from './push.js';

// Fire-and-forget notification creation: a failure here (bad user id, DB
// hiccup) must never break the request that triggered it — e.g. a bid
// getting placed successfully shouldn't 500 out just because notifying the
// poster failed. Callers await this for ordering, not for its success.
async function insert(userId, { type, title, body, data }) {
  if (!userId) return;
  const { error } = await supabaseAdmin
    .from('notifications')
    .insert({ user_id: userId, type, title, body: body ?? null, data: data ?? {} });
  if (error) console.error('[notify]', type, error);

  // The in-app notification above is the source of truth and always gets
  // created regardless of what happens here — a push is just a best-effort
  // nudge on top of it (silent no-op if Firebase isn't configured, or this
  // user has no registered device — see push.js), never awaited by insert's
  // own callers.
  sendPushToUser(userId, { title, body, data }).catch((err) => console.error('[push] notifyUser failed', err));
}

// Most events in this codebase (loads, load_bids) identify the counterparty
// by email rather than user_id — resolve it via user_profiles the same way
// loadBids.js's profileForEmail does.
async function userIdForEmail(email) {
  const { data } = await supabaseAdmin.from('user_profiles').select('user_id').eq('user_email', email).maybeSingle();
  return data?.user_id ?? null;
}

export async function notifyUser(userId, event) {
  await insert(userId, event);
}

export async function notifyEmail(email, event) {
  await insert(await userIdForEmail(email), event);
}
