import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { TRUCK_DOCUMENT_TYPES } from '../lib/truckDocumentTypes.js';

const router = Router();

const BUCKET = 'truck-documents';

// 'other' lets the caller escape the closed list — the free-text detail
// goes in truck_type_other / body_type_other (see 022_add_truck_type_other.sql).
const TRUCK_TYPES = [
  'mahindra_pickup', 'tata_407', 'tata_ace', 'chota_hathi', 'four_vehicle_loader',
  'eicher_truck', 'ashok_leyland', 'lcv', 'lgv',
  'trailer', 'tanker', 'tipper', 'flatbed', 'car_carrier', 'other'
];
const BODY_TYPES = ['open', 'closed', 'container', 'other'];
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

// Validates the fixed-choice fields when present — all are optional on
// write (the form fills in stages) but must be one of the known values if
// sent at all.
function validateEnums(body) {
  if (body.truck_type && !TRUCK_TYPES.includes(body.truck_type)) return `Invalid truck_type: ${body.truck_type}`;
  if (body.body_type && !BODY_TYPES.includes(body.body_type)) return `Invalid body_type: ${body.body_type}`;
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
  const enumError = validateEnums(req.body);
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
  const enumError = validateEnums(req.body);
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

export default router;
