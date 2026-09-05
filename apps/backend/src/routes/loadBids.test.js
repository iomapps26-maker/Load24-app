import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const notifyEmail = vi.fn(() => Promise.resolve());
vi.mock('../lib/notify.js', () => ({
  notifyEmail: (...args) => notifyEmail(...args),
  notifyUser: vi.fn(() => Promise.resolve())
}));

// POST / now reads the tunable bidding settings and the caller's wallet
// balance before accepting a bid — mock getBiddingSettings so these tests can
// drive the security-deposit gate directly, but keep the real
// computeBidSecurityHold slab evaluator (a pure function, covered on its own
// in lib/platformSettings.test.js).
const DEFAULT_DEPOSIT = {
  slabs: [
    { up_to: 10000, amount: 750 },
    { up_to: 20000, amount: 1000 },
    { up_to: 30000, amount: 1100 }
  ],
  above_slab_percent: 1
};
const getBiddingSettings = vi.fn(() =>
  Promise.resolve({ load24_charge_percent: 4, security_deposit: DEFAULT_DEPOSIT })
);
// The bid path reads through getBiddingSettingsCached (a 30s in-process cache
// in front of getBiddingSettings) — point both at the same mock so these
// tests drive the security-deposit gate regardless of which one the route calls.
vi.mock('../lib/platformSettings.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getBiddingSettings: (...args) => getBiddingSettings(...args),
  getBiddingSettingsCached: (...args) => getBiddingSettings(...args)
}));

const getAvailableBalance = vi.fn(() => Promise.resolve(0));
vi.mock('../lib/wallet.js', () => ({
  getOrCreateWallet: vi.fn(() => Promise.resolve({ id: 'wallet-1', balance: 0 })),
  getAvailableBalance: (...args) => getAvailableBalance(...args),
  applyWalletAdjustment: vi.fn(() => Promise.resolve({}))
}));

// §5 bid security hold — place/release/sweep are exercised in
// lib/bidSecurityHold.test.js; here we just assert POST / places one and the
// reject / expiry / deliver paths release one.
const placeBidSecurityHold = vi.fn(() => Promise.resolve({ id: 'hold-txn-1' }));
const releaseBidSecurityHold = vi.fn(() => Promise.resolve({ id: 'release-txn-1' }));
const sweepExpiredBidHolds = vi.fn(() => Promise.resolve());
vi.mock('../lib/bidSecurityHold.js', () => ({
  placeBidSecurityHold: (...args) => placeBidSecurityHold(...args),
  releaseBidSecurityHold: (...args) => releaseBidSecurityHold(...args),
  sweepExpiredBidHolds: (...args) => sweepExpiredBidHolds(...args)
}));

// §8 bookings — the confirmed-trip record. Created on approve, backfilled on
// trip-details read, completed on deliver. The DB mechanics live in
// lib/bookings.js; here the helpers are stubbed and asserted at the call sites.
const createBookingForConfirmedBid = vi.fn(({ bid }) =>
  Promise.resolve({ id: 'bk-1', booking_ref: 'BK000042', status: 'confirmed', bid_id: bid.id })
);
const ensureBooking = vi.fn(({ bid }) =>
  Promise.resolve({ id: 'bk-1', booking_ref: 'BK000042', status: 'confirmed', bid_id: bid.id })
);
const getBookingByLoadId = vi.fn(() => Promise.resolve({ id: 'bk-1', booking_ref: 'BK000042', status: 'confirmed' }));
const completeBookingForLoad = vi.fn(() => Promise.resolve({ id: 'bk-1', status: 'completed' }));
vi.mock('../lib/bookings.js', () => ({
  createBookingForConfirmedBid: (...args) => createBookingForConfirmedBid(...args),
  ensureBooking: (...args) => ensureBooking(...args),
  getBookingByLoadId: (...args) => getBookingByLoadId(...args),
  completeBookingForLoad: (...args) => completeBookingForLoad(...args),
  cancelBookingForLoad: vi.fn(() => Promise.resolve(null)),
  getBookingByBidId: vi.fn(() => Promise.resolve(null)),
  BOOKING_COLUMNS: 'id'
}));

// Records every supabaseAdmin.from('truck_availabilities').update(...).eq(...) call
// so the test can assert both the patch and the filters it was scoped to,
// without simulating real row filtering.
const adminCalls = [];
// In-memory stand-in for the trip_documents table + Storage, used by the
// trip-document route tests below. `rows` is the table; `storageOps` records
// remove()/createSignedUploadUrl() calls.
const tripDocs = { rows: [], storageOps: [] };

// POST /:id/approve and /:id/reject now read+write 'loads'/'load_bids' via
// supabaseAdmin instead of req.supabase (see loadBids.js — RLS's
// posted_by = auth.jwt() ->> 'email' match is no longer the authorization
// boundary for those two routes, an explicit isPoster/isBidReviewStaff check
// in JS is). `approveStore` is pointed at the current test's row-aware store
// by makeApproveSupabase below, so supabaseAdmin.from('loads'|'load_bids')
// and req.supabase.from(...) both read/write the same underlying rows.
// `staffRoles` seeds supabaseAdmin.from('user_roles') for isBidReviewStaff —
// empty (not staff) unless a test sets it.
let approveStore = null;
let staffRoles = [];

