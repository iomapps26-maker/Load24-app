import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';
import { generateMatchSuggestions } from '../../lib/matchSuggestions.js';

const router = Router();

// GET /api/admin/crm/suggestions?load_id= — whatever the scheduled job
// (lib/matchSuggestions.js, wired into index.js) last generated, joined
// with the load and the suggested transporter's profile, newest first.
router.get('/suggestions', async (req, res) => {
  let query = supabaseAdmin.from('match_suggestions').select('*').order('created_at', { ascending: false });
  if (req.query.load_id) query = query.eq('load_id', req.query.load_id);

  const { data: suggestions, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  if (!suggestions?.length) return res.json([]);

  const loadIds = [...new Set(suggestions.map((s) => s.load_id))];
  const transporterIds = [...new Set(suggestions.map((s) => s.suggested_transporter_id))];

  const [{ data: loads, error: loadsError }, { data: profiles, error: profilesError }] = await Promise.all([
    supabaseAdmin.from('loads').select('*').in('id', loadIds),
    supabaseAdmin.from('user_profiles').select('user_id, full_name, mobile, city').in('user_id', transporterIds)
  ]);
  if (loadsError) return res.status(400).json({ error: loadsError.message });
  if (profilesError) return res.status(400).json({ error: profilesError.message });

  const loadById = new Map((loads || []).map((l) => [l.id, l]));
  const profileByUserId = new Map((profiles || []).map((p) => [p.user_id, p]));

  res.json(
    suggestions.map((s) => ({
      ...s,
      load: loadById.get(s.load_id) || null,
      transporter: profileByUserId.get(s.suggested_transporter_id) || null
    }))
  );
});

// POST /api/admin/crm/generate — runs the same job the scheduled interval
// in index.js does, on demand. Lets staff force a refresh without waiting
// for the next tick.
router.post('/generate', async (req, res) => {
  try {
    const result = await generateMatchSuggestions();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
