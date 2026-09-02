import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';
import { getBiddingSettings } from '../../lib/platformSettings.js';

const router = Router();

const MAX_SLABS = 10;

// Validates the { slabs, above_slab_percent } security-deposit table sent by
// the admin panel. Returns { value } on success or { error } with a
// human-readable message. `slabs` may be empty — that disables the deposit.
function validateSecurityDeposit(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'security_deposit must be an object with slabs[] and above_slab_percent' };
  }
  if (!Array.isArray(input.slabs)) {
    return { error: 'security_deposit.slabs must be an array' };
  }
  if (input.slabs.length > MAX_SLABS) {
    return { error: `security_deposit.slabs can have at most ${MAX_SLABS} entries` };
  }

  const slabs = [];
  for (const [i, raw] of input.slabs.entries()) {
    if (raw === null || typeof raw !== 'object') {
      return { error: `security_deposit.slabs[${i}] must be an object` };
    }
    const up_to = Number(raw.up_to);
    const amount = Number(raw.amount);
    if (!Number.isFinite(up_to) || up_to <= 0) {
      return { error: `security_deposit.slabs[${i}].up_to must be a number greater than 0` };
    }
    if (!Number.isFinite(amount) || amount < 0) {
      return { error: `security_deposit.slabs[${i}].amount must be a number of 0 or more` };
    }
    slabs.push({ up_to, amount });
  }

  slabs.sort((a, b) => a.up_to - b.up_to);
  for (let i = 1; i < slabs.length; i += 1) {
    if (slabs[i].up_to === slabs[i - 1].up_to) {
      return { error: `security_deposit.slabs has a duplicate up_to value (${slabs[i].up_to})` };
    }
  }

  const pct = Number(input.above_slab_percent);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    return { error: 'security_deposit.above_slab_percent must be a number between 0 and 100' };
  }

  return { value: { slabs, above_slab_percent: pct } };
}

// GET /api/admin/platform-settings/bidding — the current Load24 charge % and
// the wallet security-deposit slab table (defaults if the row was never
// seeded / predates the slab table).
router.get('/bidding', async (req, res) => {
  try {
    res.json(await getBiddingSettings());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/admin/platform-settings/bidding
//   { load24_charge_percent?, security_deposit? }
// The admin-panel control for the 4% Load24 charge and the bid-amount →
// wallet-hold slab table (see lib/platformSettings.js's computeBidSecurityHold
// for how the table is evaluated). Partial: only the keys sent are changed,
// the rest keep their current value. Returns the full settings object after
// the change.
router.patch('/bidding', async (req, res) => {
  const patch = {};

  if (req.body.load24_charge_percent !== undefined) {
    const pct = Number(req.body.load24_charge_percent);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return res.status(400).json({ error: 'load24_charge_percent must be a number between 0 and 100' });
    }
    patch.load24_charge_percent = pct;
  }

  if (req.body.security_deposit !== undefined) {
    const { value, error } = validateSecurityDeposit(req.body.security_deposit);
    if (error) return res.status(400).json({ error });
    patch.security_deposit = value;
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'Provide load24_charge_percent and/or security_deposit' });
  }

  try {
    // Drop the legacy flat key on the way through so an old row stops carrying
    // it once staff touch these settings.
    const current = { ...(await getBiddingSettings()) };
    delete current.security_deposit_amount;
    const value = { ...current, ...patch };
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