// Bidder rows returned by the service-role reads POST /:id/approve now does to
// re-verify the winning bidder at confirmation time (spec §8, assertConfirmable).
// Default: a fully-eligible transporter with no truck. The approve tests mutate
// this to exercise the "no longer eligible" path.
const approveBidder = {
  profile: {
    kyc_status: 'verified',
    is_active: true,
    mobile_verified: true,
    user_type: 'transporter',
    bidding_restricted_until: null,
    bidding_restriction_reason: null
  },
  truck: null
};
vi.mock('../lib/supabase.js', () => ({
  supabaseAdmin: {
    storage: {
      from: (bucket) => ({
        remove: (paths) => {
          tripDocs.storageOps.push(['remove', bucket, paths]);
          return Promise.resolve({ data: null, error: null });
        },
        createSignedUploadUrl: (path) => {
          tripDocs.storageOps.push(['upload-url', bucket, path]);
          return Promise.resolve({ data: { signedUrl: `https://signed.test/${path}`, token: 'tok' }, error: null });
        },
        createSignedUrl: (path) =>
          Promise.resolve({ data: { signedUrl: `https://signed.test/view/${path}` }, error: null })
      })
    },
    from: (table) => {
      if (table === 'truck_availabilities') {
        const call = { table, patch: null, filters: [] };
        adminCalls.push(call);
        const c = {};
        c.update = (patch) => {
          call.patch = patch;
          return c;
        };
        c.eq = (field, value) => {
          call.filters.push([field, value]);
          return c;
        };
        c.then = (resolve) => resolve({ data: null, error: null });
        return c;
      }
      if (table === 'user_profiles') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: approveBidder.profile, error: null }) }) }) };
      }
      if (table === 'trucks') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: approveBidder.truck, error: null }) }) }) };
      }
      if (table === 'loads' || table === 'load_bids') {
        if (!approveStore) throw new Error(`no approveStore set for admin table ${table} — call makeApproveSupabase first`);
        return approveStore.from(table);
      }
      if (table === 'user_roles') {
        return { select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: staffRoles, error: null }) }) }) };
      }
      if (table === 'trip_documents') {
        const q = { _filters: {} };
        q.select = () => q;
        q.eq = (field, value) => {
          q._filters[field] = value;
          return q;
        };
        q.maybeSingle = () => {
          const found = tripDocs.rows.find(
            (r) => Object.entries(q._filters).every(([k, v]) => r[k] === v)
          );
          return Promise.resolve({ data: found ?? null, error: null });
        };
        q.upsert = (row) => {
          const idx = tripDocs.rows.findIndex(
            (r) => r.load_id === row.load_id && r.document_type === row.document_type
          );
          if (idx >= 0) tripDocs.rows[idx] = { ...tripDocs.rows[idx], ...row };
          else tripDocs.rows.push(row);
          return {
            select: () => ({ single: () => Promise.resolve({ data: row, error: null }) })
          };
        };
        return q;
      }
      throw new Error(`unexpected admin table ${table}`);
    }
  }
}));

const { default: loadBidsRouter, __resetExpirySweepCooldown } = await import('./loadBids.js');

// Row-aware stand-in for req.supabase covering the tables POST /:id/approve
// touches: it reads the target bid, claims the load ('active' -> 'matched'),
// flips the bid to 'approved', then rejects the sibling bids. `loads` /
// `load_bids` are arrays of rows; updates mutate them in place so a test can
// assert the resulting state. `beforeApproveUpdate(store)` (optional) fires
// once, just before the guarded bid-approve UPDATE, to simulate a concurrent
// change landing in the gap after the load has been claimed.
function makeApproveSupabase({ loads = [], load_bids = [], beforeApproveUpdate } = {}) {
  const store = { loads, load_bids };
  let hookFired = false;
  const builder = (table) => {
    const preds = [];
    let patch = null;
    const b = {
      select: () => b,
      update: (p) => {
        patch = p;
        return b;
      },
      eq: (f, v) => {
        preds.push((r) => r[f] === v);
        return b;
      },
      neq: (f, v) => {
        preds.push((r) => r[f] !== v);
        return b;
      },
      gt: (f, v) => {
        preds.push((r) => r[f] != null && r[f] > v);
        return b;
      },
      _run: () => {
        if (table === 'load_bids' && patch?.status === 'approved' && beforeApproveUpdate && !hookFired) {
          hookFired = true;
          beforeApproveUpdate(store);
        }
        const rows = (store[table] || []).filter((r) => preds.every((p) => p(r)));
        if (patch) rows.forEach((r) => Object.assign(r, patch));
        return rows;
      },
      maybeSingle: () => Promise.resolve({ data: b._run()[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: b._run()[0] ?? null, error: null }),
      then: (resolve) => resolve({ data: b._run(), error: null })
    };
    return b;
  };
  const supabase = { store, from: builder };
  // POST /:id/approve and /:id/reject read+write 'loads'/'load_bids' through
  // supabaseAdmin, not req.supabase (see the comment above approveStore) —
  // point the shared slot at this same store/builder so both clients agree.
  approveStore = supabase;
  return supabase;
}

function buildApproveApp(seed, callerEmail = 'poster@example.com') {
  // POST /:id/approve now re-checks that the winning bid's §5 security hold is
  // still active before locking the load (spec §8). Give every seeded bid an
  // active hold unless the test set the fields itself. Every seeded load
  // defaults posted_by to the caller so the isPoster authorization check in
  // POST /:id/approve and /:id/reject passes without every test having to set
  // it — a test exercising the poster-mismatch/staff paths overrides it.
  const withHoldDefaults = {
    ...seed,
    loads: (seed.loads || []).map((l) => ({ posted_by: callerEmail, ...l })),
    load_bids: (seed.load_bids || []).map((b) => ({
      security_hold_txn_id: 'hold-default',
      security_hold_released_at: null,
      ...b
    }))
  };
  const supabase = makeApproveSupabase(withHoldDefaults);
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 'poster-1', email: callerEmail };
    req.supabase = supabase;
    next();
  });
  app.use('/api/load-bids', loadBidsRouter);
  app.locals.store = supabase.store;
  return app;
}

const futureIso = () => new Date(Date.now() + 60_000).toISOString();
const pastIso = () => new Date(Date.now() - 60_000).toISOString();

