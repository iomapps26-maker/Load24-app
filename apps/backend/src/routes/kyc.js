import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { KYC_REQUIRED_DOCUMENTS } from '../lib/kycRequiredDocs.js';

const BUCKET = 'kyc-documents';
const router = Router();

// Lazily creates the caller's kyc_cases row on first touch, freezing
// kyc_type from their current user_profiles.user_type. Returns null (not an
// error) when the caller has no profile yet, or their role has no KYC
// requirement (staff/admin roles aren't in KYC_REQUIRED_DOCUMENTS).
async function getOrCreateCase(req) {
  const { data: existing, error: fetchError } = await req.supabase
    .from('kyc_cases')
    .select('*')
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (existing) return existing;

  const { data: profile, error: profileError } = await req.supabase
    .from('user_profiles')
    .select('user_type')
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile || !KYC_REQUIRED_DOCUMENTS[profile.user_type]) return null;

  const { data: created, error: createError } = await req.supabase
    .from('kyc_cases')
    .insert({ user_id: req.user.id, kyc_type: profile.user_type })
    .select()
    .single();
  if (createError) throw createError;
  return created;
}

function missingDocuments(kycCase, uploadedTypes) {
  const required = KYC_REQUIRED_DOCUMENTS[kycCase.kyc_type] || [];
  return required.filter((docType) => !uploadedTypes.has(docType));
}

// GET /api/profile/kyc/case — the case, its uploaded documents, and which
// required document types are still missing.
router.get('/case', async (req, res) => {
  let kycCase;
  try {
    kycCase = await getOrCreateCase(req);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!kycCase) return res.status(404).json({ error: 'No KYC required for this account' });

  const { data: documents, error } = await req.supabase
    .from('kyc_documents')
    .select('document_type, file_name, mime_type, uploaded_at')
    .eq('case_id', kycCase.id);
  if (error) return res.status(400).json({ error: error.message });

  const uploadedTypes = new Set((documents || []).map((d) => d.document_type));
  res.json({
    case: kycCase,
    documents: documents || [],
    required_documents: KYC_REQUIRED_DOCUMENTS[kycCase.kyc_type] || [],
    missing_documents: missingDocuments(kycCase, uploadedTypes)
  });
});

// POST /api/profile/kyc/documents/upload-url — mints a pre-signed Supabase
// Storage upload URL for one required document type. The client uploads the
// file directly to Storage with this URL, then calls POST /documents below
// to record it (this endpoint never touches file bytes).
router.post('/documents/upload-url', async (req, res) => {
  const { document_type, file_name } = req.body;
  if (!document_type) return res.status(400).json({ error: 'document_type is required' });

  let kycCase;
  try {
    kycCase = await getOrCreateCase(req);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!kycCase) return res.status(404).json({ error: 'No KYC required for this account' });

  const required = KYC_REQUIRED_DOCUMENTS[kycCase.kyc_type] || [];
  if (!required.includes(document_type)) {
    return res.status(400).json({ error: `${document_type} is not a required document for ${kycCase.kyc_type}` });
  }

  const ext = file_name && file_name.includes('.') ? file_name.split('.').pop().toLowerCase() : 'bin';
  const storage_path = `${req.user.id}/${document_type}.${ext}`;

  // Re-uploads reuse the same deterministic path (one file per document
  // type), so clear out any previous object first — createSignedUploadUrl
  // errors on an existing object rather than overwriting it.
  await supabaseAdmin.storage.from(BUCKET).remove([storage_path]);

  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(storage_path);
  if (error) return res.status(400).json({ error: error.message });

  res.status(200).json({ storage_path, signed_url: data.signedUrl, token: data.token });
});

// POST /api/profile/kyc/documents — records a document already uploaded to
// Storage via the signed URL above, then re-evaluates whether the case is
// now complete. Auto-submits (case + user_profiles.kyc_status ->
// 'submitted') the moment every required document type is present.
router.post('/documents', async (req, res) => {
  const { document_type, storage_path, file_name, mime_type } = req.body;
  if (!document_type || !storage_path) {
    return res.status(400).json({ error: 'document_type and storage_path are required' });
  }
  if (!storage_path.startsWith(`${req.user.id}/`)) {
    return res.status(403).json({ error: 'storage_path does not belong to this account' });
  }

  let kycCase;
  try {
    kycCase = await getOrCreateCase(req);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!kycCase) return res.status(404).json({ error: 'No KYC required for this account' });

  const required = KYC_REQUIRED_DOCUMENTS[kycCase.kyc_type] || [];
  if (!required.includes(document_type)) {
    return res.status(400).json({ error: `${document_type} is not a required document for ${kycCase.kyc_type}` });
  }

  const { data: document, error } = await req.supabase
    .from('kyc_documents')
    .upsert(
      {
        case_id: kycCase.id,
        document_type,
        storage_path,
        file_name: file_name ?? null,
        mime_type: mime_type ?? null,
        uploaded_at: new Date().toISOString()
      },
      { onConflict: 'case_id,document_type' }
    )
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });

  const { data: allDocs, error: listError } = await req.supabase
    .from('kyc_documents')
    .select('document_type')
    .eq('case_id', kycCase.id);
  if (listError) return res.status(400).json({ error: listError.message });

  const uploadedTypes = new Set((allDocs || []).map((d) => d.document_type));
  const missing = missingDocuments(kycCase, uploadedTypes);
  const isComplete = missing.length === 0;

  let caseStatus = kycCase.status;
  if (isComplete && !['submitted', 'verified'].includes(kycCase.status)) {
    caseStatus = 'submitted';
  } else if (!isComplete && kycCase.status === 'pending') {
    caseStatus = 'partial';
  }

  if (caseStatus !== kycCase.status) {
    await req.supabase.from('kyc_cases').update({ status: caseStatus, updated_at: new Date().toISOString() }).eq('id', kycCase.id);
    await req.supabase.from('user_profiles').update({ kyc_status: caseStatus }).eq('user_id', req.user.id);
  }

  res.status(200).json({ document, case_status: caseStatus, missing_documents: missing });
});

// POST /api/profile/kyc/submit — explicit, idempotent submit-with-validation:
// re-checks every required document is present before moving the case to
// 'submitted'. POST /documents above already auto-submits on the upload that
// completes the set, so this mainly exists as a safety net / for a manual
// "Submit for Verification" action.
router.post('/submit', async (req, res) => {
  let kycCase;
  try {
    kycCase = await getOrCreateCase(req);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!kycCase) return res.status(404).json({ error: 'No KYC required for this account' });

  const { data: docs, error } = await req.supabase.from('kyc_documents').select('document_type').eq('case_id', kycCase.id);
  if (error) return res.status(400).json({ error: error.message });

  const uploadedTypes = new Set((docs || []).map((d) => d.document_type));
  const missing = missingDocuments(kycCase, uploadedTypes);
  if (missing.length > 0) {
    return res.status(400).json({ error: 'Missing required documents', missing_documents: missing });
  }
  if (!['pending', 'partial'].includes(kycCase.status)) {
    return res.status(400).json({ error: `Cannot submit from status '${kycCase.status}'` });
  }

  const { data: updatedCase, error: updateError } = await req.supabase
    .from('kyc_cases')
    .update({ status: 'submitted', updated_at: new Date().toISOString() })
    .eq('id', kycCase.id)
    .select()
    .single();
  if (updateError) return res.status(400).json({ error: updateError.message });

  await req.supabase.from('user_profiles').update({ kyc_status: 'submitted' }).eq('user_id', req.user.id);

  res.status(200).json({ case: updatedCase });
});

export default router;
