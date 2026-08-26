import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { generateTransactionId, getOrCreateWallet, getAvailableBalance, applyWalletAdjustment } from '../lib/wallet.js';
import { requireRole } from '../middleware/requireRole.js';
import { notifyUser } from '../lib/notify.js';

const STAFF_ROLES = ['admin', 'support_executive', 'support_manager', 'accounts_executive', 'accounts_manager'];
const ADJUSTABLE_TYPES = ['credit', 'debit', 'refund', 'commission', 'service_charge', 'security_hold', 'security_release'];
// Manual "Add Balance" top-up flow (replaces Razorpay): a user-supplied tag
// for *why* they're adding money, shown to staff during review — not to be
// confused with ADJUSTABLE_TYPES above, which are actual debit/credit ledger
// types.
const TOPUP_REASON_CATEGORIES = ['security_fee', 'service_charge', 'load_payment', 'other'];
const TOPUP_BUCKET = 'wallet-payment-proofs';
const TOPUP_PROOF_VIEW_URL_TTL_SECONDS = 300; // same TTL as kyc.js's DOC_VIEW_URL_TTL_SECONDS

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

// -- Wallet top-up (manual proof-of-payment) -------------------------------
// Replaces Razorpay. Flow: user requests a top-up with an amount + reason
// and immediately gets a transaction_id (this row starts 'awaiting_payment')
// → pays via the static QR/bank details already shown in the app → attaches
// a screenshot against that same transaction_id from Transaction History
// (which moves it to 'pending_verification') → staff review the screenshot
// and either verify it (the only thing that ever credits the wallet — see
// POST /:id/verify below) or reject it. The wallet is never credited just
// because a screenshot was attached.