// Stand-in for POST / — it reads the caller's user_profiles row (bid
// eligibility, spec §2), the target load, optionally the caller's chosen
// truck, then their wallet balance (security deposit). Defaults clear every
// condition; each test overrides just the row/field it exercises.
// `insertedRows` captures the load_bids insert payload for pass-through asserts.
function buildBidApp(availableBalance, { callerEmail = 'bidder@example.com', profile = {}, load = {}, truck = null } = {}) {
  getAvailableBalance.mockResolvedValue(availableBalance);
  const profileRow = {
    kyc_status: 'verified',
    is_active: true,
    mobile_verified: true,
    user_type: 'transporter',
    bidding_restricted_until: null,
    bidding_restriction_reason: null,
    ...profile
  };
  const loadRow = {
    posted_by: 'poster@example.com',
    status: 'active',
    required_truck_type: 'tata_407',
    required_truck_type_other: null,
    weight_tons: 5,
    ...load
  };
  const insertedRows = [];
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 'bidder-1', email: callerEmail };
    req.supabase = {
      from(table) {
        if (table === 'user_profiles') {
          return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: profileRow, error: null }) }) }) };
        }
        if (table === 'loads') {
          return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: loadRow, error: null }) }) }) };
        }
        if (table === 'trucks') {
          return {
            select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: truck, error: null }) }) }) })
          };
        }
        if (table === 'load_bids') {
          return {
            insert: (row) => {
              insertedRows.push(row);
              return {
                select: () => ({ single: () => Promise.resolve({ data: { id: 'bid-9', load_id: 'load-1', amount: 5000 }, error: null }) })
              };
            }
          };
        }
        throw new Error(`unexpected table ${table}`);
      }
    };
    next();
  });
  app.use('/api/load-bids', loadBidsRouter);
  app.locals.insertedRows = insertedRows;
  return app;
}

const okTruck = () => ({
  verified: true,
  truck_type: 'tata_407',
  truck_type_other: null,
  capacity_tons: 10,
  permit_expiry: null,
  puc_expiry: null,
  insurance_expiry: null
});

