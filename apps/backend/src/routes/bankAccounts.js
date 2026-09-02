import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireRole } from '../middleware/requireRole.js';
import { notifyUser } from '../lib/notify.js';

const BUCKET = 'bank-account-proofs';
const STAFF_ROLES = ['admin', 'support_executive', 'support_manager'];
// Same TTL as kyc.js's DOC_VIEW_URL_TTL_SECONDS — minted fresh on every
// /pending fetch rather than stored, so a leaked link stops working quickly.
const PROOF_VIEW_URL_TTL_SECONDS = 300;

const router = Router();

// Maps a bank_details row to the payout-account shape the admin portal
// expects. The stored columns predate the withdrawal flow and are unprefixed
// (account_holder_name, ...); withdrawal_requests and this API both use the
// bank_-prefixed names, so translate here rather than renaming the table out
// from under routes/bankDetails.js / routes/wallet.js / the mobile app.
function serializeAccount(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    bank_account_holder_name: row.account_holder_name,
    bank_account_number: row.account_number,
    bank_ifsc_code: row.ifsc_code,
    bank_name: row.bank_name,
    bank_branch: row.bank_branch ?? null,
    account_type: row.account_type ?? null,
    verification_status: row.verification_status,
    rejection_reason: row.rejection_reason ?? null,
    reviewed_by: row.reviewed_by ?? null,
    reviewed_at: row.reviewed_at ?? null
  };
}

async function signedProofUrl(proofPath) {
  if (!proofPath) return null;
  const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(proofPath, PROOF_VIEW_URL_TTL_SECONDS);
  return data?.signedUrl ?? null;
}

// GET /api/profile/bank-accounts/pending — staff review queue: every
// bank_details row still awaiting review, oldest first, each with the
// submitting user's name/mobile/city and a fresh short-lived signed URL for
// the proof image (proof_path itself is never sent to the client). Same shape
// and supabaseAdmin-not-req.supabase reasoning as kyc.js's GET /queue — the
// caller is authorized as staff, not as the account owner.
router.get('/pending', requireRole(STAFF_ROLES), async (req, res) => {
  const { data: accounts, error } = await supabaseAdmin
    .from('bank_details')
    .select('*')
    .eq('verification_status', 'pending')
    .order('created_at', { ascending: true });
  if (error) return res.status(400).json({ error: error.message });
  if (!accounts || accounts.length === 0) return res.json([]);

  const userIds = [...new Set(accounts.map((a) => a.user_id))];
  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, full_name, mobile, city')
    .in('user_id', userIds);
  if (profilesError) return res.status(400).json({ error: profilesError.message });
  const profileByUserId = new Map((profiles || []).map((p) => [p.user_id, p]));

  const items = await Promise.all(
    accounts.map(async (a) => ({
      ...serializeAccount(a),
      proof_url: await signedProofUrl(a.proof_path),
      profile: profileByUserId.get(a.user_id) || null
    }))
  );
  res.json(items);
});

// Shared by verify/reject: loads the account, 404s if there's no such id, and
// 409s if it isn't pending — mirroring the pending-only guard on withdrawal
// approve/reject and kyc verify/reject so a stale review can't land twice.
async function loadPendingAccount(res, id) {
  const { data: account, error } = await supabaseAdmin
    .from('bank_details')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    res.status(400).json({ error: error.message });
    return null;
  }
  if (!account) {
    res.status(404).json({ error: 'Bank account not found' });
    return null;
  }
  if (account.verification_status !== 'pending') {
    res.status(409).json({ error: `This bank account has already been ${account.verification_status}` });
    return null;
  }
  return account;
}

// POST /api/profile/bank-accounts/:id/verify — pending -> verified. Clears any
// prior rejection_reason. The audit_log row (staff id, action, bank account
// id, reason) is written by requireRole -> logAction, same as every KYC review.
router.post('/:id/verify', requireRole(STAFF_ROLES), async (req, res) => {
  const account = await loadPendingAccount(res, req.params.id);
  if (!account) return;

  const now = new Date().toISOString();
  const { data: updated, error } = await supabaseAdmin
    .from('bank_details')
    .update({
      verification_status: 'verified',
      rejection_reason: null,
      reviewed_by: req.user.id,
      reviewed_at: now,
      updated_at: now
    })
    .eq('id', account.id)
    .eq('verification_status', 'pending')
    .select()
    .maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  // Lost a race with a concurrent review between the load above and here.
  if (!updated) return res.status(409).json({ error: 'This bank account has already been reviewed' });

  await notifyUser(updated.user_id, {
    type: 'bank_account_verified',
    title: 'Bank account verified',
    body: 'Your payout bank account has been verified.',
    data: {}
  });

  res.json(serializeAccount(updated));
});

// POST /api/profile/bank-accounts/:id/reject { reason } — pending -> rejected.
// reason is required; the app shows it and lets the user re-submit (which
// resets the account to pending — see routes/bankDetails.js).
router.post('/:id/reject', requireRole(STAFF_ROLES), async (req, res) => {
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (!reason) return res.status(400).json({ error: 'reason is required' });

  const account = await loadPendingAccount(res, req.params.id);
  if (!account) return;

  const now = new Date().toISOString();
  const { data: updated, error } = await supabaseAdmin
    .from('bank_details')
    .update({
      verification_status: 'rejected',
      rejection_reason: reason,
      reviewed_by: req.user.id,
      reviewed_at: now,
      updated_at: now
    })
    .eq('id', account.id)
    .eq('verification_status', 'pending')
    .select()
    .maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!updated) return res.status(409).json({ error: 'This bank account has already been reviewed' });

  await notifyUser(updated.user_id, {
    type: 'bank_account_rejected',
    title: 'Bank account not verified',
    body: reason || 'Your payout bank account was rejected — please review and re-submit.',
    data: {}
  });

  res.json(serializeAccount(updated));
});

export default router;