// POST /api/wallet/topup-requests { amount, reason_category, reason_note }
router.post('/topup-requests', async (req, res) => {
  const amount = Number(req.body.amount);
  const { reason_category, reason_note } = req.body;

  if (!amount || amount <= 0) return res.status(400).json({ error: 'amount must be a positive number' });
  if (!TOPUP_REASON_CATEGORIES.includes(reason_category)) {
    return res.status(400).json({ error: `reason_category must be one of ${TOPUP_REASON_CATEGORIES.join(', ')}` });
  }
  if (reason_category === 'other' && !reason_note?.trim()) {
    return res.status(400).json({ error: 'reason_note is required when reason_category is "other"' });
  }

  try {
    const wallet = await getOrCreateWallet(req.user.id);
    const transaction_id = generateTransactionId();

    const { data, error } = await supabaseAdmin
      .from('wallet_topup_requests')
      .insert({
        transaction_id,
        wallet_id: wallet.id,
        user_id: req.user.id,
        amount,
        reason_category,
        reason_note: reason_note?.trim() || null
      })
      .select()
      .single();
    if (error) throw error;

    res.status(201).json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/wallet/topup-requests/mine — the caller's own top-up requests,
// newest first. The mobile app merges this with GET /transactions in
// Transaction History — once a request is verified the real
// wallet_transactions row (same transaction_id) takes over, so the client
// only needs to show the not-yet-verified ones from here.
router.get('/topup-requests/mine', async (req, res) => {
  const { data, error } = await req.supabase
    .from('wallet_topup_requests')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// POST /api/wallet/topup-requests/:id/proof/upload-url { file_name } —
// mints a signed Supabase Storage upload URL, same shape as kyc.js's
// POST /documents/upload-url. One screenshot per request at a deterministic
// path; a re-upload (while still awaiting review) overwrites it.
router.post('/topup-requests/:id/proof/upload-url', async (req, res) => {
  const { file_name } = req.body;

  const { data: reqRow, error: fetchError } = await req.supabase
    .from('wallet_topup_requests')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (fetchError) return res.status(400).json({ error: fetchError.message });
  if (!reqRow) return res.status(404).json({ error: 'Top-up request not found' });
  if (!['awaiting_payment', 'pending_verification'].includes(reqRow.status)) {
    return res.status(400).json({ error: `Cannot attach proof to a request that is already ${reqRow.status}` });
  }

  const ext = file_name && file_name.includes('.') ? file_name.split('.').pop().toLowerCase() : 'jpg';
  const storage_path = `${req.user.id}/${reqRow.id}.${ext}`;

  await supabaseAdmin.storage.from(TOPUP_BUCKET).remove([storage_path]);
  const { data, error } = await supabaseAdmin.storage.from(TOPUP_BUCKET).createSignedUploadUrl(storage_path);
  if (error) return res.status(400).json({ error: error.message });

  res.status(200).json({ storage_path, signed_url: data.signedUrl, token: data.token });
});

// POST /api/wallet/topup-requests/:id/proof { storage_path } — records the
// screenshot already uploaded via the signed URL above and moves the
// request to 'pending_verification' so it appears in the staff queue.
router.post('/topup-requests/:id/proof', async (req, res) => {
  const { storage_path } = req.body;
  if (!storage_path) return res.status(400).json({ error: 'storage_path is required' });
  if (!storage_path.startsWith(`${req.user.id}/`)) {
    return res.status(403).json({ error: 'storage_path does not belong to this account' });
  }

  const { data, error } = await supabaseAdmin
    .from('wallet_topup_requests')
    .update({ proof_storage_path: storage_path, proof_uploaded_at: new Date().toISOString(), status: 'pending_verification' })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .in('status', ['awaiting_payment', 'pending_verification'])
    .select()
    .maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Top-up request not found' });

  res.status(200).json(data);
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

// GET /api/wallet/topup-requests/pending — staff review queue: every request
// with a screenshot attached and not yet resolved, oldest first, with a
// short-lived signed view URL for the screenshot (proof_storage_path itself
// is never sent to the client) and the requesting user's name/mobile so
// staff aren't reviewing bare user_ids — same shape as kyc.js's GET /queue.
router.get('/topup-requests/pending', requireRole(STAFF_ROLES), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('wallet_topup_requests')
    .select('*')
    .eq('status', 'pending_verification')
    .order('created_at', { ascending: true });
  if (error) return res.status(400).json({ error: error.message });
  if (!data || data.length === 0) return res.json([]);

  const userIds = [...new Set(data.map((r) => r.user_id))];
  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, full_name, mobile')
    .in('user_id', userIds);
  if (profilesError) return res.status(400).json({ error: profilesError.message });
  const profileByUserId = new Map((profiles || []).map((p) => [p.user_id, p]));

  const withUrls = await Promise.all(
    data.map(async (r) => {
      const { data: signed } = await supabaseAdmin.storage.from(TOPUP_BUCKET).createSignedUrl(r.proof_storage_path, TOPUP_PROOF_VIEW_URL_TTL_SECONDS);
      return { ...r, proof_url: signed?.signedUrl ?? null, profile: profileByUserId.get(r.user_id) || null };
    })
  );
  res.json(withUrls);
});

// POST /api/wallet/topup-requests/:id/verify — only ever moves a request out
// of 'pending_verification', mirroring the pending-only guards on withdrawal
// approve/reject and kyc verify/reject. Reuses the request's own
// transaction_id for the wallet_transactions row it creates (one ID the
// user sees end-to-end) — that insert is what actually credits the wallet,
// via the same apply_wallet_transaction() trigger every other credit goes
// through. transaction_id is unique on wallet_transactions, so a concurrent
// double-verify (e.g. two staff clicking Verify at once) fails the second
// insert with a uniqueness violation instead of double-crediting.
router.post('/topup-requests/:id/verify', requireRole(STAFF_ROLES), async (req, res) => {
  const { data: reqRow, error: fetchError } = await supabaseAdmin
    .from('wallet_topup_requests')
    .select('*')
    .eq('id', req.params.id)
    .eq('status', 'pending_verification')
    .maybeSingle();
  if (fetchError) return res.status(400).json({ error: fetchError.message });
  if (!reqRow) return res.status(409).json({ error: 'No pending top-up request awaiting review with this id' });

  const { data: tx, error: txError } = await supabaseAdmin
    .from('wallet_transactions')
    .insert({
      transaction_id: reqRow.transaction_id,
      wallet_id: reqRow.wallet_id,
      user_id: reqRow.user_id,
      type: 'add_money',
      amount: reqRow.amount,
      status: 'completed',
      notes: reqRow.reason_note || reqRow.reason_category
    })
    .select()
    .single();
  if (txError) return res.status(400).json({ error: txError.message });

  const { data: verified, error: verifyError } = await supabaseAdmin
    .from('wallet_topup_requests')
    .update({ status: 'verified', reviewed_by: req.user.id, reviewed_at: new Date().toISOString(), wallet_transaction_id: tx.id })
    .eq('id', reqRow.id)
    .eq('status', 'pending_verification')
    .select()
    .maybeSingle();
  if (verifyError) return res.status(400).json({ error: verifyError.message });

  await notifyUser(reqRow.user_id, {
    type: 'wallet_credited',
    title: 'Wallet credited',
    body: `₹${Number(reqRow.amount).toLocaleString('en-IN')} added to your wallet`,
    data: { transaction_id: reqRow.transaction_id }
  });

  res.json(verified);
});

// POST /api/wallet/topup-requests/:id/reject { reason }
router.post('/topup-requests/:id/reject', requireRole(STAFF_ROLES), async (req, res) => {
  const { reason } = req.body;
  const { data, error } = await supabaseAdmin
    .from('wallet_topup_requests')
    .update({ status: 'rejected', rejection_reason: reason || null, reviewed_by: req.user.id, reviewed_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('status', 'pending_verification')
    .select()
    .maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(409).json({ error: 'No pending top-up request awaiting review with this id' });

  await notifyUser(data.user_id, {
    type: 'wallet_topup_rejected',
    title: 'Top-up not verified',
    body: reason || `We couldn't verify your ₹${Number(data.amount).toLocaleString('en-IN')} payment proof`,
    data: { transaction_id: data.transaction_id }
  });

  res.json(data);
});

export default router;