describe('POST /api/load-bids/:id/approve', () => {
  beforeEach(() => {
    adminCalls.length = 0;
    notifyEmail.mockClear();
    releaseBidSecurityHold.mockClear();
    createBookingForConfirmedBid.mockClear();
    createBookingForConfirmedBid.mockResolvedValue({ id: 'bk-1', booking_ref: 'BK000042', status: 'confirmed' });
    getBiddingSettings.mockResolvedValue({ load24_charge_percent: 4, security_deposit: DEFAULT_DEPOSIT });
    approveBidder.profile = {
      kyc_status: 'verified',
      is_active: true,
      mobile_verified: true,
      user_type: 'transporter',
      bidding_restricted_until: null,
      bidding_restriction_reason: null
    };
    approveBidder.truck = null;
    staffRoles = [];
  });

  it('accepts a pending bid, locks the load to matched, and books the truck', async () => {
    const app = buildApproveApp({
      loads: [{ id: 'load-1', status: 'active' }],
      load_bids: [
        {
          id: 'bid-1',
          load_id: 'load-1',
          status: 'pending',
          expires_at: futureIso(),
          truck_id: 'truck-1',
          bid_by_email: 'trucker@example.com',
          amount: 5000
        }
      ]
    });

    const res = await request(app).post('/api/load-bids/bid-1/approve').send({});
    expect(res.status).toBe(200);
    expect(app.locals.store.loads[0].status).toBe('matched');
    expect(app.locals.store.load_bids[0].status).toBe('approved');

    const call = adminCalls.find((c) => c.table === 'truck_availabilities');
    expect(call).toBeTruthy();
    expect(call.patch.status).toBe('booked');
    expect(call.filters).toContainEqual(['truck_id', 'truck-1']);
    expect(call.filters).toContainEqual(['status', 'available']);
  });

  it('skips the truck_availabilities update when the bid has no truck_id', async () => {
    const app = buildApproveApp({
      loads: [{ id: 'load-1', status: 'active' }],
      load_bids: [
        { id: 'bid-2', load_id: 'load-1', status: 'pending', expires_at: futureIso(), truck_id: null, bid_by_email: 'x@example.com', amount: 1000 }
      ]
    });

    const res = await request(app).post('/api/load-bids/bid-2/approve').send({});
    expect(res.status).toBe(200);
    expect(adminCalls.length).toBe(0);
  });

  it('409s a second confirmation once the load is already matched (no double booking)', async () => {
    const app = buildApproveApp({
      loads: [{ id: 'load-1', status: 'matched' }],
      load_bids: [
        { id: 'bid-1', load_id: 'load-1', status: 'approved', expires_at: pastIso(), bid_by_email: 'a@example.com', amount: 5000 },
        { id: 'bid-2', load_id: 'load-1', status: 'pending', expires_at: futureIso(), bid_by_email: 'b@example.com', amount: 6000 }
      ]
    });

    const res = await request(app).post('/api/load-bids/bid-2/approve').send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('load_already_booked');
    expect(app.locals.store.load_bids.find((b) => b.id === 'bid-2').status).toBe('pending');
    expect(adminCalls.length).toBe(0);
  });

  it('rolls the load back to active when the bid stops being pending mid-approve', async () => {
    const app = buildApproveApp({
      loads: [{ id: 'load-1', status: 'active' }],
      load_bids: [
        { id: 'bid-1', load_id: 'load-1', status: 'pending', expires_at: futureIso(), bid_by_email: 'a@example.com', amount: 5000 }
      ],
      beforeApproveUpdate: (store) => {
        store.load_bids[0].status = 'rejected';
      }
    });

    const res = await request(app).post('/api/load-bids/bid-1/approve').send({});
    expect(res.status).toBe(409);
    expect(app.locals.store.loads[0].status).toBe('active');
  });

  it('404s when the bid does not exist', async () => {
    const app = buildApproveApp({ loads: [{ id: 'load-1', status: 'active' }], load_bids: [] });
    const res = await request(app).post('/api/load-bids/ghost/approve').send({});
    expect(res.status).toBe(404);
  });

  it('rejects the losing sibling bids and releases their holds once one is accepted', async () => {
    const app = buildApproveApp({
      loads: [{ id: 'load-1', status: 'active' }],
      load_bids: [
        { id: 'bid-1', load_id: 'load-1', status: 'pending', expires_at: futureIso(), truck_id: null, bid_by_email: 'winner@example.com', amount: 5000 },
        {
          id: 'bid-2',
          load_id: 'load-1',
          status: 'pending',
          expires_at: futureIso(),
          bid_by_email: 'loser1@example.com',
          amount: 6000,
          security_hold_txn_id: 'h2',
          security_hold_amount: 1000,
          security_hold_released_at: null
        },
        {
          id: 'bid-3',
          load_id: 'load-1',
          status: 'pending',
          expires_at: futureIso(),
          bid_by_email: 'loser2@example.com',
          amount: 7000,
          security_hold_txn_id: 'h3',
          security_hold_amount: 1000,
          security_hold_released_at: null
        }
      ]
    });

    const res = await request(app).post('/api/load-bids/bid-1/approve').send({});
    expect(res.status).toBe(200);

    const byId = Object.fromEntries(app.locals.store.load_bids.map((b) => [b.id, b]));
    expect(byId['bid-1'].status).toBe('approved');
    expect(byId['bid-2'].status).toBe('rejected');
    expect(byId['bid-3'].status).toBe('rejected');
    expect(releaseBidSecurityHold).toHaveBeenCalledTimes(2);
    expect(releaseBidSecurityHold).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'bid-2' }),
      { reason: 'another bid was approved' }
    );
  });

  it('creates the booking for the confirmed bid and returns it (spec §8 step 6)', async () => {
    const app = buildApproveApp({
      loads: [{ id: 'load-1', status: 'active', posted_by: 'poster@example.com' }],
      load_bids: [
        { id: 'bid-1', load_id: 'load-1', status: 'pending', expires_at: futureIso(), truck_id: null, bid_by_email: 'trucker@example.com', amount: 5000 }
      ]
    });

    const res = await request(app).post('/api/load-bids/bid-1/approve').send({});
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({ booking_ref: 'BK000042', status: 'confirmed' });
    expect(createBookingForConfirmedBid).toHaveBeenCalledWith({
      load: { id: 'load-1', posted_by: 'poster@example.com' },
      bid: expect.objectContaining({ id: 'bid-1', status: 'approved' })
    });
    expect(notifyEmail).toHaveBeenCalledWith(
      'trucker@example.com',
      expect.objectContaining({ data: expect.objectContaining({ booking_ref: 'BK000042' }) })
    );
  });

  it('still confirms the trip when booking creation fails (best-effort, backfilled on read)', async () => {
    createBookingForConfirmedBid.mockRejectedValueOnce(new Error('bookings insert boom'));
    const app = buildApproveApp({
      loads: [{ id: 'load-1', status: 'active', posted_by: 'poster@example.com' }],
      load_bids: [
        { id: 'bid-1', load_id: 'load-1', status: 'pending', expires_at: futureIso(), truck_id: null, bid_by_email: 'trucker@example.com', amount: 5000 }
      ]
    });

    const res = await request(app).post('/api/load-bids/bid-1/approve').send({});
    expect(res.status).toBe(200);
    expect(res.body.booking).toBeNull();
    expect(app.locals.store.load_bids[0].status).toBe('approved');
    expect(app.locals.store.loads[0].status).toBe('matched');
  });

  it('409s the confirmation when the winning bidder is no longer eligible, leaving the load open', async () => {
    approveBidder.profile.is_active = false;
    const app = buildApproveApp({
      loads: [{ id: 'load-1', status: 'active' }],
      load_bids: [
        { id: 'bid-1', load_id: 'load-1', status: 'pending', expires_at: futureIso(), truck_id: null, bid_by_email: 'trucker@example.com', amount: 5000 }
      ]
    });

    const res = await request(app).post('/api/load-bids/bid-1/approve').send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('bidder_ineligible');
    expect(app.locals.store.loads[0].status).toBe('active');
    expect(app.locals.store.load_bids[0].status).toBe('pending');
    expect(adminCalls.length).toBe(0);
  });

  it('409s the confirmation when the winning bid no longer has an active security hold', async () => {
    const app = buildApproveApp({
      loads: [{ id: 'load-1', status: 'active' }],
      load_bids: [
        {
          id: 'bid-1',
          load_id: 'load-1',
          status: 'pending',
          expires_at: futureIso(),
          truck_id: null,
          bid_by_email: 'trucker@example.com',
          amount: 5000,
          security_hold_txn_id: 'h1',
          security_hold_amount: 750,
          security_hold_released_at: pastIso()
        }
      ]
    });

    const res = await request(app).post('/api/load-bids/bid-1/approve').send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('security_hold_inactive');
    expect(app.locals.store.loads[0].status).toBe('active');
  });

  it('still confirms a bid that was placed while the deposit was disabled (no hold to check)', async () => {
    const app = buildApproveApp({
      loads: [{ id: 'load-1', status: 'active' }],
      load_bids: [
        {
          id: 'bid-1',
          load_id: 'load-1',
          status: 'pending',
          expires_at: futureIso(),
          truck_id: null,
          bid_by_email: 'trucker@example.com',
          amount: 5000,
          security_hold_txn_id: null,
          security_hold_released_at: null
        }
      ]
    });

    const res = await request(app).post('/api/load-bids/bid-1/approve').send({});
    expect(res.status).toBe(200);
    expect(app.locals.store.loads[0].status).toBe('matched');
  });

  it('403s a caller who is neither the load poster nor review staff, without touching the load', async () => {
    const app = buildApproveApp(
      {
        loads: [{ id: 'load-1', status: 'active', posted_by: 'poster@example.com' }],
        load_bids: [
          { id: 'bid-1', load_id: 'load-1', status: 'pending', expires_at: futureIso(), truck_id: null, bid_by_email: 'trucker@example.com', amount: 5000 }
        ]
      },
      'stranger@example.com'
    );

    const res = await request(app).post('/api/load-bids/bid-1/approve').send({});
    expect(res.status).toBe(403);
    expect(app.locals.store.loads[0].status).toBe('active');
    expect(app.locals.store.load_bids[0].status).toBe('pending');
  });

  it('lets review staff approve a bid on a load they did not post', async () => {
    staffRoles = [{ role: 'sales_manager' }];
    const app = buildApproveApp(
      {
        loads: [{ id: 'load-1', status: 'active', posted_by: 'poster@example.com' }],
        load_bids: [
          { id: 'bid-1', load_id: 'load-1', status: 'pending', expires_at: futureIso(), truck_id: null, bid_by_email: 'trucker@example.com', amount: 5000 }
        ]
      },
      'staffer@example.com'
    );

    const res = await request(app).post('/api/load-bids/bid-1/approve').send({});
    expect(res.status).toBe(200);
    expect(app.locals.store.loads[0].status).toBe('matched');
  });
});

