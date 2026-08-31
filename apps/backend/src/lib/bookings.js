import { supabaseAdmin } from './supabase.js';

// Bookings (marketplace spec §8) — the confirmed-trip record. One per approved
// bid, created the moment the poster confirms and carried through to a
// terminal 'completed' / 'cancelled'. See db/migrations/049_add_bookings.sql.
//
// All writes go through supabaseAdmin: RLS on public.bookings only grants
// SELECT (to the two parties + staff), same trust model as the wallet and
// trip_documents modules. `booking_ref` (BKnnnnnn) comes from the column
// default, so nothing here sets it.

// The columns every read here returns — enough to render a trip card / admin
// row and decide a lifecycle transition, without the internal snapshot fields.
export const BOOKING_COLUMNS =
  'id, booking_ref, load_id, bid_id, poster_email, accepter_email, amount, status, confirmed_at, completed_at, cancelled_at, cancellation_reason';

export async function getBookingByBidId(bidId) {
  const { data } = await supabaseAdmin
    .from('bookings')
    .select(BOOKING_COLUMNS)
    .eq('bid_id', bidId)
    .maybeSingle();
  return data ?? null;
}

// The one live (non-cancelled) booking for a load, if any — matches the
// bookings_one_active_per_load index.
export async function getBookingByLoadId(loadId) {
  const { data } = await supabaseAdmin
    .from('bookings')
    .select(BOOKING_COLUMNS)
    .eq('load_id', loadId)
    .neq('status', 'cancelled')
    .maybeSingle();
  return data ?? null;
}

// Creates the booking for a freshly-confirmed bid. Idempotent on bid_id (the
// bookings_bid_id_key unique constraint): a retried confirmation returns the
// existing row rather than a second booking or a 23505. `load` needs id +
// posted_by; `bid` needs id, bid_by_email, amount and the two security-hold
// snapshot fields.
export async function createBookingForConfirmedBid({ load, bid }) {
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .insert({
      load_id: load.id,
      bid_id: bid.id,
      poster_email: load.posted_by,
      accepter_email: bid.bid_by_email,
      amount: bid.amount,
      security_hold_txn_id: bid.security_hold_txn_id ?? null,
      security_hold_amount: bid.security_hold_amount ?? null
    })
    .select(BOOKING_COLUMNS)
    .single();

  if (error) {
    if (error.code === '23505') return getBookingByBidId(bid.id);
    throw error;
  }
  return data;
}

// Guarantees a booking exists for an already-approved bid — covers a
// confirmation that predates this table and the rare case where the
// best-effort create in POST /:id/approve failed. Same "repair on read"
// pattern as the bid-expiry / security-hold sweeps; safe to call on every
// trip-details fetch.
export async function ensureBooking({ load, bid }) {
  return (await getBookingByBidId(bid.id)) ?? createBookingForConfirmedBid({ load, bid });
}

// Terminal transitions. Both are idempotent — they only move a booking that's
// still open ('confirmed' / 'in_transit'), so calling them on an
// already-finished booking is a no-op that returns null. Best-effort at the
// call sites: the load's own status is the source of truth for the trip and
// the booking just mirrors it, so a failure here never fails the deliver /
// cancel it follows.
export async function completeBookingForLoad(loadId, at = new Date()) {
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .update({ status: 'completed', completed_at: at.toISOString() })
    .eq('load_id', loadId)
    .in('status', ['confirmed', 'in_transit'])
    .select(BOOKING_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function cancelBookingForLoad(loadId, reason, at = new Date()) {
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .update({ status: 'cancelled', cancelled_at: at.toISOString(), cancellation_reason: reason ?? null })
    .eq('load_id', loadId)
    .in('status', ['confirmed', 'in_transit'])
    .select(BOOKING_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}
