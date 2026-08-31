import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';

// Shared in-memory store so both req.supabase (RLS-scoped reads) and the
// mocked supabaseAdmin (service-role writes) see the same data — and so
// this mock can reproduce apply_wallet_transaction(), the Postgres trigger
// that's the real source of truth for wallets.balance, since these tests
// never touch a real Postgres instance.
function createStore() {
  // notifications: routes now fire-and-forget a notify*() call (see
  // lib/notify.js) on withdrawal approve/reject/pay and top-up verify/reject
  // — it writes through this same mocked supabaseAdmin, so the table needs a
  // backing array or that insert throws on `store[table].length`.
  return {
    wallets: [],
    wallet_transactions: [],
    withdrawal_requests: [],
    wallet_topup_requests: [],
    bank_details: [],
    user_roles: [],
    user_profiles: [],
    notifications: []
  };
}

const mockStorageState = { removeCalls: [], signedUploadCalls: [], signedUrlCalls: [] };

function makeStorageMock() {
  return {
    from(bucket) {
      return {
        remove: (paths) => {
          mockStorageState.removeCalls.push({ bucket, paths });
          return Promise.resolve({ data: null, error: null });
        },
        createSignedUploadUrl: (path) => {
          mockStorageState.signedUploadCalls.push({ bucket, path });
          return Promise.resolve({ data: { signedUrl: `https://example.com/${path}`, path, token: 'tok' }, error: null });
        },
        createSignedUrl: (path, ttl) => {
          mockStorageState.signedUrlCalls.push({ bucket, path, ttl });
          return Promise.resolve({ data: { signedUrl: `https://example.com/view/${path}?ttl=${ttl}` }, error: null });
        }
      };
    }
  };
}

let store = createStore();

function applyTransactionEffect(tx) {
  if (tx.status !== 'completed') return;
  const wallet = store.wallets.find((w) => w.id === tx.wallet_id);
  const increase = ['add_money', 'credit', 'refund', 'security_release'].includes(tx.type);
  wallet.balance += increase ? Number(tx.amount) : -Number(tx.amount);
}

function makeQueryBuilder(table) {
  let rows = store[table];
  const filters = [];
  const builder = {
    select: () => builder,
    eq: (field, value) => {
      filters.push((r) => r[field] === value);
      return builder;
    },
    in: (field, values) => {
      filters.push((r) => values.includes(r[field]));
      return builder;
    },
    gte: () => builder,
    lte: () => builder,
    order: () => builder,
    range: () => {
      const result = rows.filter((r) => filters.every((f) => f(r)));
      return Promise.resolve({ data: result, error: null });
    },
    maybeSingle: () => {
      const result = rows.filter((r) => filters.every((f) => f(r)));
      return Promise.resolve({ data: result[0] || null, error: null });
    },
    single: () => {
      const result = rows.filter((r) => filters.every((f) => f(r)));
      return Promise.resolve({ data: result[0] || null, error: null });
    },
    then: (resolve) => {
      const result = rows.filter((r) => filters.every((f) => f(r)));
      resolve({ data: result, error: null });
    }
  };
  return builder;
}

function makeSupabaseMock() {
  return {
    storage: makeStorageMock(),
    from(table) {
      return {
        select: () => makeQueryBuilder(table),
        insert(row) {
          const withDefaults = {
            id: `${table}-${store[table].length + 1}`,
            balance: 0,
            status: table === 'withdrawal_requests' ? 'pending' : table === 'wallet_topup_requests' ? 'awaiting_payment' : 'completed',
            created_at: new Date().toISOString(),
            ...row
          };
          store[table].push(withDefaults);
          if (table === 'wallet_transactions') applyTransactionEffect(withDefaults);
          return {
            select: () => ({ single: () => Promise.resolve({ data: withDefaults, error: null }) })
          };
        },
        update(fields) {
          const filters = [];
          const chain = {
            eq: (field, value) => {
              filters.push((r) => r[field] === value);
              return chain;
            },
            in: (field, values) => {
              filters.push((r) => values.includes(r[field]));
              return chain;
            },
            select: () => {
              const resolveMatch = () => {
                const match = store[table].find((r) => filters.every((f) => f(r)));
                if (!match) return Promise.resolve({ data: null, error: null });
                const before = match.status;
                Object.assign(match, fields);
                if (table === 'wallet_transactions' && before !== 'completed') applyTransactionEffect(match);
                return Promise.resolve({ data: match, error: null });
              };
              return { single: resolveMatch, maybeSingle: resolveMatch };
            },
            then: (resolve) => {
              const match = store[table].find((r) => filters.every((f) => f(r)));
              if (match) {
                const before = match.status;
                Object.assign(match, fields);
                if (table === 'wallet_transactions' && before !== 'completed') applyTransactionEffect(match);
              }
              resolve({ error: null });
            }
          };
          return chain;
        }
      };
    }
  };
}