describe('POST /api/load-bids — security-deposit gate', () => {
  beforeEach(() => {
    notifyEmail.mockClear();
    placeBidSecurityHold.mockClear();
    placeBidSecurityHold.mockResolvedValue({ id: 'hold-txn-1' });
    getBiddingSettings.mockResolvedValue({ load24_charge_percent: 4, security_deposit: DEFAULT_DEPOSIT });
  });

  // The hold scales with the bid amount via the slab table: a ₹5,000 bid sits
  // in the first slab (≤ 10,000) → ₹750; a ₹25,000 bid → ₹1,100.
  it('rejects the bid with 402 when available balance is below the slab hold for that bid amount', async () => {
    const res = await request(buildBidApp(500)).post('/api/load-bids').send({ load_id: 'load-1', amount: 5000 });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('security_deposit_required');
    expect(res.body.security_deposit_amount).toBe(750);
    expect(placeBidSecurityHold).not.toHaveBeenCalled();
    expect(notifyEmail).not.toHaveBeenCalled();
  });

  it('holds the first-slab amount for a small bid', async () => {
    const app = buildBidApp(1000);
    const res = await request(app).post('/api/load-bids').send({ load_id: 'load-1', amount: 5000 });
    expect(res.status).toBe(201);
    expect(placeBidSecurityHold).toHaveBeenCalledWith({ userId: 'bidder-1', loadId: 'load-1', amount: 750 });
    expect(app.locals.insertedRows[0]).toMatchObject({ security_hold_txn_id: 'hold-txn-1', security_hold_amount: 750 });
    expect(notifyEmail).toHaveBeenCalledWith('poster@example.com', expect.objectContaining({ type: 'bid_placed' }));
  });

  it('holds ₹1,100 + 1% of the excess over 30,000 for a large bid', async () => {
    const app = buildBidApp(5000);
    const res = await request(app).post('/api/load-bids').send({ load_id: 'load-1', amount: 45000 });
    expect(res.status).toBe(201);
    // 1100 + 1% of (45000 - 30000) = 1250
    expect(placeBidSecurityHold).toHaveBeenCalledWith({ userId: 'bidder-1', loadId: 'load-1', amount: 1250 });
    expect(app.locals.insertedRows[0]).toMatchObject({ security_hold_amount: 1250 });
  });

  it('skips the wallet check and the hold when the deposit slab table is empty', async () => {
    getBiddingSettings.mockResolvedValue({
      load24_charge_percent: 4,
      security_deposit: { slabs: [], above_slab_percent: 0 }
    });
    const app = buildBidApp(0);
    const res = await request(app).post('/api/load-bids').send({ load_id: 'load-1', amount: 5000 });
    expect(res.status).toBe(201);
    expect(placeBidSecurityHold).not.toHaveBeenCalled();
    expect(app.locals.insertedRows[0]).toMatchObject({ security_hold_txn_id: null, security_hold_amount: null });
  });

  it('rejects the bid with 403 when the caller has not completed KYC verification', async () => {
    const res = await request(buildBidApp(5000, { profile: { kyc_status: 'submitted' } }))
      .post('/api/load-bids')
      .send({ load_id: 'load-1', amount: 5000 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('kyc_verification_required');
    expect(notifyEmail).not.toHaveBeenCalled();
  });

  it('stores a normalized expected_pickup_at when one is supplied', async () => {
    const app = buildBidApp(5000);
    const res = await request(app)
      .post('/api/load-bids')
      .send({ load_id: 'load-1', amount: 5000, expected_pickup_at: '2026-09-01' });
    expect(res.status).toBe(201);
    expect(app.locals.insertedRows[0].expected_pickup_at).toBe(new Date('2026-09-01').toISOString());
  });

  it('rejects a bid whose expected_pickup_at is not a valid date', async () => {
    const res = await request(buildBidApp(5000))
      .post('/api/load-bids')
      .send({ load_id: 'load-1', amount: 5000, expected_pickup_at: 'next tuesday-ish' });
    expect(res.status).toBe(400);
  });

  it('leaves expected_pickup_at null when the bidder omits it', async () => {
    const app = buildBidApp(5000);
    const res = await request(app).post('/api/load-bids').send({ load_id: 'load-1', amount: 5000 });
    expect(res.status).toBe(201);
    expect(app.locals.insertedRows[0].expected_pickup_at).toBeNull();
  });
});

describe('GET /api/load-bids/mine — attaches the booking to approved bids', () => {
  function buildMineApp(bids, bookings) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = { id: 'bidder-1', email: 'bidder@example.com' };
      req.supabase = {
        from(table) {
          if (table === 'load_bids') {
            return { select: () => ({ eq: () => ({ order: () => ({ range: () => Promise.resolve({ data: bids, error: null }) }) }) }) };
          }
          if (table === 'bookings') {
            return { select: () => ({ in: (_f, ids) => Promise.resolve({ data: bookings.filter((b) => ids.includes(b.bid_id)), error: null }) }) };
          }
          throw new Error(`unexpected table ${table}`);
        }
      };
      next();
    });
    app.use('/api/load-bids', loadBidsRouter);
    return app;
  }

  beforeEach(() => sweepExpiredBidHolds.mockClear());

  it('merges each approved bid with its booking and leaves pending bids alone', async () => {
    const app = buildMineApp(
      [
        { id: 'b1', status: 'approved', load: { id: 'l1' } },
        { id: 'b2', status: 'pending', load: { id: 'l2' } }
      ],
      [{ bid_id: 'b1', booking_ref: 'BK000007', status: 'confirmed' }]
    );

    const res = await request(app).get('/api/load-bids/mine');
    expect(res.status).toBe(200);
    expect(res.body.find((b) => b.id === 'b1').booking).toMatchObject({ booking_ref: 'BK000007', status: 'confirmed' });
    expect(res.body.find((b) => b.id === 'b2').booking).toBeNull();
  });

  it('skips the bookings lookup entirely when the bidder has no approved bids', async () => {
    const app = buildMineApp([{ id: 'b1', status: 'pending', load: { id: 'l1' } }], []);
    const res = await request(app).get('/api/load-bids/mine');
    expect(res.status).toBe(200);
    expect(res.body[0].booking).toBeUndefined();
  });
});

