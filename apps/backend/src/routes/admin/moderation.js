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

export default router;
