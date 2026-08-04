import { Router } from 'express';

const router = Router();

const TRUCK_TYPES = [
  'mahindra_pickup', 'tata_407', 'tata_ace', 'chota_hathi', 'four_vehicle_loader',
  'eicher_truck', 'ashok_leyland', 'lcv', 'lgv', 'open_body', 'closed_body',
  'container', 'trailer', 'tanker', 'tipper', 'flatbed', 'car_carrier'
];

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

// Fields the caller may set themselves. verified/verified_at are staff-only
// and deliberately excluded here.
function pickWritableFields(body) {
  const {
    registration_number, truck_type, capacity_tons, chassis_number, engine_number,
    manufacturing_year, rc_number, rc_expiry, insurance_number, insurance_expiry,
    permit_number, permit_expiry, fitness_expiry, puc_expiry,
    driver_name, driver_mobile, driver_license_number, status
  } = body;
  return {
    registration_number, truck_type, capacity_tons, chassis_number, engine_number,
    manufacturing_year, rc_number, rc_expiry, insurance_number, insurance_expiry,
    permit_number, permit_expiry, fitness_expiry, puc_expiry,
    driver_name, driver_mobile, driver_license_number, status
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

// GET /api/trucks/:id — a single truck, must belong to the caller
router.get('/:id', async (req, res) => {
  const { data, error } = await req.supabase
    .from('trucks')
    .select('*')
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
  if (!TRUCK_TYPES.includes(truck_type)) {
    return res.status(400).json({ error: `Invalid truck_type: ${truck_type}` });
  }

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
  if (req.body.truck_type && !TRUCK_TYPES.includes(req.body.truck_type)) {
    return res.status(400).json({ error: `Invalid truck_type: ${req.body.truck_type}` });
  }

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

export default router;