describe('POST /api/load-bids — eligibility gate (spec §2)', () => {
  beforeEach(() => {
    notifyEmail.mockClear();
    getBiddingSettings.mockResolvedValue({ load24_charge_percent: 4, security_deposit: DEFAULT_DEPOSIT });
  });

  const bid = (app, body = {}) => request(app).post('/api/load-bids').send({ load_id: 'load-1', amount: 5000, ...body });

  it('rejects an inactive account with 403 account_inactive', async () => {
    const res = await bid(buildBidApp(5000, { profile: { is_active: false } }));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('account_inactive');
    expect(notifyEmail).not.toHaveBeenCalled();
  });

  it('rejects an unverified mobile with 403 mobile_not_verified', async () => {
    const res = await bid(buildBidApp(5000, { profile: { mobile_verified: false } }));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('mobile_not_verified');
  });

  it('rejects an account under an active bidding restriction, surfacing the reason', async () => {
    const res = await bid(
      buildBidApp(5000, {
        profile: {
          bidding_restricted_until: new Date(Date.now() + 86400000).toISOString(),
          bidding_restriction_reason: 'payment dispute under review'
        }
      })
    );
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('bidding_restricted');
    expect(res.body.error).toContain('payment dispute under review');
  });

  it('requires a vehicle_owner to bid with one of their trucks (403 vehicle_required)', async () => {
    const res = await bid(buildBidApp(5000, { profile: { user_type: 'vehicle_owner' } }));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('vehicle_required');
  });

  it('rejects a vehicle_owner whose truck is not verified', async () => {
    const res = await bid(
      buildBidApp(5000, { profile: { user_type: 'vehicle_owner' }, truck: { ...okTruck(), verified: false } }),
      { truck_id: 'truck-1' }
    );
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('vehicle_not_verified');
  });

  it('rejects a vehicle_owner whose truck type does not match the load', async () => {
    const res = await bid(
      buildBidApp(5000, { profile: { user_type: 'vehicle_owner' }, truck: { ...okTruck(), truck_type: 'trailer' } }),
      { truck_id: 'truck-1' }
    );
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('vehicle_type_mismatch');
  });

  it('rejects a vehicle_owner whose truck capacity is below the load weight', async () => {
    const res = await bid(
      buildBidApp(5000, {
        profile: { user_type: 'vehicle_owner' },
        load: { weight_tons: 12 },
        truck: { ...okTruck(), capacity_tons: 9 }
      }),
      { truck_id: 'truck-1' }
    );
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('vehicle_capacity_insufficient');
  });

  it('rejects a vehicle_owner whose truck has a lapsed document', async () => {
    const res = await bid(
      buildBidApp(5000, {
        profile: { user_type: 'vehicle_owner' },
        truck: { ...okTruck(), insurance_expiry: '2020-01-01' }
      }),
      { truck_id: 'truck-1' }
    );
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('vehicle_documents_expired');
  });

  it('accepts a vehicle_owner bidding with a verified, matching, in-capacity truck', async () => {
    const app = buildBidApp(5000, { profile: { user_type: 'vehicle_owner' }, truck: okTruck() });
    const res = await bid(app, { truck_id: 'truck-1', truck_number: 'RJ14 AB 1234' });
    expect(res.status).toBe(201);
    expect(app.locals.insertedRows[0].truck_id).toBe('truck-1');
    expect(notifyEmail).toHaveBeenCalledWith('poster@example.com', expect.objectContaining({ type: 'bid_placed' }));
  });

  it('lets a broker bid without any vehicle', async () => {
    const res = await bid(buildBidApp(5000, { profile: { user_type: 'broker' } }));
    expect(res.status).toBe(201);
  });

  it('rejects a bid on a load that is no longer active', async () => {
    const res = await bid(buildBidApp(5000, { load: { status: 'matched' } }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('load_not_active');
  });
});

describe('GET /api/load-bids/config', () => {
  it('returns the current bidding settings', async () => {
    getBiddingSettings.mockResolvedValue({ load24_charge_percent: 4.5, security_deposit: DEFAULT_DEPOSIT });
    const app = express();
    app.use((req, res, next) => {
      req.user = { id: 'u1', email: 'u1@example.com' };
      next();
    });
    app.use('/api/load-bids', loadBidsRouter);

    const res = await request(app).get('/api/load-bids/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ load24_charge_percent: 4.5, security_deposit: DEFAULT_DEPOSIT });
  });
});

describe('POST /api/load-bids/:id/reject — releases the security hold', () => {
  beforeEach(() => {
    notifyEmail.mockClear();
    releaseBidSecurityHold.mockClear();
  });

  it("releases the rejected bid's hold back to the bidder", async () => {
    const app = buildApproveApp({
      loads: [{ id: 'load-1', status: 'matched' }],
      load_bids: [
        {
          id: 'bid-3',
          load_id: 'load-1',
          status: 'pending',
          bid_by_email: 'trucker@example.com',
          amount: 5000,
          security_hold_txn_id: 'hold-txn-1',
          security_hold_amount: 1000,
          security_hold_released_at: null
        }
      ]
    });

    const res = await request(app).post('/api/load-bids/bid-3/reject').send({});
    expect(res.status).toBe(200);
    expect(releaseBidSecurityHold).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'bid-3' }),
      { reason: 'bid rejected' }
    );
  });

  it('403s a caller who is neither the load poster nor review staff', async () => {
    staffRoles = [];
    const app = buildApproveApp(
      {
        loads: [{ id: 'load-1', status: 'active', posted_by: 'poster@example.com' }],
        load_bids: [{ id: 'bid-3', load_id: 'load-1', status: 'pending', bid_by_email: 'trucker@example.com', amount: 5000 }]
      },
      'stranger@example.com'
    );

    const res = await request(app).post('/api/load-bids/bid-3/reject').send({});
    expect(res.status).toBe(403);
    expect(app.locals.store.load_bids[0].status).toBe('pending');
  });

  it('lets review staff reject a bid on a load they did not post', async () => {
    staffRoles = [{ role: 'sales_executive' }];
    const app = buildApproveApp(
      {
        loads: [{ id: 'load-1', status: 'active', posted_by: 'poster@example.com' }],
        load_bids: [{ id: 'bid-3', load_id: 'load-1', status: 'pending', bid_by_email: 'trucker@example.com', amount: 5000 }]
      },
      'staffer@example.com'
    );

    const res = await request(app).post('/api/load-bids/bid-3/reject').send({});
    expect(res.status).toBe(200);
    expect(app.locals.store.load_bids[0].status).toBe('rejected');
    staffRoles = [];
  });
});

