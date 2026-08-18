import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { createRazorpayOrder, verifySignature } from '../lib/razorpay.js';
import { generateTransactionId, getOrCreateWallet, getAvailableBalance, applyWalletAdjustment } from '../lib/wallet.js';
import { requireRole } from '../middleware/requireRole.js';
import { notifyUser } from '../lib/notify.js';

const STAFF_ROLES = ['admin', 'support_executive', 'support_manager', 'accounts_executive', 'accounts_manager'];
const ADJUSTABLE_TYPES = ['credit', 'debit', 'refund', 'commission', 'service_charge', 'security_hold', 'security_release'];

const router = Router();

// GET /api/wallet — balance, plus what's actually spendable right now
// (balance minus anything held by a not-yet-paid withdrawal request).
router.get('/', async (req, res) => {
  try {
    const wallet = await getOrCreateWallet(req.user.id);
    const available_balance = await getAvailableBalance(wallet);
    res.json({ balance: Number(wallet.balance), available_balance });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/wallet/transactions?limit=&offset= — the ledger, newest first.
router.get('/transactions', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Number(req.query.offset) || 0;

  const { data, error } = await req.supabase
    .from('wallet_transactions')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// GET /api/wallet/statement?from=YYYY-MM-DD&to=YYYY-MM-DD — CSV export for
// a date range, downloadable straight from the mobile app's fetch response.
router.get('/statement', async (req, res) => {
  const { from, to } = req.query;

  let query = req.supabase.from('wallet_transactions').select('*').eq('user_id', req.user.id).order('created_at', { ascending: true });
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });

  const header = 'transaction_id,type,amount,status,created_at,notes';
  const rows = (data || []).map((t) =>
    [t.transaction_id, t.type, t.amount, t.status, t.created_at, (t.notes || '').replace(/,/g, ';')].join(',')
  );
  const csv = [header, ...rows].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="wallet-statement-${Date.now()}.csv"`);
  res.status(200).send(csv);
});

// POST /api/wallet/add-money { amount } — opens a Razorpay order; the wallet
// isn't credited until the webhook below confirms the payment actually went
// through (this row starts 'pending' and the mobile Checkout SDK never
// touches wallet balance directly).
router.post('/add-money', async (req, res) => {
  const amount = Number(req.body.amount);
  if (!amount || amount <= 0) return res.status(400).json({ error: 'amount must be a positive number' });

  try {
    const wallet = await getOrCreateWallet(req.user.id);
    const transaction_id = generateTransactionId();
    const order = await createRazorpayOrder({ amount, receipt: transaction_id });

    const { error } = await supabaseAdmin.from('wallet_transactions').insert({
      transaction_id,
      wallet_id: wallet.id,
      user_id: req.user.id,
      type: 'add_money',
      amount,
      status: 'pending',
      razorpay_order_id: order.id
    });
    if (error) throw error;

    res.status(201).json({
      transaction_id,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: process.env.RAZORPAY_KEY_ID
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/wallet/withdrawals/mine — the caller's own withdrawal requests.
router.get('/withdrawals/mine', async (req, res) => {
  const { data, error } = await req.supabase
    .from('withdrawal_requests')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// POST /api/wallet/withdraw { amount } — snapshots the caller's saved bank
// details (so a later edit to bank_details can't retroactively change where
// an in-flight request pays out) and holds the amount out of
// available_balance until staff mark it paid or reject it.
router.post('/withdraw', async (req, res) => {
  const amount = Number(req.body.amount);
  if (!amount || amount <= 0) return res.status(400).json({ error: 'amount must be a positive number' });

  try {
    const wallet = await getOrCreateWallet(req.user.id);
    const available = await getAvailableBalance(wallet);
    if (amount > available) return res.status(400).json({ error: 'Insufficient available balance' });

    const { data: bank, error: bankError } = await req.supabase
      .from('bank_details')
      .select('account_holder_name, account_number, ifsc_code, bank_name')
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (bankError) throw bankError;
    if (!bank) return res.status(400).json({ error: 'Add bank details before requesting a withdrawal' });

    const { data, error } = await supabaseAdmin
      .from('withdrawal_requests')
      .insert({
        user_id: req.user.id,
        wallet_id: wallet.id,
        amount,
        bank_account_holder_name: bank.account_holder_name,
        bank_account_number: bank.account_number,
        bank_ifsc_code: bank.ifsc_code,
        bank_name: bank.bank_name
      })
      .select()
      .single();
    if (error) throw error;

    res.status(201).json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// -- Staff-only review endpoints -------------------------------------------

// GET /api/wallet/withdrawals/pending — queue for staff review.
router.get('/withdrawals/pending', requireRole(STAFF_ROLES), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('withdrawal_requests')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.post('/withdrawals/:id/approve', requireRole(STAFF_ROLES), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('withdrawal_requests')
    .update({ status: 'approved', reviewed_by: req.user.id, reviewed_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('status', 'pending')
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(400).json({ error: 'Request is not pending' });

  await notifyUser(data.user_id, {
    type: 'withdrawal_approved',
    title: 'Withdrawal approved',
    body: `₹${Number(data.amount).toLocaleString('en-IN')} withdrawal approved — payout is next`,
    data: { withdrawal_id: data.id }
  });

  res.json(data);
});

router.post('/withdrawals/:id/reject', requireRole(STAFF_ROLES), async (req, res) => {
  const { reason } = req.body;
  const { data, error } = await supabaseAdmin
    .from('withdrawal_requests')
    .update({
      status: 'rejected',
      rejection_reason: reason || null,
      reviewed_by: req.user.id,
      reviewed_at: new Date().toISOString()
    })
    .eq('id', req.params.id)
    .in('status', ['pending', 'approved'])
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(400).json({ error: 'Request cannot be rejected from its current status' });

  await notifyUser(data.user_id, {
    type: 'withdrawal_rejected',
    title: 'Withdrawal rejected',
    body: reason || `₹${Number(data.amount).toLocaleString('en-IN')} withdrawal was rejected`,
    data: { withdrawal_id: data.id }
  });

  res.json(data);
});

// POST /api/wallet/withdrawals/:id/pay — staff confirms the payout actually
// left the bank; this is the only step that debits the wallet (via the
// wallet_transactions insert below, applied by the DB trigger), keeping the
// balance truthful to real money movement rather than a request being made.
router.post('/withdrawals/:id/pay', requireRole(STAFF_ROLES), async (req, res) => {
  const { data: wr, error: fetchError } = await supabaseAdmin
    .from('withdrawal_requests')
    .select('*')
    .eq('id', req.params.id)
    .eq('status', 'approved')
    .maybeSingle();
  if (fetchError) return res.status(400).json({ error: fetchError.message });
  if (!wr) return res.status(400).json({ error: 'Request must be approved before it can be paid' });

  const transaction_id = generateTransactionId();
  const { data: tx, error: txError } = await supabaseAdmin
    .from('wallet_transactions')
    .insert({
      transaction_id,
      wallet_id: wr.wallet_id,
      user_id: wr.user_id,
      type: 'withdrawal',
      amount: wr.amount,
      status: 'completed',
      notes: `Withdrawal request ${wr.id}`
    })
    .select()
    .single();
  if (txError) return res.status(400).json({ error: txError.message });

  const { data: paid, error: payError } = await supabaseAdmin
    .from('withdrawal_requests')
    .update({ status: 'paid', wallet_transaction_id: tx.id })
    .eq('id', wr.id)
    .select()
    .single();
  if (payError) return res.status(400).json({ error: payError.message });

  await notifyUser(paid.user_id, {
    type: 'withdrawal_paid',
    title: 'Withdrawal paid',
    body: `₹${Number(paid.amount).toLocaleString('en-IN')} has been sent to your bank account`,
    data: { withdrawal_id: paid.id }
  });

  res.json(paid);
});

// POST /api/wallet/adjust — staff-applied ledger entries that have no
// automated trigger for most types (service charge, manual credit/debit,
// refund, security hold/release — these stay manual). 'commission' is the
// exception since loadBids.js's deliver route started auto-applying a
// matching commission_rules row on trip completion — this endpoint is
// still here as a manual override/backstop for cases with no matching rule
// or an ad-hoc adjustment. Shares its ledger-write with that automatic path
// via applyWalletAdjustment (lib/wallet.js) rather than each inserting its
// own wallet_transactions row.
router.post('/adjust', requireRole(STAFF_ROLES), async (req, res) => {
  const { user_id, type, amount, notes, reference_load_id } = req.body;
  const parsedAmount = Number(amount);

  if (!user_id || !ADJUSTABLE_TYPES.includes(type) || !parsedAmount || parsedAmount <= 0) {
    return res.status(400).json({ error: `user_id, amount (> 0) and type (one of ${ADJUSTABLE_TYPES.join(', ')}) are required` });
  }

  try {
    const data = await applyWalletAdjustment({ user_id, type, amount: parsedAmount, notes, reference_load_id });
    res.status(201).json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/wallet/razorpay-webhook — mounted without requireAuth/requireConsents
// (see index.js): Razorpay calls this directly, there's no user session.
// Signature verification against the raw request body is what stands in for
// auth here.
export async function razorpayWebhookHandler(req, res) {
  const signature = req.headers['x-razorpay-signature'];
  if (!verifySignature(req.rawBody, signature, process.env.RAZORPAY_WEBHOOK_SECRET)) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const event = req.body;
  const payment = event?.payload?.payment?.entity;
  if (event.event !== 'payment.captured' || !payment?.order_id) {
    return res.status(200).json({ ignored: true });
  }

  const { data: tx, error: fetchError } = await supabaseAdmin
    .from('wallet_transactions')
    .select('*')
    .eq('razorpay_order_id', payment.order_id)
    .maybeSingle();
  if (fetchError) return res.status(400).json({ error: fetchError.message });
  // Unknown order, or already applied by a webhook retry — 200 either way so
  // Razorpay doesn't keep retrying a delivery there's nothing left to do for.
  if (!tx || tx.status === 'completed') return res.status(200).json({ ok: true });

  const { error: updateError } = await supabaseAdmin
    .from('wallet_transactions')
    .update({ status: 'completed', razorpay_payment_id: payment.id })
    .eq('id', tx.id);
  if (updateError) return res.status(400).json({ error: updateError.message });

  await notifyUser(tx.user_id, {
    type: 'wallet_credited',
    title: 'Wallet credited',
    body: `₹${Number(tx.amount).toLocaleString('en-IN')} added to your wallet`,
    data: { transaction_id: tx.transaction_id }
  });

  res.status(200).json({ ok: true });
}

export default router;
