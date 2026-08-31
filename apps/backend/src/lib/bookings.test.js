import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory public.bookings behind the service-role client. The builder
// covers the shapes lib/bookings.js uses: insert().select().single(),
// select().eq()[.neq()].maybeSingle(), and update().eq().in().select().maybeSingle().
const db = { bookings: [] };
let seq = 0;
let insertError = null; // set to an { code } to simulate a constraint hit

function matcher(preds) {
  return (r) => preds.every((p) => p(r));
}

vi.mock('./supabase.js', () => ({
  supabaseAdmin: {
    from(table) {
      if (table !== 'bookings') throw new Error(`unexpected table ${table}`);
      const preds = [];
      const builder = {
        select: () => builder,
        eq: (f, v) => (preds.push((r) => r[f] === v), builder),
        neq: (f, v) => (preds.push((r) => r[f] !== v), builder),
        in: (f, vals) => (preds.push((r) => vals.includes(r[f])), builder),
        maybeSingle: () => Promise.resolve({ data: db.bookings.find(matcher(preds)) ?? null, error: null }),
        single: () => {
          const row = db.bookings.find(matcher(preds));
          return Promise.resolve(row ? { data: row, error: null } : { data: null, error: { message: 'no rows' } });
        },
        insert(row) {
          return {
            select: () => ({
              single: () => {
                if (insertError) return Promise.resolve({ data: null, error: insertError });
                seq += 1;
                const saved = { id: `bk-${seq}`, booking_ref: `BK${String(seq).padStart(6, '0')}`, status: 'confirmed', ...row };
                db.bookings.push(saved);
                return Promise.resolve({ data: saved, error: null });
              }
            })
          };
        },
        update(patch) {
          const upreds = [];
          const chain = {
            eq: (f, v) => (upreds.push((r) => r[f] === v), chain),
            in: (f, vals) => (upreds.push((r) => vals.includes(r[f])), chain),
            select: () => ({
              maybeSingle: () => {
                const row = db.bookings.find(matcher(upreds));
                if (!row) return Promise.resolve({ data: null, error: null });
                Object.assign(row, patch);
                return Promise.resolve({ data: row, error: null });
              }
            })
          };
          return chain;
        }
      };
      return builder;
    }
  }
}));

const {
  createBookingForConfirmedBid,
  getBookingByBidId,
  getBookingByLoadId,
  ensureBooking,
  completeBookingForLoad,
  cancelBookingForLoad
} = await import('./bookings.js');

const load = { id: 'load-1', posted_by: 'poster@example.com' };
const bid = { id: 'bid-1', bid_by_email: 'trucker@example.com', amount: 5000, security_hold_txn_id: 'h1', security_hold_amount: 1000 };

beforeEach(() => {
  db.bookings = [];
  seq = 0;
  insertError = null;
});

describe('createBookingForConfirmedBid', () => {
  it('inserts a booking carrying the two parties, agreed amount and hold snapshot', async () => {
    const booking = await createBookingForConfirmedBid({ load, bid });
    expect(booking).toMatchObject({
      booking_ref: 'BK000001',
      load_id: 'load-1',
      bid_id: 'bid-1',
      poster_email: 'poster@example.com',
      accepter_email: 'trucker@example.com',
      amount: 5000,
      status: 'confirmed',
      security_hold_txn_id: 'h1',
      security_hold_amount: 1000
    });
    expect(db.bookings).toHaveLength(1);
  });

  it('is idempotent on bid_id — a 23505 returns the existing booking, not a second row', async () => {
    const first = await createBookingForConfirmedBid({ load, bid });
    insertError = { code: '23505', message: 'duplicate key value violates unique constraint "bookings_bid_id_key"' };
    const second = await createBookingForConfirmedBid({ load, bid });
    expect(second.id).toBe(first.id);
    expect(db.bookings).toHaveLength(1);
  });

  it('rethrows a non-unique-violation error', async () => {
    insertError = { code: '23503', message: 'fk violation' };
    await expect(createBookingForConfirmedBid({ load, bid })).rejects.toMatchObject({ code: '23503' });
  });
});

describe('ensureBooking', () => {
  it('returns the existing booking when one is already on record', async () => {
    const created = await createBookingForConfirmedBid({ load, bid });
    const ensured = await ensureBooking({ load, bid });
    expect(ensured.id).toBe(created.id);
    expect(db.bookings).toHaveLength(1);
  });

  it('backfills a booking for an approved bid that has none', async () => {
    const ensured = await ensureBooking({ load, bid });
    expect(ensured).toMatchObject({ booking_ref: 'BK000001', bid_id: 'bid-1' });
    expect(db.bookings).toHaveLength(1);
  });
});

describe('getBookingByLoadId', () => {
  it('returns the live booking and ignores a cancelled one', async () => {
    db.bookings.push(
      { id: 'bk-old', load_id: 'load-1', status: 'cancelled', booking_ref: 'BK000001' },
      { id: 'bk-new', load_id: 'load-1', status: 'confirmed', booking_ref: 'BK000002' }
    );
    const booking = await getBookingByLoadId('load-1');
    expect(booking.id).toBe('bk-new');
  });

  it('returns null when the load has no booking', async () => {
    expect(await getBookingByLoadId('load-x')).toBeNull();
  });
});

describe('getBookingByBidId', () => {
  it('finds the booking for a bid', async () => {
    await createBookingForConfirmedBid({ load, bid });
    const booking = await getBookingByBidId('bid-1');
    expect(booking.bid_id).toBe('bid-1');
  });
});

describe('completeBookingForLoad', () => {
  it('moves an open booking to completed with a timestamp', async () => {
    await createBookingForConfirmedBid({ load, bid });
    const done = await completeBookingForLoad('load-1');
    expect(done).toMatchObject({ status: 'completed' });
    expect(done.completed_at).toBeTruthy();
  });

  it('is a no-op for an already-cancelled booking', async () => {
    db.bookings.push({ id: 'bk-1', load_id: 'load-1', status: 'cancelled' });
    expect(await completeBookingForLoad('load-1')).toBeNull();
    expect(db.bookings[0].status).toBe('cancelled');
  });
});

describe('cancelBookingForLoad', () => {
  it('moves an open booking to cancelled with the reason', async () => {
    await createBookingForConfirmedBid({ load, bid });
    const cancelled = await cancelBookingForLoad('load-1', 'fraud');
    expect(cancelled).toMatchObject({ status: 'cancelled', cancellation_reason: 'fraud' });
    expect(cancelled.cancelled_at).toBeTruthy();
  });

  it('is a no-op for an already-completed booking', async () => {
    db.bookings.push({ id: 'bk-1', load_id: 'load-1', status: 'completed' });
    expect(await cancelBookingForLoad('load-1', 'fraud')).toBeNull();
  });
});