describe('autoRejectExpired (via GET /load/:load_id) — releases expired-bid holds', () => {
  beforeEach(() => {
    notifyEmail.mockClear();
    releaseBidSecurityHold.mockClear();
    // These tests all hit GET /load/load-1; clear the per-load sweep cooldown
    // so each one actually runs autoRejectExpired.
    __resetExpirySweepCooldown();
  });

  function seeBiddingApp({ load, bids }) {
    const chain = (result) => {
      const c = { eq: () => c, lt: () => c, order: () => c, then: (resolve) => resolve(result) };
      return c;
    };
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = { id: 'poster-1', email: 'poster@example.com' };
      req.supabase = {
        from: (table) => {
          if (table === 'loads') {
            return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: load, error: null }) }) }) };
          }
          if (table === 'load_bids') {
            return { select: () => chain({ data: bids, error: null }), update: () => chain({ data: null, error: null }) };
          }
          throw new Error(`unexpected table ${table}`);
        }
      };
      next();
    });
    app.use('/api/load-bids', loadBidsRouter);
    return app;
  }

  it('releases the hold on each pending bid whose window has lapsed', async () => {
    const expiredBid = {
      id: 'bid-x',
      load_id: 'load-1',
      bid_by_email: 'trucker@example.com',
      status: 'pending',
      expires_at: new Date(Date.now() - 60_000).toISOString(),
      security_hold_txn_id: 'hold-txn-1',
      security_hold_amount: 1000,
      security_hold_released_at: null
    };
    const app = seeBiddingApp({ load: { id: 'load-1', posted_by: 'poster@example.com' }, bids: [expiredBid] });

    const res = await request(app).get('/api/load-bids/load/load-1');
    expect(res.status).toBe(200);
    expect(releaseBidSecurityHold).toHaveBeenCalledWith(expiredBid, { reason: 'bid expired' });
  });

  it('does nothing when there are no expired bids', async () => {
    const app = seeBiddingApp({ load: { id: 'load-1', posted_by: 'poster@example.com' }, bids: [] });
    const res = await request(app).get('/api/load-bids/load/load-1');
    expect(res.status).toBe(200);
    expect(releaseBidSecurityHold).not.toHaveBeenCalled();
  });

  it('includes the booking (spec §8) once a bid on the load is approved', async () => {
    getBookingByLoadId.mockResolvedValueOnce({ id: 'bk-1', booking_ref: 'BK000042', status: 'confirmed' });
    const app = seeBiddingApp({
      load: { id: 'load-1', posted_by: 'poster@example.com' },
      bids: [{ id: 'b1', load_id: 'load-1', status: 'approved', bid_by_email: 'trucker@example.com', expires_at: pastIso() }]
    });
    const res = await request(app).get('/api/load-bids/load/load-1');
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({ booking_ref: 'BK000042', status: 'confirmed' });
  });

  it('omits the booking while every bid is still pending', async () => {
    const app = seeBiddingApp({
      load: { id: 'load-1', posted_by: 'poster@example.com' },
      bids: [{ id: 'b1', load_id: 'load-1', status: 'pending', bid_by_email: 'trucker@example.com', expires_at: futureIso() }]
    });
    const res = await request(app).get('/api/load-bids/load/load-1');
    expect(res.status).toBe(200);
    expect(res.body.booking).toBeNull();
  });
});

