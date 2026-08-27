import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const notifyEmail = vi.fn(() => Promise.resolve());
vi.mock('../lib/notify.js', () => ({
  notifyEmail: (...args) => notifyEmail(...args),
  notifyUser: vi.fn(() => Promise.resolve())
}));

// Records every supabaseAdmin.from('truck_availabilities').update(...).eq(...) call
// so the test can assert both the patch and the filters it was scoped to,
// without simulating real row filtering.
const adminCalls = [];
// In-memory stand-in for the trip_documents table + Storage, used by the
// trip-document route tests below. `rows` is the table; `storageOps` records
// remove()/createSignedUploadUrl() calls.
const tripDocs = { rows: [], storageOps: [] };
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

const { default: loadBidsRouter } = await import('./loadBids.js');

function mockReqSupabase({ bid }) {
  return {
    from(table) {
      if (table === 'load_bids') {
        return {
          update: () => ({
            eq: () => ({
              eq: () => ({
                gt: () => ({
                  select: () => ({ single: () => Promise.resolve({ data: bid, error: null }) })
                })
              })
            })
          })
        };
      }
      if (table === 'loads') {
        return { update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    }
  };
}

function buildApp(supabase) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 'poster-1', email: 'poster@example.com' };
    req.supabase = supabase;
    next();
  });
  app.use('/api/load-bids', loadBidsRouter);
  return app;
}

describe('POST /api/load-bids/:id/approve', () => {
  beforeEach(() => {
    adminCalls.length = 0;
    notifyEmail.mockClear();
  });

  it("books the bid's truck availability so it drops out of nearby-load notifications", async () => {
    const bid = { id: 'bid-1', load_id: 'load-1', truck_id: 'truck-1', bid_by_email: 'trucker@example.com', amount: 5000 };
    const supabase = mockReqSupabase({ bid });
    const app = buildApp(supabase);

    const res = await request(app).post('/api/load-bids/bid-1/approve').send({});
    expect(res.status).toBe(200);

    const call = adminCalls.find((c) => c.table === 'truck_availabilities');
    expect(call).toBeTruthy();
    expect(call.patch.status).toBe('booked');
    expect(call.filters).toContainEqual(['truck_id', 'truck-1']);
    expect(call.filters).toContainEqual(['status', 'available']);
  });

  it('skips the truck_availabilities update when the bid has no truck_id', async () => {
    const bid = { id: 'bid-2', load_id: 'load-1', truck_id: null, bid_by_email: 'x@example.com', amount: 1000 };
    const supabase = mockReqSupabase({ bid });
    const app = buildApp(supabase);

    const res = await request(app).post('/api/load-bids/bid-2/approve').send({});
    expect(res.status).toBe(200);
    expect(adminCalls.length).toBe(0);
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
});
