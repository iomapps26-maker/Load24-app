import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';

const PROOF_BUCKET = 'bank-account-proofs';
const ACCOUNT_TYPES = ['savings', 'current'];

const router = Router();

// GET /api/bank-details/me — current user's bank details, or null if not saved
// yet. verification_status + rejection_reason drive the Pending / Verified /
// Rejected badge on the Profile screen; staff set them via
// /api/profile/bank-accounts/:id/{verify,reject} (routes/bankAccounts.js).
router.get('/me', async (req, res) => {
  const { data, error } = await req.supabase
    .from('bank_details')
    .select('*')
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// POST /api/bank-details — create/replace the caller's bank details. Any
// submit or edit (re)starts review: verification_status -> 'pending' and the
// staff review fields are cleared, so a rejected account the user has fixed
// goes back into the queue. Staff-only re-verification lives in
// routes/bankAccounts.js.
router.post('/', async (req, res) => {
  const { account_holder_name, account_number, ifsc_code, bank_name, bank_branch, account_type } = req.body;
  if (!account_holder_name || !account_number || !ifsc_code || !bank_name) {
    return res.status(400).json({ error: 'account_holder_name, account_number, ifsc_code and bank_name are required' });
  }
  if (account_type != null && !ACCOUNT_TYPES.includes(account_type)) {
    return res.status(400).json({ error: `account_type must be one of ${ACCOUNT_TYPES.join(', ')}` });
  }

  const { data, error } = await req.supabase
    .from('bank_details')
    .upsert(
      {
        user_id: req.user.id,
        account_holder_name,
        account_number,
        ifsc_code,
        bank_name,
        bank_branch: bank_branch?.trim() || null,
        account_type: account_type ?? null,
        verification_status: 'pending',
        rejection_reason: null,
        reviewed_by: null,
        reviewed_at: null,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'user_id' }
    )
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

// POST /api/bank-details/proof/upload-url { file_name } — mints a signed
// Supabase Storage upload URL for the cancelled-cheque / passbook image, same
// shape as kyc.js's POST /documents/upload-url. One proof per user at a
// deterministic path; a re-upload overwrites it.
router.post('/proof/upload-url', async (req, res) => {
  const { file_name } = req.body;
  const ext = file_name && file_name.includes('.') ? file_name.split('.').pop().toLowerCase() : 'jpg';
  const storage_path = `${req.user.id}/proof.${ext}`;

  // Re-uploads reuse the same deterministic path, so clear any previous object
  // first — createSignedUploadUrl errors on an existing object rather than
  // overwriting it. Same as kyc.js's POST /documents/upload-url.
  await supabaseAdmin.storage.from(PROOF_BUCKET).remove([storage_path]);

  const { data, error } = await supabaseAdmin.storage.from(PROOF_BUCKET).createSignedUploadUrl(storage_path);
  if (error) return res.status(400).json({ error: error.message });

  res.status(200).json({ storage_path, signed_url: data.signedUrl, token: data.token });
});

// POST /api/bank-details/proof { storage_path } — records the proof image
// already uploaded via the signed URL above against the caller's bank_details
// row, and (re)starts review.
router.post('/proof', async (req, res) => {
  const { storage_path } = req.body;
  if (!storage_path) return res.status(400).json({ error: 'storage_path is required' });
  if (!storage_path.startsWith(`${req.user.id}/`)) {
    return res.status(403).json({ error: 'storage_path does not belong to this account' });
  }

  const { data, error } = await req.supabase
    .from('bank_details')
    .update({
      proof_path: storage_path,
      verification_status: 'pending',
      rejection_reason: null,
      reviewed_by: null,
      reviewed_at: null,
      updated_at: new Date().toISOString()
    })
    .eq('user_id', req.user.id)
    .select()
    .maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Add bank details before uploading a proof' });

  res.status(200).json(data);
});

export default router;
