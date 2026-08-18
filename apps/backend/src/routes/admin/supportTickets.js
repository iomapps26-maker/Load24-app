import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';

const router = Router();

const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];

// GET /api/admin/support-tickets?status= — every ticket (optionally
// filtered by status), joined with the submitter's profile, newest first.
// Separate from src/routes/supportTickets.js's user-facing /mine and POST /
// — that file is untouched; this is the staff-only counterpart.
router.get('/', async (req, res) => {
  let query = supabaseAdmin.from('support_tickets').select('*').order('created_at', { ascending: false });

  const { status } = req.query;
  if (status) {
    if (!TICKET_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${TICKET_STATUSES.join(', ')}` });
    }
    query = query.eq('status', status);
  }

  const { data: tickets, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  if (!tickets || tickets.length === 0) return res.json([]);

  const userIds = [...new Set(tickets.map((t) => t.user_id))];
  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, full_name, mobile')
    .in('user_id', userIds);
  if (profilesError) return res.status(400).json({ error: profilesError.message });

  const profileByUserId = new Map((profiles || []).map((p) => [p.user_id, p]));
  res.json(tickets.map((t) => ({ ...t, profile: profileByUserId.get(t.user_id) || null })));
});

// PATCH /api/admin/support-tickets/:id { status?, assigned_to? } — updates
// either or both. assigned_to (031_add_admin_extras.sql) is nullable — send
// assigned_to: null to unassign a ticket.
router.patch('/:id', async (req, res) => {
  const { status, assigned_to } = req.body;
  const patch = {};

  if (status !== undefined) {
    if (!TICKET_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${TICKET_STATUSES.join(', ')}` });
    }
    patch.status = status;
  }
  if (assigned_to !== undefined) {
    patch.assigned_to = assigned_to;
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'status and/or assigned_to are required' });
  }
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('support_tickets')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .maybeSingle();

  if (error) {
    if (error.code === '23503') return res.status(400).json({ error: 'assigned_to does not reference a real user' });
    return res.status(400).json({ error: error.message });
  }
  if (!data) return res.status(404).json({ error: 'Support ticket not found' });
  res.json(data);
});

export default router;
