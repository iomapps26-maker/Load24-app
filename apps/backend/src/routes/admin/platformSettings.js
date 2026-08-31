import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';
import { getBiddingSettings } from '../../lib/platformSettings.js';

const router = Router();

// GET /api/admin/platform-settings/bidding — the current Load24 charge % and
// wallet security-deposit amount (defaults if the row was never seeded).
router.get('/bidding', async (req, res) => {
  try {
    res.json(await getBiddingSettings());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/admin/platform-settings/bidding
//   { load24_charge_percent?, security_deposit_amount? }
// The admin-panel control for raising or lowering the 4% Load24 charge (and,
// less often, the security-deposit amount). Partial: only the keys sent are
// changed, the rest keep their current value. Returns the full settings
// object after the change.
router.patch('/bidding', async (req, res) => {
  const patch = {};

  if (req.body.load24_charge_percent !== undefined) {
    const pct = Number(req.body.load24_charge_percent);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return res.status(400).json({ error: 'load24_charge_percent must be a number between 0 and 100' });
    }
    patch.load24_charge_percent = pct;
  }

  if (req.body.security_deposit_amount !== undefined) {
    const amt = Number(req.body.security_deposit_amount);
    if (!Number.isFinite(amt) || amt < 0) {
      return res.status(400).json({ error: 'security_deposit_amount must be a number of 0 or more' });
    }
    patch.security_deposit_amount = amt;
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'Provide load24_charge_percent and/or security_deposit_amount' });
  }

  try {
    const value = { ...(await getBiddingSettings()), ...patch };
    const { data, error } = await supabaseAdmin
      .from('platform_settings')
      .upsert(
        { key: 'bidding', value, updated_by: req.user.id, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      )
      .select()
      .single();
    if (error) throw error;
    res.json(data.value);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
