import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';

const router = Router();

// Full status enums after 032_add_moderation_statuses.sql widened both —
// this endpoint accepts any valid status for the table, not just
// 'flagged'/'removed': restoring a moderated row means setting it back to
// whatever it actually was before (active/matched/... for a load,
// active/inactive for a truck), which the caller supplies directly. This
// endpoint has no memory of a row's pre-moderation status — it's the
// admin UI's job to remember what it was flagging/removing from.
const LOAD_STATUSES = ['active', 'matched', 'in_transit', 'completed', 'cancelled', 'expired', 'flagged', 'removed'];
const TRUCK_STATUSES = ['active', 'inactive', 'flagged', 'removed'];

// GET /api/admin/moderation/loads?status=&page=&limit= — every load, any
// owner, any status — unlike GET /api/loads (only status='active' or, with
// ?mine=true, the caller's own), which can't back a moderation view of
// other users' loads at all. Joined with the poster's profile so the table
// doesn't just show a bare email.
router.get('/loads', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabaseAdmin.from('loads').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(from, to);
  if (req.query.status) query = query.eq('status', req.query.status);

  const { data: loads, error, count } = await query;
  if (error) return res.status(400).json({ error: error.message });

  const emails = [...new Set((loads || []).map((l) => l.posted_by))];
  const { data: profiles, error: profilesError } = emails.length
    ? await supabaseAdmin.from('user_profiles').select('user_email, full_name, mobile').in('user_email', emails)
    : { data: [], error: null };
  if (profilesError) return res.status(400).json({ error: profilesError.message });

  const profileByEmail = new Map((profiles || []).map((p) => [p.user_email, p]));
  res.json({
    loads: (loads || []).map((l) => ({ ...l, poster: profileByEmail.get(l.posted_by) || null })),
    page,
    limit,
    total: count ?? 0
  });
});

// GET /api/admin/moderation/trucks?status=&page=&limit= — every truck, any
// owner, any status — unlike GET /api/trucks (hard-scoped to
// eq('owner_id', req.user.id)), which is the caller's own trucks only.
router.get('/trucks', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabaseAdmin.from('trucks').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(from, to);
  if (req.query.status) query = query.eq('status', req.query.status);

  const { data: trucks, error, count } = await query;
  if (error) return res.status(400).json({ error: error.message });

  const ownerIds = [...new Set((trucks || []).map((t) => t.owner_id))];
  const { data: profiles, error: profilesError } = ownerIds.length
    ? await supabaseAdmin.from('user_profiles').select('user_id, full_name, mobile').in('user_id', ownerIds)
    : { data: [], error: null };
  if (profilesError) return res.status(400).json({ error: profilesError.message });

  const profileByUserId = new Map((profiles || []).map((p) => [p.user_id, p]));
  res.json({
    trucks: (trucks || []).map((t) => ({ ...t, owner: profileByUserId.get(t.owner_id) || null })),
    page,
    limit,
    total: count ?? 0
  });
});

// PATCH /api/admin/moderation/loads/:id { status }
router.patch('/loads/:id', async (req, res) => {
  const { status } = req.body;
  if (!LOAD_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${LOAD_STATUSES.join(', ')}` });
  }

  const { data, error } = await supabaseAdmin.from('loads').update({ status }).eq('id', req.params.id).select().maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Load not found' });
  res.json(data);
});

// PATCH /api/admin/moderation/trucks/:id { status }
router.patch('/trucks/:id', async (req, res) => {
  const { status } = req.body;
  if (!TRUCK_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${TRUCK_STATUSES.join(', ')}` });
  }

  const { data, error } = await supabaseAdmin.from('trucks').update({ status }).eq('id', req.params.id).select().maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Truck not found' });
  res.json(data);
});

// PATCH /api/admin/moderation/users/:userId
//   { is_active?, bidding_restricted_until?, bidding_restriction_reason? }
// Staff control for the account-level bid-eligibility conditions (spec §2 —
// enforced by lib/bidEligibility.js / load_bids_insert_own RLS): deactivate or
// reactivate an account, and set or lift a bidding restriction.
// bidding_restricted_until is an ISO date/time in the future to restrict, or
// null (or "") to lift it — lifting also clears the reason. Same
// service-role-write pattern as the load/truck PATCHes above (no per-column
// RLS on user_profiles, and has_role() can't be relied on — see users.js).
router.patch('/users/:userId', async (req, res) => {
  const patch = {};

  if (req.body.is_active !== undefined) {
    patch.is_active = !!req.body.is_active;
  }

  if (req.body.bidding_restricted_until !== undefined) {
    const raw = req.body.bidding_restricted_until;
    if (raw === null || raw === '') {
      patch.bidding_restricted_until = null;
      patch.bidding_restriction_reason = null;
    } else {
      const when = new Date(raw);
      if (Number.isNaN(when.getTime())) {
        return res.status(400).json({ error: 'bidding_restricted_until must be an ISO date/time or null' });
      }
      patch.bidding_restricted_until = when.toISOString();
      if (req.body.bidding_restriction_reason !== undefined) {
        patch.bidding_restriction_reason = req.body.bidding_restriction_reason || null;
      }
    }
  } else if (req.body.bidding_restriction_reason !== undefined) {
    patch.bidding_restriction_reason = req.body.bidding_restriction_reason || null;
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'Provide is_active, bidding_restricted_until and/or bidding_restriction_reason' });
  }
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .update(patch)
    .eq('user_id', req.params.userId)
    .select('user_id, full_name, mobile, user_email, user_type, is_active, kyc_status, bidding_restricted_until, bidding_restriction_reason')
    .maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'User not found' });
  res.json(data);
});

export default router;
