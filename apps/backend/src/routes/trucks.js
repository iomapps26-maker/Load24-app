import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { TRUCK_DOCUMENT_TYPES } from '../lib/truckDocumentTypes.js';
import { requireRole } from '../middleware/requireRole.js';
import { notifyUser } from '../lib/notify.js';

const router = Router();
const STAFF_ROLES = ['admin', 'support_executive', 'support_manager'];

const BUCKET = 'truck-documents';
// Same TTL as loadBids.js's TRIP_DOC_URL_TTL_SECONDS / kyc.js's — minted
// fresh on every queue fetch rather than stored, so a leaked link stops
// working quickly.
const DOC_VIEW_URL_TTL_SECONDS = 300;

// truck_type/body_type used to be hardcoded here (TRUCK_TYPES/BODY_TYPES)
// but now live in master_data (category 'truck_type'/'body_type' — see
// 041_add_master_data.sql, seeded with exactly the values that used to be
// in these arrays, and admin/masterData.js for the CRUD that manages them
// going forward) so staff can add a new truck type without a code deploy.
// 'other' lets the caller escape the list either way — the free-text detail
// goes in truck_type_other / body_type_other (see 022_add_truck_type_other.sql).
const FUEL_TYPES = ['diesel', 'cng', 'electric', 'other'];
const AXLE_TYPES = ['single_axle', 'multi_axle'];

// Only the two roles a truck's papers actually belong to may register one —
// mirrors the driver/vehicle_owner split in kycRequiredDocs.js, just for the
// vehicle instead of the person.
const TRUCK_ROLES = ['driver', 'vehicle_owner'];

async function callerHasTruckRole(req) {
  const { data, error } = await req.supabase
    .from('user_profiles')
    .select('user_type')
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (error) throw error;
  return !!data && TRUCK_ROLES.includes(data.user_type);
}