describe('trip documents (E-Way Bill / Bilty)', () => {
  const LOAD = { id: 'load-7', posted_by: 'poster@example.com', material_type: 'Cement' };
  const BID = { id: 'bid-7', load_id: 'load-7', status: 'approved', bid_by_email: 'trucker@example.com' };

  function buildTripApp(callerEmail) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = { id: callerEmail === LOAD.posted_by ? 'poster-1' : 'trucker-1', email: callerEmail };
      req.supabase = {
        from(table) {
          if (table === 'loads') {
            return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: LOAD, error: null }) }) }) };
          }
          if (table === 'load_bids') {
            return {
              select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: BID, error: null }) }) }) })
            };
          }
          throw new Error(`unexpected table ${table}`);
        }
      };
      next();
    });
    app.use('/api/load-bids', loadBidsRouter);
    return app;
  }

  beforeEach(() => {
    tripDocs.rows = [];
    tripDocs.storageOps = [];
  });

  it('mints a signed upload URL scoped to the caller for a valid document_type', async () => {
    const res = await request(buildTripApp('poster@example.com'))
      .post('/api/load-bids/load/load-7/documents/upload-url')
      .send({ document_type: 'eway_bill', file_name: 'bill.pdf' });
    expect(res.status).toBe(200);
    expect(res.body.storage_path).toBe('poster-1/load-7-eway_bill.pdf');
    expect(res.body.token).toBe('tok');
    expect(tripDocs.storageOps).toContainEqual(['upload-url', 'trip-documents', 'poster-1/load-7-eway_bill.pdf']);
  });

  it('rejects an unknown document_type', async () => {
    const res = await request(buildTripApp('poster@example.com'))
      .post('/api/load-bids/load/load-7/documents/upload-url')
      .send({ document_type: 'invoice', file_name: 'x.pdf' });
    expect(res.status).toBe(400);
  });

  it('rejects a caller who is neither the poster nor the approved bidder', async () => {
    const res = await request(buildTripApp('stranger@example.com'))
      .post('/api/load-bids/load/load-7/documents/upload-url')
      .send({ document_type: 'bilty', file_name: 'x.pdf' });
    expect(res.status).toBe(403);
  });

  it('records an uploaded doc against the trip and lets the other party replace it', async () => {
    const posterRes = await request(buildTripApp('poster@example.com'))
      .post('/api/load-bids/load/load-7/documents')
      .send({ document_type: 'eway_bill', storage_path: 'poster-1/load-7-eway_bill.pdf', file_name: 'bill.pdf', mime_type: 'application/pdf' });
    expect(posterRes.status).toBe(200);
    expect(tripDocs.rows).toHaveLength(1);
    expect(tripDocs.rows[0]).toMatchObject({ load_id: 'load-7', bid_id: 'bid-7', document_type: 'eway_bill', uploaded_by_email: 'poster@example.com' });

    const truckerRes = await request(buildTripApp('trucker@example.com'))
      .post('/api/load-bids/load/load-7/documents')
      .send({ document_type: 'eway_bill', storage_path: 'trucker-1/load-7-eway_bill.jpg', file_name: 'bill.jpg' });
    expect(truckerRes.status).toBe(200);
    expect(tripDocs.rows).toHaveLength(1);
    expect(tripDocs.rows[0].uploaded_by_email).toBe('trucker@example.com');
    // previous object (under the poster's folder) is cleaned up
    expect(tripDocs.storageOps).toContainEqual(['remove', 'trip-documents', ['poster-1/load-7-eway_bill.pdf']]);
  });

  it('refuses a confirm whose storage_path is not under the caller', async () => {
    const res = await request(buildTripApp('poster@example.com'))
      .post('/api/load-bids/load/load-7/documents')
      .send({ document_type: 'bilty', storage_path: 'someone-else/load-7-bilty.pdf' });
    expect(res.status).toBe(403);
  });

  describe('POST .../documents/number — E-Way Bill number', () => {
    it('saves a 12-digit E-Way Bill number against the trip', async () => {
      const res = await request(buildTripApp('poster@example.com'))
        .post('/api/load-bids/load/load-7/documents/number')
        .send({ document_type: 'eway_bill', document_number: '123456789012' });
      expect(res.status).toBe(200);
      expect(res.body.document).toMatchObject({ document_type: 'eway_bill', document_number: '123456789012' });
      expect(tripDocs.rows).toHaveLength(1);
      expect(tripDocs.rows[0]).toMatchObject({ load_id: 'load-7', bid_id: 'bid-7', document_type: 'eway_bill', document_number: '123456789012' });
    });

    it('trims surrounding whitespace before validating and storing', async () => {
      const res = await request(buildTripApp('trucker@example.com'))
        .post('/api/load-bids/load/load-7/documents/number')
        .send({ document_type: 'eway_bill', document_number: '  123456789012  ' });
      expect(res.status).toBe(200);
      expect(tripDocs.rows[0].document_number).toBe('123456789012');
    });

    it('rejects a number that is not exactly 12 digits', async () => {
      for (const bad of ['12345', '1234567890123', '12345678901a', 'abcdefghijkl']) {
        const res = await request(buildTripApp('poster@example.com'))
          .post('/api/load-bids/load/load-7/documents/number')
          .send({ document_type: 'eway_bill', document_number: bad });
        expect(res.status).toBe(400);
      }
      expect(tripDocs.rows).toHaveLength(0);
    });

    it('clears the number when an empty string is sent', async () => {
      await request(buildTripApp('poster@example.com'))
        .post('/api/load-bids/load/load-7/documents/number')
        .send({ document_type: 'eway_bill', document_number: '123456789012' });
      const res = await request(buildTripApp('poster@example.com'))
        .post('/api/load-bids/load/load-7/documents/number')
        .send({ document_type: 'eway_bill', document_number: '' });
      expect(res.status).toBe(200);
      expect(tripDocs.rows).toHaveLength(1);
      expect(tripDocs.rows[0].document_number).toBeNull();
    });

    it('rejects a caller who is neither the poster nor the approved bidder', async () => {
      const res = await request(buildTripApp('stranger@example.com'))
        .post('/api/load-bids/load/load-7/documents/number')
        .send({ document_type: 'eway_bill', document_number: '123456789012' });
      expect(res.status).toBe(403);
    });

    it('rejects an unknown document_type', async () => {
      const res = await request(buildTripApp('poster@example.com'))
        .post('/api/load-bids/load/load-7/documents/number')
        .send({ document_type: 'invoice', document_number: '123456789012' });
      expect(res.status).toBe(400);
    });

    it('keeps the number when a file is later uploaded, and the file when the number changes', async () => {
      await request(buildTripApp('poster@example.com'))
        .post('/api/load-bids/load/load-7/documents/number')
        .send({ document_type: 'eway_bill', document_number: '123456789012' });

      await request(buildTripApp('poster@example.com'))
        .post('/api/load-bids/load/load-7/documents')
        .send({ document_type: 'eway_bill', storage_path: 'poster-1/load-7-eway_bill.pdf', file_name: 'bill.pdf', mime_type: 'application/pdf' });

      expect(tripDocs.rows).toHaveLength(1);
      expect(tripDocs.rows[0]).toMatchObject({
        document_number: '123456789012',
        storage_path: 'poster-1/load-7-eway_bill.pdf'
      });

      await request(buildTripApp('poster@example.com'))
        .post('/api/load-bids/load/load-7/documents/number')
        .send({ document_type: 'eway_bill', document_number: '999999999999' });

      expect(tripDocs.rows[0]).toMatchObject({
        document_number: '999999999999',
        storage_path: 'poster-1/load-7-eway_bill.pdf'
      });
    });
  });
});
