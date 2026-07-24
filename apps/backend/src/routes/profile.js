import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';

const router = Router();

// GET /api/profile/me — current user's profile row, or null if not created yet
router.get('/me', async (req, res) => {
  const { data, error } = await req.supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (error) return res.status(400).json({ error: error.message });
  // mpin_hash is a bcrypt hash, not something the client needs — never send
  // credential material back over the wire even to its own owner.
  if (data) delete data.mpin_hash;
  res.json(data);
});

// POST /api/profile — create/complete the profile for the signed-in user
router.post('/', async (req, res) => {
  const { full_name, mobile, user_type, company_name, city, state, pincode } = req.body;
  if (!mobile || !user_type) {
    return res.status(400).json({ error: 'mobile and user_type are required' });
  }

  const { data, error } = await req.supabase
    .from('user_profiles')
    .upsert(
      {
        user_id: req.user.id,
        user_email: req.user.email,
        full_name,
        mobile,
        user_type,
        company_name,
        city,
        state,
        pincode
      },
      { onConflict: 'user_id' }
    )
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

// DELETE /api/profile — permanently deletes the caller's account. Cascades
// to user_profiles and every table FK'd to auth.users (bank_details,
// reviews, support_tickets, user_devices, ...).
router.delete('/', async (req, res) => {
  const { error } = await supabaseAdmin.auth.admin.deleteUser(req.user.id);
  if (error) return res.status(400).json({ error: error.message });
  res.status(204).end();
});

export default router;