// True if `value` is an active master_data row under `category` — always
// supabaseAdmin, not req.supabase, same as the rest of this file's
// staff/cross-cutting reads: an inactive (deactivated by staff) row must
// fail validation exactly like one that was never seeded, so a truck_type
// retired via PATCH /api/admin/master-data/:id stops being acceptable on
// new/edited trucks without a separate code path.
async function isActiveMasterDataValue(category, value) {
  const { data, error } = await supabaseAdmin
    .from('master_data')
    .select('value')
    .eq('category', category)
    .eq('value', value)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

// Validates the fixed-choice fields when present — all are optional on
// write (the form fills in stages) but must be one of the known values if
// sent at all. truck_type/body_type round-trip through master_data (see the
// comment above FUEL_TYPES); fuel_type/axle_type are still the small fixed
// arrays above them since those weren't in scope for the master_data move.
async function validateEnums(body) {
  const [truckTypeOk, bodyTypeOk] = await Promise.all([
    body.truck_type ? isActiveMasterDataValue('truck_type', body.truck_type) : true,
    body.body_type ? isActiveMasterDataValue('body_type', body.body_type) : true
  ]);
  if (body.truck_type && !truckTypeOk) return `Invalid truck_type: ${body.truck_type}`;
  if (body.body_type && !bodyTypeOk) return `Invalid body_type: ${body.body_type}`;
  if (body.fuel_type && !FUEL_TYPES.includes(body.fuel_type)) return `Invalid fuel_type: ${body.fuel_type}`;
  if (body.axle_type && !AXLE_TYPES.includes(body.axle_type)) return `Invalid axle_type: ${body.axle_type}`;
  return null;
}

// Fields the caller may set themselves. verified/verified_at are staff-only
// and deliberately excluded here.
function pickWritableFields(body) {
  const {
    registration_number, truck_type, truck_type_other, tyre_count, body_type, body_type_other, capacity_tons,
    length_ft, width_ft, owner_name, owner_mobile, fuel_type, fuel_type_other, axle_type,
    permit_expiry, puc_expiry, insurance_expiry,
    driver_name, driver_mobile, status
  } = body;
  return {
    registration_number, truck_type, truck_type_other, tyre_count, body_type, body_type_other, capacity_tons,
    length_ft, width_ft, owner_name, owner_mobile, fuel_type, fuel_type_other, axle_type,
    permit_expiry, puc_expiry, insurance_expiry,
    driver_name, driver_mobile, status
  };
}

// GET /api/trucks — the caller's own trucks
router.get('/', async (req, res) => {
  const { data, error } = await req.supabase
    .from('trucks')
    .select('*')
    .eq('owner_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// GET /api/trucks/queue — staff review queue: every active, unverified
// truck, with the owner's profile and uploaded documents, newest first.
// Unlike kyc.js's /queue there's no status gate to mirror here — :id/verify
// below has no "must be in a certain state first" check, it just sets
// verified=true unconditionally — so nothing is excluded for being
// not-yet-actionable. Registered here, before GET /:id below, because
// Express would otherwise match "queue" as an :id value and 404 it as a
// truck lookup. Uses supabaseAdmin for the same cross-owner-read reason
// kyc.js's /queue does — req.supabase is not an option here even though
// trucks_select_own_or_staff RLS looks like it should allow it: has_role(),
// which that policy calls, recurses into user_roles' own RLS the moment
// it's evaluated as anyone other than the service role (see the comment on
// :id/verify below).
router.get('/queue', requireRole(STAFF_ROLES), async (req, res) => {
  const { data: trucks, error } = await supabaseAdmin
    .from('trucks')
    .select('*')
    .eq('verified', false)
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  if (!trucks || trucks.length === 0) return res.json([]);

  const ownerIds = [...new Set(trucks.map((t) => t.owner_id))];
  const truckIds = trucks.map((t) => t.id);

  const [{ data: owners, error: ownersError }, { data: documents, error: documentsError }] = await Promise.all([
    supabaseAdmin.from('user_profiles').select('user_id, full_name, mobile, city').in('user_id', ownerIds),
    supabaseAdmin.from('truck_documents').select('truck_id, document_type, file_name, mime_type, uploaded_at, storage_path').in('truck_id', truckIds)
  ]);
  if (ownersError) return res.status(400).json({ error: ownersError.message });
  if (documentsError) return res.status(400).json({ error: documentsError.message });

  // Signed view URLs, same short-lived-mint-on-every-fetch pattern kyc.js's
  // /queue and loadBids.js's documentsForUser use — storage_path itself is
  // never sent to the client.
  const documentsWithUrls = await Promise.all(
    (documents || []).map(async (doc) => {
      const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(doc.storage_path, DOC_VIEW_URL_TTL_SECONDS);
      const { storage_path, ...rest } = doc;
      return { ...rest, url: data?.signedUrl ?? null };
    })
  );

  const ownerByUserId = new Map((owners || []).map((o) => [o.user_id, o]));
  const documentsByTruckId = new Map();
  for (const doc of documentsWithUrls) {
    if (!documentsByTruckId.has(doc.truck_id)) documentsByTruckId.set(doc.truck_id, []);
    documentsByTruckId.get(doc.truck_id).push(doc);
  }

  res.json(
    trucks.map((truck) => ({
      truck,
      owner: ownerByUserId.get(truck.owner_id) || null,
      documents: documentsByTruckId.get(truck.id) || []
    }))
  );
});

// GET /api/trucks/:id — a single truck, must belong to the caller, with its
// uploaded documents embedded so the edit form knows what's already there.
router.get('/:id', async (req, res) => {
  const { data, error } = await req.supabase
    .from('trucks')
    .select('*, documents:truck_documents(document_type, file_name, mime_type, uploaded_at)')
    .eq('id', req.params.id)
    .eq('owner_id', req.user.id)
    .maybeSingle();

  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Truck not found' });
  res.json(data);
});

// POST /api/trucks — register a new truck for the caller
router.post('/', async (req, res) => {
  let hasTruckRole;
  try {
    hasTruckRole = await callerHasTruckRole(req);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!hasTruckRole) {
    return res.status(403).json({ error: 'Only driver or vehicle_owner accounts can register a truck' });
  }

  const { registration_number, truck_type } = req.body;
  if (!registration_number || !truck_type) {
    return res.status(400).json({ error: 'registration_number and truck_type are required' });
  }
  let enumError;
  try {
    enumError = await validateEnums(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (enumError) return res.status(400).json({ error: enumError });

  const { data, error } = await req.supabase
    .from('trucks')
    .insert({ ...pickWritableFields(req.body), owner_id: req.user.id })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'This registration number is already registered' });
    }
    return res.status(400).json({ error: error.message });
  }
  res.status(201).json(data);
});

// PATCH /api/trucks/:id — update a truck owned by the caller. Any edit
// resets `verified` to false — same "re-verify after any change" rule as
// bank_details.verified.
router.patch('/:id', async (req, res) => {
  let enumError;
  try {
    enumError = await validateEnums(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (enumError) return res.status(400).json({ error: enumError });

  const { data, error } = await req.supabase
    .from('trucks')
    .update({ ...pickWritableFields(req.body), verified: false, verified_at: null, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('owner_id', req.user.id)
    .select()
    .maybeSingle();

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'This registration number is already registered' });
    }
    return res.status(400).json({ error: error.message });
  }
  if (!data) return res.status(404).json({ error: 'Truck not found' });
  res.json(data);
});

// DELETE /api/trucks/:id — remove a truck owned by the caller
router.delete('/:id', async (req, res) => {
  const { data, error } = await req.supabase
    .from('trucks')
    .delete()
    .eq('id', req.params.id)
    .eq('owner_id', req.user.id)
    .select()
    .maybeSingle();

  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Truck not found' });
  res.status(204).end();
});

// Confirms the truck belongs to the caller before any document operation —
// truck_documents RLS would also catch a mismatch, but checking here first
// gives a clean 404 instead of an opaque insert/select failure.
async function ownedTruckOrNull(req) {
  const { data } = await req.supabase
    .from('trucks')
    .select('id')
    .eq('id', req.params.id)
    .eq('owner_id', req.user.id)
    .maybeSingle();
  return data;
}

// POST /api/trucks/:id/documents/upload-url — mints a pre-signed Supabase
// Storage upload URL for one document type on this truck. Same
// upload-URL-then-confirm flow as KYC documents (see kyc.js) — the client
// uploads the file directly to Storage, then calls POST /documents below to
// record it.
router.post('/:id/documents/upload-url', async (req, res) => {
  const { document_type, file_name } = req.body;
  if (!document_type) return res.status(400).json({ error: 'document_type is required' });
  if (!TRUCK_DOCUMENT_TYPES.includes(document_type)) {
    return res.status(400).json({ error: `Invalid document_type: ${document_type}` });
  }

  const truck = await ownedTruckOrNull(req);
  if (!truck) return res.status(404).json({ error: 'Truck not found' });

  const ext = file_name && file_name.includes('.') ? file_name.split('.').pop().toLowerCase() : 'bin';
  const storage_path = `${req.user.id}/${truck.id}/${document_type}.${ext}`;

  // Re-uploads reuse the same deterministic path (one file per document
  // type), so clear out any previous object first — createSignedUploadUrl
  // errors on an existing object rather than overwriting it.
  await supabaseAdmin.storage.from(BUCKET).remove([storage_path]);

  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(storage_path);
  if (error) return res.status(400).json({ error: error.message });

  res.status(200).json({ storage_path, signed_url: data.signedUrl, token: data.token });
});

// POST /api/trucks/:id/documents — records a document already uploaded to
// Storage via the signed URL above.
router.post('/:id/documents', async (req, res) => {
  const { document_type, storage_path, file_name, mime_type } = req.body;
  if (!document_type || !storage_path) {
    return res.status(400).json({ error: 'document_type and storage_path are required' });
  }
  if (!TRUCK_DOCUMENT_TYPES.includes(document_type)) {
    return res.status(400).json({ error: `Invalid document_type: ${document_type}` });
  }
  if (!storage_path.startsWith(`${req.user.id}/`)) {
    return res.status(403).json({ error: 'storage_path does not belong to this account' });
  }

  const truck = await ownedTruckOrNull(req);
  if (!truck) return res.status(404).json({ error: 'Truck not found' });

  // Any new document invalidates the previous verification, same rule as
  // editing the truck's own fields.
  const { data: document, error } = await req.supabase
    .from('truck_documents')
    .upsert(
      {
        truck_id: truck.id,
        document_type,
        storage_path,
        file_name: file_name ?? null,
        mime_type: mime_type ?? null,
        uploaded_at: new Date().toISOString()
      },
      { onConflict: 'truck_id,document_type' }
    )
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });

  await req.supabase.from('trucks').update({ verified: false, verified_at: null }).eq('id', truck.id);

  res.status(200).json(document);
});

// POST /api/trucks/:id/verify — staff-only. trucks_update_staff RLS
// (020_add_trucks.sql) would in principle let any of STAFF_ROLES update any
// truck row via req.supabase, but has_role() — which that policy and
// user_roles' own select policy both call — recurses into user_roles' own
// RLS the moment it's evaluated as anyone other than the service role,
// and user_roles_select_own_or_admin (003_add_roles_devices_consents.sql)
// queries user_roles from inside its own policy, which Postgres can't
// resolve ("infinite recursion detected in policy for relation
// 'user_roles'"). kyc.js and wallet.js's staff writes already route around
// this the same way — supabaseAdmin bypasses RLS (and therefore has_role())
// entirely, so it never hits the recursion.
router.post('/:id/verify', requireRole(STAFF_ROLES), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('trucks')
    .update({ verified: true, verified_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Truck not found' });

  await notifyUser(data.owner_id, {
    type: 'truck_verified',
    title: 'Truck verified',
    body: `${data.registration_number} has been verified`,
    data: { truck_id: data.id }
  });

  res.json(data);
});

export default router;
