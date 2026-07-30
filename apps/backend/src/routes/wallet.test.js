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
  return { wallets: [], wallet_transactions: [], withdrawal_requests: [], bank_details: [], user_roles: [] };
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
    from(table) {
      return {
        select: () => makeQueryBuilder(table),
        insert(row) {
          const withDefaults = {
            id: `${table}-${store[table].length + 1}`,
            balance: 0,
            status: table === 'withdrawal_requests' ? 'pending' : 'completed',
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
            select: () => ({
              single: () => {
                const match = store[table].find((r) => filters.every((f) => f(r)));
                if (!match) return Promise.resolve({ data: null, error: null });
                const before = match.status;
                Object.assign(match, fields);
                if (table === 'wallet_transactions' && before !== 'completed') applyTransactionEffect(match);
                return Promise.resolve({ data: match, error: null });
              }
            }),
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

vi.mock('../lib/razorpay.js', () => ({
  createRazorpayOrder: vi.fn(async ({ amount, receipt }) => ({
    id: `order_${receipt}`,
    amount: Math.round(amount * 100),
    currency: 'INR'
  })),
  verifySignature: vi.fn((body, signature, secret) => signature === `valid-signature-for-${secret}`)
}));

const { default: walletRouter, razorpayWebhookHandler } = await import('./wallet.js');
const { requireRole } = await import('../middleware/requireRole.js');

function buildApp(userId = 'user-1') {
  const app = express();
  app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
  app.use((req, res, next) => {
    req.user = { id: userId };
    req.supabase = makeSupabaseMock();
    next();
  });
  app.use('/api/wallet', walletRouter);
  app.post('/webhook', razorpayWebhookHandler);
  return app;
}

beforeEach(() => {
  store = createStore();
});

describe('GET /api/wallet', () => {
  it('lazily creates a wallet with zero balance', async () => {
    const res = await request(buildApp()).get('/api/wallet');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ balance: 0, available_balance: 0 });
  });

  it('excludes pending/approved withdrawals from available_balance', async () => {
    store.wallets.push({ id: 'w1', user_id: 'user-1', balance: 1000 });
    store.withdrawal_requests.push({ id: 'wr1', wallet_id: 'w1', user_id: 'user-1', amount: 300, status: 'pending' });

    const res = await request(buildApp()).get('/api/wallet');
    expect(res.body).toEqual({ balance: 1000, available_balance: 700 });
  });
});

describe('POST /api/wallet/add-money', () => {
  it('rejects a non-positive amount', async () => {
    const res = await request(buildApp()).post('/api/wallet/add-money').send({ amount: 0 });
    expect(res.status).toBe(400);
  });

  it('creates a pending add_money transaction with a Razorpay order', async () => {
    const res = await request(buildApp()).post('/api/wallet/add-money').send({ amount: 500 });
    expect(res.status).toBe(201);
    expect(res.body.order_id).toMatch(/^order_TXN/);
    expect(store.wallet_transactions[0]).toMatchObject({ type: 'add_money', amount: 500, status: 'pending' });
    // Balance not credited yet — only the webhook does that.
    expect(store.wallets[0].balance).toBe(0);
  });
});

describe('POST /webhook (razorpay-webhook)', () => {
  const secret = 'whsec_test';
  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = secret;
  });

  function payload(orderId, paymentId = 'pay_1') {
    return {
      event: 'payment.captured',
      payload: { payment: { entity: { order_id: orderId, id: paymentId } } }
    };
  }

  it('rejects an invalid signature', async () => {
    const res = await request(buildApp())
      .post('/webhook')
      .set('x-razorpay-signature', 'wrong')
      .send(payload('order_1'));
    expect(res.status).toBe(400);
  });

  it('credits the wallet once, on a valid signature matching a pending order', async () => {
    store.wallets.push({ id: 'w1', user_id: 'user-1', balance: 0 });
    store.wallet_transactions.push({
      id: 'tx1', wallet_id: 'w1', user_id: 'user-1', type: 'add_money',
      amount: 500, status: 'pending', razorpay_order_id: 'order_1'
    });

    const res = await request(buildApp())
      .post('/webhook')
      .set('x-razorpay-signature', `valid-signature-for-${secret}`)
      .send(payload('order_1'));

    expect(res.status).toBe(200);
    expect(store.wallets[0].balance).toBe(500);
    expect(store.wallet_transactions[0].status).toBe('completed');
  });

  it('is idempotent against a webhook retry for an already-completed order', async () => {
    store.wallets.push({ id: 'w1', user_id: 'user-1', balance: 500 });
    store.wallet_transactions.push({
      id: 'tx1', wallet_id: 'w1', user_id: 'user-1', type: 'add_money',
      amount: 500, status: 'completed', razorpay_order_id: 'order_1'
    });

    const res = await request(buildApp())
      .post('/webhook')
      .set('x-razorpay-signature', `valid-signature-for-${secret}`)
      .send(payload('order_1'));

    expect(res.status).toBe(200);
    expect(store.wallets[0].balance).toBe(500); // not double-credited
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