vi.mock('../lib/supabase.js', () => ({
  get supabaseAdmin() {
    return makeSupabaseMock();
  }
}));

const { default: walletRouter } = await import('./wallet.js');
const { requireRole } = await import('../middleware/requireRole.js');

function buildApp(userId = 'user-1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    req.supabase = makeSupabaseMock();
    next();
  });
  app.use('/api/wallet', walletRouter);
  return app;
}

beforeEach(() => {
  store = createStore();
  mockStorageState.removeCalls = [];
  mockStorageState.signedUploadCalls = [];
  mockStorageState.signedUrlCalls = [];
});

describe('GET /api/wallet', () => {
  it('lazily creates a wallet with zero balance', async () => {
    const res = await request(buildApp()).get('/api/wallet');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ balance: 0, available_balance: 0, held_balance: 0 });
  });

  it('excludes pending/approved withdrawals from available_balance', async () => {
    store.wallets.push({ id: 'w1', user_id: 'user-1', balance: 1000 });
    store.withdrawal_requests.push({ id: 'wr1', wallet_id: 'w1', user_id: 'user-1', amount: 300, status: 'pending' });

    const res = await request(buildApp()).get('/api/wallet');
    expect(res.body).toEqual({ balance: 1000, available_balance: 700, held_balance: 0 });
  });

  it('reports held_balance as the net of unreleased security holds (§5)', async () => {
    store.wallets.push({ id: 'w1', user_id: 'user-1', balance: 1000 });
    store.wallet_transactions.push(
      { id: 't1', wallet_id: 'w1', user_id: 'user-1', type: 'security_hold', amount: 150, status: 'completed' },
      { id: 't2', wallet_id: 'w1', user_id: 'user-1', type: 'security_release', amount: 50, status: 'completed' }
    );

    const res = await request(buildApp()).get('/api/wallet');
    expect(res.body.held_balance).toBe(100);
  });
});

