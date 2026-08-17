import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { KYC_REQUIRED_DOCUMENTS, KYC_OPTIONAL_DOCUMENTS, KYC_REQUIRES_LOCATION } from '../lib/kycRequiredDocs.js';
import { requireRole } from '../middleware/requireRole.js';
import { notifyUser } from '../lib/notify.js';

const BUCKET = 'kyc-documents';
const STAFF_ROLES = ['admin', 'support_executive', 'support_manager'];
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

function allowedDocuments(kycType) {
  return [...(KYC_REQUIRED_DOCUMENTS[kycType] || []), ...(KYC_OPTIONAL_DOCUMENTS[kycType] || [])];
}

function isLocationMissing(kycCase) {
  if (!KYC_REQUIRES_LOCATION.includes(kycCase.kyc_type)) return false;
  return !(kycCase.location_address && kycCase.location_lat != null && kycCase.location_lng != null);
}

function locationPayload(kycCase) {
  return {
    address: kycCase.location_address ?? null,
    lat: kycCase.location_lat ?? null,
    lng: kycCase.location_lng ?? null,
    captured_at: kycCase.location_captured_at ?? null
  };
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
    optional_documents: KYC_OPTIONAL_DOCUMENTS[kycCase.kyc_type] || [],
    missing_documents: missingDocuments(kycCase, uploadedTypes),
    requires_location: KYC_REQUIRES_LOCATION.includes(kycCase.kyc_type),
    location: locationPayload(kycCase)
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

  if (!allowedDocuments(kycCase.kyc_type).includes(document_type)) {
    return res.status(400).json({ error: `${document_type} is not a valid document type for ${kycCase.kyc_type}` });
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

  if (!allowedDocuments(kycCase.kyc_type).includes(document_type)) {
    return res.status(400).json({ error: `${document_type} is not a valid document type for ${kycCase.kyc_type}` });
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
  const isComplete = missing.length === 0 && !isLocationMissing(kycCase);

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

// POST /api/profile/kyc/location — records the address + GPS pin captured on
// the device for roles in KYC_REQUIRES_LOCATION, then re-evaluates case
// completeness the same way POST /documents does.
router.post('/location', async (req, res) => {
  const { address, lat, lng } = req.body;
  if (!address || typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'address, lat and lng are required' });
  }

  let kycCase;
  try {
    kycCase = await getOrCreateCase(req);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!kycCase) return res.status(404).json({ error: 'No KYC required for this account' });
  if (!KYC_REQUIRES_LOCATION.includes(kycCase.kyc_type)) {
    return res.status(400).json({ error: `Location is not required for ${kycCase.kyc_type}` });
  }

  const { data: updatedCase, error } = await req.supabase
    .from('kyc_cases')
    .update({
      location_address: address,
      location_lat: lat,
      location_lng: lng,
      location_captured_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', kycCase.id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });

  const { data: docs, error: docsError } = await req.supabase.from('kyc_documents').select('document_type').eq('case_id', kycCase.id);
  if (docsError) return res.status(400).json({ error: docsError.message });

  const uploadedTypes = new Set((docs || []).map((d) => d.document_type));
  const missing = missingDocuments(updatedCase, uploadedTypes);
  const isComplete = missing.length === 0 && !isLocationMissing(updatedCase);

  let caseStatus = updatedCase.status;
  if (isComplete && !['submitted', 'verified'].includes(updatedCase.status)) {
    caseStatus = 'submitted';
  } else if (!isComplete && updatedCase.status === 'pending') {
    caseStatus = 'partial';
  }

  if (caseStatus !== updatedCase.status) {
    await req.supabase.from('kyc_cases').update({ status: caseStatus, updated_at: new Date().toISOString() }).eq('id', kycCase.id);
    await req.supabase.from('user_profiles').update({ kyc_status: caseStatus }).eq('user_id', req.user.id);
  }

  res.status(200).json({ location: locationPayload(updatedCase), case_status: caseStatus, missing_documents: missing });
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
  if (isLocationMissing(kycCase)) {
    return res.status(400).json({ error: 'Missing required location' });
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

// -- Staff-only review endpoints -------------------------------------------
// Both use the service-role client for every write, including
// user_profiles.kyc_status: kyc_cases_update_staff (008_add_kyc_documents.sql)
// lets all of STAFF_ROLES update a case via req.supabase, but
// user_profiles_update_own_or_admin (001_init.sql) only grants admin and
// support_manager write access to that table — supabaseAdmin keeps this one
// code path working for support_executive too.

// GET /api/profile/kyc/queue — staff review queue: every kyc_cases row not
// yet resolved ('pending', 'partial', or 'submitted' — i.e. everything
// except 'verified'/'rejected'), with the submitting user's profile and
// uploaded documents, newest case first. Deliberately includes
// 'pending'/'partial' rather than just 'submitted': hiding a case just
// because the user hasn't finished uploading yet made the queue look empty
// even when there was real, visible-in-the-app progress staff wanted to
// see. The client is responsible for only offering Approve/Reject (which
// :userId/verify and :userId/reject below only accept from 'submitted') once
// a case's status is actually 'submitted' — see admin/kyc/ on the website.
// Uses supabaseAdmin for the same reason profileForEmail/documentsForUser in
// loadBids.js do — the caller is authorized as staff, not as the case
// owner, so reading across other users' profiles/documents here is
// deliberate.
router.get('/queue', requireRole(STAFF_ROLES), async (req, res) => {
  const { data: cases, error } = await supabaseAdmin
    .from('kyc_cases')
    .select('*')
    .in('status', ['pending', 'partial', 'submitted'])
    .order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  if (!cases || cases.length === 0) return res.json([]);

  const userIds = cases.map((c) => c.user_id);
  const caseIds = cases.map((c) => c.id);

  const [{ data: profiles, error: profilesError }, { data: documents, error: documentsError }] = await Promise.all([
    supabaseAdmin.from('user_profiles').select('user_id, full_name, mobile, city').in('user_id', userIds),
    supabaseAdmin.from('kyc_documents').select('case_id, document_type, file_name, mime_type, uploaded_at').in('case_id', caseIds)
  ]);
  if (profilesError) return res.status(400).json({ error: profilesError.message });
  if (documentsError) return res.status(400).json({ error: documentsError.message });

  const profileByUserId = new Map((profiles || []).map((p) => [p.user_id, p]));
  const documentsByCaseId = new Map();
  for (const doc of documents || []) {
    if (!documentsByCaseId.has(doc.case_id)) documentsByCaseId.set(doc.case_id, []);
    documentsByCaseId.get(doc.case_id).push(doc);
  }

  res.json(
    cases.map((kycCase) => ({
      case: kycCase,
      profile: profileByUserId.get(kycCase.user_id) || null,
      documents: documentsByCaseId.get(kycCase.id) || []
    }))
  );
});

// POST /api/profile/kyc/:userId/verify — only ever moves a case out of
// 'submitted', mirroring the pending-only guard on withdrawal approve/reject
// in wallet.js so a stale review can't land twice.
router.post('/:userId/verify', requireRole(STAFF_ROLES), async (req, res) => {
  const { data: kycCase, error } = await supabaseAdmin
    .from('kyc_cases')
    .update({ status: 'verified', rejection_reason: null, reviewed_by: req.user.id, reviewed_at: new Date().toISOString() })
    .eq('user_id', req.params.userId)
    .eq('status', 'submitted')
    .select()
    .maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!kycCase) return res.status(409).json({ error: 'No submitted KYC case awaiting review for this user' });

  await supabaseAdmin.from('user_profiles').update({ kyc_status: 'verified' }).eq('user_id', req.params.userId);

  await notifyUser(req.params.userId, {
    type: 'kyc_verified',
    title: 'KYC Verified',
    body: 'Your KYC has been verified',
    data: {}
  });

  res.json({ case: kycCase });
});

// POST /api/profile/kyc/:userId/reject { reason }
router.post('/:userId/reject', requireRole(STAFF_ROLES), async (req, res) => {
  const { reason } = req.body;
  const { data: kycCase, error } = await supabaseAdmin
    .from('kyc_cases')
    .update({ status: 'rejected', rejection_reason: reason || null, reviewed_by: req.user.id, reviewed_at: new Date().toISOString() })
    .eq('user_id', req.params.userId)
    .eq('status', 'submitted')
    .select()
    .maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!kycCase) return res.status(409).json({ error: 'No submitted KYC case awaiting review for this user' });

  await supabaseAdmin.from('user_profiles').update({ kyc_status: 'rejected' }).eq('user_id', req.params.userId);

  await notifyUser(req.params.userId, {
    type: 'kyc_rejected',
    title: 'KYC Rejected',
    body: reason || 'Your KYC submission was rejected — please review and resubmit',
    data: {}
  });

  res.json({ case: kycCase });
});

export default router;
