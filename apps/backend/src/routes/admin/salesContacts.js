import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';
import { dbError, writeError } from '../../lib/httpErrors.js';
import { getOrCreateSalesContactReferralCode, getSalesContactReferralStats } from '../../lib/referrals.js';

// Admin CRUD for the sales-contact roster (db/migrations/061_...) — sibling
// of admin/supportContacts.js against sales_contact_roster instead. See
// that file's header comment for the shared design notes.

const LOG = '[admin/sales-contacts]';

const router = Router();

// Attaches referral_code/total_referred/verified_referred to a roster row.
// N+1 (one stats call per row) is fine here — this roster is a handful of
// staff, not a large table (see 061's assigned_count comment for the same
// "not worth denormalizing yet" reasoning).
async function withReferralStats(contact) {
  const stats = await getSalesContactReferralStats(contact.id);
  return { ...contact, referral_code: stats.code, total_referred: stats.total_referred, verified_referred: stats.verified_count };
}

// GET /api/admin/sales-contacts?is_active=
router.get('/', async (req, res) => {
  let query = supabaseAdmin.from('sales_contact_roster').select('*').order('name', { ascending: true });
  if (req.query.is_active !== undefined) query = query.eq('is_active', req.query.is_active === 'true');

  const { data, error } = await query;
  if (error) return dbError(res, error, 'Could not load sales contacts', { log: LOG });
  try {
    res.json(await Promise.all((data || []).map(withReferralStats)));
  } catch (err) {
    dbError(res, err, 'Could not load referral stats for sales contacts', { log: LOG });
  }
});

// GET /api/admin/sales-contacts/:id
router.get('/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('sales_contact_roster').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return dbError(res, error, 'Could not load this sales contact', { log: LOG });
  if (!data) return res.status(404).json({ error: 'Sales contact not found' });
  try {
    res.json(await withReferralStats(data));
  } catch (err) {
    dbError(res, err, 'Could not load referral stats for this sales contact', { log: LOG });
  }
});

// POST /api/admin/sales-contacts { name, phone, email?, is_active? }
router.post('/', async (req, res) => {
  const { name, phone, email, is_active } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'name and phone are required' });

  const { data, error } = await supabaseAdmin
    .from('sales_contact_roster')
    .insert({ name, phone, email: email || null, is_active: is_active !== undefined ? !!is_active : true })
    .select()
    .single();
  if (error) return writeError(res, error, 'Could not create this sales contact', { log: LOG });

  // Permanent referral code, generated the moment the contact exists — a
  // failure here still leaves the contact created (the row above already
  // committed); the next GET of this contact will simply retry generation,
  // since getOrCreateSalesContactReferralCode is idempotent.
  try {
    const referral_code = await getOrCreateSalesContactReferralCode(data.id);
    res.status(201).json({ ...data, referral_code, total_referred: 0, verified_referred: 0 });
  } catch (err) {
    console.error(LOG, err);
    res.status(201).json({ ...data, referral_code: null, total_referred: 0, verified_referred: 0 });
  }
});

// PATCH /api/admin/sales-contacts/:id
router.patch('/:id', async (req, res) => {
  const { name, phone, email, is_active } = req.body;
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (phone !== undefined) patch.phone = phone;
  if (email !== undefined) patch.email = email || null;
  if (is_active !== undefined) patch.is_active = !!is_active;

  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No fields to update' });
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin.from('sales_contact_roster').update(patch).eq('id', req.params.id).select().maybeSingle();
  if (error) return writeError(res, error, 'Could not update this sales contact', { log: LOG });
  if (!data) return res.status(404).json({ error: 'Sales contact not found' });
  res.json(data);
});

// DELETE /api/admin/sales-contacts/:id — see supportContacts.js's DELETE for
// the full rationale (pre-check + FK backstop, deactivate instead of delete
// once a contact has assignments).
router.delete('/:id', async (req, res) => {
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('sales_contact_roster')
    .select('assigned_count')
    .eq('id', req.params.id)
    .maybeSingle();
  if (fetchError) return dbError(res, fetchError, 'Could not delete this sales contact', { log: LOG });
  if (!existing) return res.status(404).json({ error: 'Sales contact not found' });
  if (existing.assigned_count > 0) {
    return res.status(409).json({
      error: `This contact has ${existing.assigned_count} user(s) assigned to it — deactivate it instead of deleting.`
    });
  }

  // Same "deactivate instead" rule as assigned_count above, for referral
  // history — referrals.referrer_sales_contact_id deliberately has no ON
  // DELETE CASCADE (064_add_sales_contact_referrals.sql), so a contact with
  // referrals attributed to it can't be hard-deleted without first clearing
  // this check (or hitting the 23503 backstop below).
  let referralStats;
  try {
    referralStats = await getSalesContactReferralStats(req.params.id);
  } catch (err) {
    return dbError(res, err, 'Could not delete this sales contact', { log: LOG });
  }
  if (referralStats.total_referred > 0) {
    return res.status(409).json({
      error: `This contact has ${referralStats.total_referred} referral(s) attributed to it — deactivate it instead of deleting.`
    });
  }

  const { data, error } = await supabaseAdmin.from('sales_contact_roster').delete().eq('id', req.params.id).select().maybeSingle();
  if (error) {
    if (error.code === '23503') {
      return res.status(409).json({ error: 'This contact has users assigned to it — deactivate it instead of deleting.' });
    }
    return writeError(res, error, 'Could not delete this sales contact', { log: LOG });
  }
  if (!data) return res.status(404).json({ error: 'Sales contact not found' });
  res.status(204).end();
});

export default router;