describe('POST /api/wallet/topup-requests', () => {
  it('rejects a non-positive amount', async () => {
    const res = await request(buildApp()).post('/api/wallet/topup-requests').send({ amount: 0, reason_category: 'load_payment' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid reason_category', async () => {
    const res = await request(buildApp()).post('/api/wallet/topup-requests').send({ amount: 500, reason_category: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('requires reason_note when reason_category is "other"', async () => {
    const res = await request(buildApp()).post('/api/wallet/topup-requests').send({ amount: 500, reason_category: 'other' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason_note/);
  });

  it('creates an awaiting_payment request with a generated transaction_id, without touching the balance', async () => {
    const res = await request(buildApp())
      .post('/api/wallet/topup-requests')
      .send({ amount: 500, reason_category: 'security_fee' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ amount: 500, reason_category: 'security_fee', status: 'awaiting_payment' });
    expect(res.body.transaction_id).toMatch(/^TXN/);
    expect(store.wallets[0].balance).toBe(0);
  });
});

describe('GET /api/wallet/topup-requests/mine', () => {
  it('only returns the caller\'s own requests', async () => {
    store.wallet_topup_requests.push(
      { id: 'r1', user_id: 'user-1', amount: 100, status: 'awaiting_payment' },
      { id: 'r2', user_id: 'user-2', amount: 200, status: 'awaiting_payment' }
    );
    const res = await request(buildApp('user-1')).get('/api/wallet/topup-requests/mine');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('r1');
  });
});

describe('POST /api/wallet/topup-requests/:id/proof/upload-url', () => {
  it('404s for a request that does not belong to the caller', async () => {
    store.wallet_topup_requests.push({ id: 'r1', user_id: 'user-2', status: 'awaiting_payment' });
    const res = await request(buildApp('user-1')).post('/api/wallet/topup-requests/r1/proof/upload-url').send({ file_name: 'proof.jpg' });
    expect(res.status).toBe(404);
  });

  it('refuses to attach proof to an already-resolved request', async () => {
    store.wallet_topup_requests.push({ id: 'r1', user_id: 'user-1', status: 'verified' });
    const res = await request(buildApp('user-1')).post('/api/wallet/topup-requests/r1/proof/upload-url').send({ file_name: 'proof.jpg' });
    expect(res.status).toBe(400);
  });

  it('returns a signed upload URL scoped to the caller\'s own folder', async () => {
    store.wallet_topup_requests.push({ id: 'r1', user_id: 'user-1', status: 'awaiting_payment' });
    const res = await request(buildApp('user-1')).post('/api/wallet/topup-requests/r1/proof/upload-url').send({ file_name: 'proof.jpg' });
    expect(res.status).toBe(200);
    expect(res.body.storage_path).toBe('user-1/r1.jpg');
    expect(res.body.signed_url).toContain('user-1/r1.jpg');
  });
});

describe('POST /api/wallet/topup-requests/:id/proof', () => {
  it('rejects a storage_path outside the caller\'s own folder', async () => {
    store.wallet_topup_requests.push({ id: 'r1', user_id: 'user-1', status: 'awaiting_payment' });
    const res = await request(buildApp('user-1'))
      .post('/api/wallet/topup-requests/r1/proof')
      .send({ storage_path: 'someone-else/r1.jpg' });
    expect(res.status).toBe(403);
  });

  it('records the screenshot and moves the request to pending_verification', async () => {
    store.wallet_topup_requests.push({ id: 'r1', user_id: 'user-1', status: 'awaiting_payment' });
    const res = await request(buildApp('user-1'))
      .post('/api/wallet/topup-requests/r1/proof')
      .send({ storage_path: 'user-1/r1.jpg' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending_verification');
    expect(res.body.proof_storage_path).toBe('user-1/r1.jpg');
  });
});

describe('Staff top-up review', () => {
  function staffApp() {
    store.user_roles.push({ user_id: 'staff-1', role: 'admin' });
    return buildApp('staff-1');
  }

  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).get('/api/wallet/topup-requests/pending');
    expect(res.status).toBe(403);
  });

  it('lists pending_verification requests with a signed proof URL and the requester\'s profile', async () => {
    store.wallet_topup_requests.push({
      id: 'r1', user_id: 'user-1', amount: 500, status: 'pending_verification', proof_storage_path: 'user-1/r1.jpg'
    });
    store.user_profiles.push({ user_id: 'user-1', full_name: 'Sumit', mobile: '9999999999' });

    const res = await request(staffApp()).get('/api/wallet/topup-requests/pending');
    expect(res.status).toBe(200);
    expect(res.body[0].proof_url).toContain('user-1/r1.jpg');
    expect(res.body[0].proof_storage_path).toBe('user-1/r1.jpg'); // fine to include here — only /pending is staff-only
    expect(res.body[0].profile).toMatchObject({ full_name: 'Sumit', mobile: '9999999999' });
  });

  it('verify credits the wallet exactly once, reusing the request\'s transaction_id', async () => {
    store.wallets.push({ id: 'w1', user_id: 'user-1', balance: 1000 });
    store.wallet_topup_requests.push({
      id: 'r1', transaction_id: 'TXN20260826ABCD', wallet_id: 'w1', user_id: 'user-1',
      amount: 500, status: 'pending_verification', proof_storage_path: 'user-1/r1.jpg'
    });

    const res = await request(staffApp()).post('/api/wallet/topup-requests/r1/verify');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('verified');
    expect(store.wallets[0].balance).toBe(1500);
    expect(store.wallet_transactions[0]).toMatchObject({ transaction_id: 'TXN20260826ABCD', type: 'add_money', amount: 500, status: 'completed' });
  });

  it('cannot verify the same request twice', async () => {
    store.wallets.push({ id: 'w1', user_id: 'user-1', balance: 1000 });
    store.wallet_topup_requests.push({
      id: 'r1', transaction_id: 'TXN1', wallet_id: 'w1', user_id: 'user-1', amount: 500, status: 'pending_verification'
    });

    const app = staffApp();
    const first = await request(app).post('/api/wallet/topup-requests/r1/verify');
    expect(first.status).toBe(200);

    const second = await request(app).post('/api/wallet/topup-requests/r1/verify');
    expect(second.status).toBe(409);
    expect(store.wallets[0].balance).toBe(1500); // not double-credited
  });

  it('reject marks the request rejected without touching the balance', async () => {
    store.wallets.push({ id: 'w1', user_id: 'user-1', balance: 1000 });
    store.wallet_topup_requests.push({
      id: 'r1', transaction_id: 'TXN1', wallet_id: 'w1', user_id: 'user-1', amount: 500, status: 'pending_verification'
    });

    const res = await request(staffApp()).post('/api/wallet/topup-requests/r1/reject').send({ reason: 'Screenshot unreadable' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'rejected', rejection_reason: 'Screenshot unreadable' });
    expect(store.wallets[0].balance).toBe(1000);
    expect(store.wallet_transactions).toHaveLength(0);
  });
});

describe('POST /api/wallet/withdraw', () => {
  it('rejects a withdrawal above available balance', async () => {
    store.wallets.push({ id: 'w1', user_id: 'user-1', balance: 100 });
    const res = await request(buildApp()).post('/api/wallet/withdraw').send({ amount: 500 });
    expect(res.status).toBe(400);
  });

  it('requires bank details to be on file', async () => {
    store.wallets.push({ id: 'w1', user_id: 'user-1', balance: 1000 });
    const res = await request(buildApp()).post('/api/wallet/withdraw').send({ amount: 500 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bank details/i);
  });

  it('creates a pending withdrawal request snapshotting bank details', async () => {
    store.wallets.push({ id: 'w1', user_id: 'user-1', balance: 1000 });
    store.bank_details.push({
      user_id: 'user-1', account_holder_name: 'Sumit', account_number: '123', ifsc_code: 'ABCD0001234', bank_name: 'Test Bank'
    });

    const res = await request(buildApp()).post('/api/wallet/withdraw').send({ amount: 500 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ amount: 500, status: 'pending', bank_account_holder_name: 'Sumit' });
  });
});

describe('Staff withdrawal review', () => {
  function staffApp() {
    store.user_roles.push({ user_id: 'staff-1', role: 'admin' });
    return buildApp('staff-1');
  }

  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).get('/api/wallet/withdrawals/pending');
    expect(res.status).toBe(403);
  });

  it('approve -> pay debits the wallet exactly once', async () => {
    store.wallets.push({ id: 'w1', user_id: 'user-1', balance: 1000 });
    store.withdrawal_requests.push({
      id: 'wr1', wallet_id: 'w1', user_id: 'user-1', amount: 400, status: 'pending',
      bank_account_holder_name: 'Sumit', bank_account_number: '123', bank_ifsc_code: 'ABCD0001234', bank_name: 'Test Bank'
    });

    const app = staffApp();
    const approveRes = await request(app).post('/api/wallet/withdrawals/wr1/approve');
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe('approved');

    const payRes = await request(app).post('/api/wallet/withdrawals/wr1/pay');
    expect(payRes.status).toBe(200);
    expect(payRes.body.status).toBe('paid');
    expect(store.wallets[0].balance).toBe(600);
    expect(store.wallet_transactions[0]).toMatchObject({ type: 'withdrawal', amount: 400, status: 'completed' });
  });

  it('cannot pay a request that is still pending (not yet approved)', async () => {
    store.wallets.push({ id: 'w1', user_id: 'user-1', balance: 1000 });
    store.withdrawal_requests.push({ id: 'wr1', wallet_id: 'w1', user_id: 'user-1', amount: 400, status: 'pending' });

    const res = await request(staffApp()).post('/api/wallet/withdrawals/wr1/pay');
    expect(res.status).toBe(400);
    expect(store.wallets[0].balance).toBe(1000);
  });
});

describe('POST /api/wallet/adjust', () => {
  it('rejects a non-staff caller', async () => {
    const res = await request(buildApp('user-1')).post('/api/wallet/adjust').send({ user_id: 'user-2', type: 'commission', amount: 50 });
    expect(res.status).toBe(403);
  });

  it('applies a commission deduction to the target user wallet', async () => {
    store.user_roles.push({ user_id: 'staff-1', role: 'admin' });
    store.wallets.push({ id: 'w1', user_id: 'user-2', balance: 1000 });

    const res = await request(buildApp('staff-1'))
      .post('/api/wallet/adjust')
      .send({ user_id: 'user-2', type: 'commission', amount: 50, notes: 'Deal commission' });

    expect(res.status).toBe(201);
    expect(store.wallets[0].balance).toBe(950);
  });
});
