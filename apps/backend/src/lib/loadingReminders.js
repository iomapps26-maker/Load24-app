import { supabaseAdmin } from './supabase.js';
import { notifyEmail } from './notify.js';

// loading_time is free-text historically, but PostLoadScreen's TimeField
// (see components/TimeField.jsx) always writes a 24h "HH:MM" now — anything
// that doesn't match that shape (loads posted before the picker existed, or
// backfilled data) can't be turned into a precise instant, so it's skipped
// rather than guessed at.
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

// This app only serves Indian routes and IST has no DST, so a fixed +05:30
// offset on the ISO string is enough to get the right instant without a
// timezone library.
function loadingInstant(loadingDate, loadingTime) {
  if (!loadingDate || !TIME_RE.test(loadingTime ?? '')) return null;
  const instant = new Date(`${loadingDate}T${loadingTime}:00+05:30`);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

// One pass for one of the three reminders: finds active (confirmed/
// in_transit) bookings that haven't had this particular reminder sent yet,
// fires it at/past its due instant, and marks it sent so the next sweep
// skips it — same de-dup-by-column idempotency as the rest of this job
// family (see index.js's "in-process scheduled jobs" comment).
async function remindOffset({ column, type, title, body, minutesBefore }) {
  const { data: rows, error } = await supabaseAdmin
    .from('bookings')
    .select('id, load_id, poster_email, accepter_email, loads(loading_date, loading_time)')
    .in('status', ['confirmed', 'in_transit'])
    .is(column, null);
  if (error) return console.error('[loading-reminders]', type, 'lookup failed', error);
  if (!rows?.length) return;

  const now = Date.now();
  for (const row of rows) {
    const instant = loadingInstant(row.loads?.loading_date, row.loads?.loading_time);
    if (!instant) continue;
    const dueAt = minutesBefore == null ? instant.getTime() : instant.getTime() - minutesBefore * 60_000;
    if (now < dueAt) continue;

    await Promise.all([
      notifyEmail(row.poster_email, { type, title, body, data: { load_id: row.load_id, booking_id: row.id } }),
      notifyEmail(row.accepter_email, { type, title, body, data: { load_id: row.load_id, booking_id: row.id } })
    ]);

    const { error: markError } = await supabaseAdmin
      .from('bookings')
      .update({ [column]: new Date().toISOString() })
      .eq('id', row.id);
    if (markError) console.error('[loading-reminders]', type, 'failed to mark sent', row.id, markError);
  }
}

export async function sendLoadingReminders() {
  await remindOffset({
    column: 'loading_reminder_1h_sent_at',
    type: 'loading_reminder_1h',
    title: 'Loading in 1 hour',
    body: 'The scheduled loading time for your trip is coming up in about an hour.',
    minutesBefore: 60
  });
  await remindOffset({
    column: 'loading_reminder_20m_sent_at',
    type: 'loading_reminder_20m',
    title: 'Loading in 20 minutes',
    body: 'The scheduled loading time for your trip is coming up in about 20 minutes.',
    minutesBefore: 20
  });
  await remindOffset({
    column: 'loading_time_notified_at',
    type: 'loading_time_reached',
    title: 'Loading time has arrived',
    body: "It's time for the scheduled loading — head to the pickup point if you haven't already.",
    minutesBefore: null
  });
}
