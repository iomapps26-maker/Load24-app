import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';

const router = Router();

// bookings grows one row per confirmed trip forever (spec §8), so — like
// audit_log and unlike the small config-table CRUDs elsewhere under
// /api/admin — this route is capped rather than an unbounded select('*').
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const STATUSES = ['confirmed', 'in_transit', 'completed', 'cancelled'];

// GET /api/admin/bookings?status=&search=&from=&to=&limit=
//   status  — one of confirmed|in_transit|completed|cancelled, or 'active'
//             (confirmed + in_transit)
//   search  — exact booking_ref, or a party email
//   from/to — confirmed_at range (inclusive ISO timestamps)
//
// Each row is the booking joined with its load's route/material and the two
// parties' names — the admin "Bookings" list. Mirrors routes/admin/trips.js's
// GET / shape but across every booking, not just the currently-active trips.
router.get('/', async (req, res) => {
  const { status, search, from, to, limit } = req.query;

  const parsedLimit = limit !== undefined ? Number(limit) : DEFAULT_LIMIT;
  if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
    return res.status(400).json({ error: 'limit must be a positive number' });
  }

  let query = supabaseAdmin.from('bookings').select('*').order('confirmed_at', { ascending: false });

  if (status === 'active') query = query.in('status', ['confirmed', 'in_transit']);
  else if (status) {
    if (!STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')} or active` });
    query = query.eq('status', status);
  }
  if (from) query = query.gte('confirmed_at', from);
  if (to) query = query.lte('confirmed_at', to);
  if (search) {
    const term = String(search).trim();
    if (term.includes('@')) query = query.or(`poster_email.eq.${term},accepter_email.eq.${term}`);
    else query = query.eq('booking_ref', term.toUpperCase());
  }

  query = query.limit(Math.min(parsedLimit, MAX_LIMIT));

  const { data: bookings, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  if (!bookings || bookings.length === 0) return res.json([]);

  const loadIds = [...new Set(bookings.map((b) => b.load_id))];
  const emails = [...new Set(bookings.flatMap((b) => [b.poster_email, b.accepter_email]))];

  const [{ data: loads, error: loadsError }, { data: profiles, error: profilesError }] = await Promise.all([
    supabaseAdmin
      .from('loads')
      .select('id, load_id, status, material_type, loading_city, loading_pincode, unloading_city, unloading_pincode, distance_km')
      .in('id', loadIds),
    supabaseAdmin.from('user_profiles').select('user_email, full_name, mobile, user_type').in('user_email', emails)
  ]);
  if (loadsError) return res.status(400).json({ error: loadsError.message });
  if (profilesError) return res.status(400).json({ error: profilesError.message });

  const loadById = new Map((loads || []).map((l) => [l.id, l]));
  const profileByEmail = new Map((profiles || []).map((p) => [p.user_email, p]));

  res.json(
    bookings.map((booking) => ({
      ...booking,
      load: loadById.get(booking.load_id) || null,
      poster: profileByEmail.get(booking.poster_email) || null,
      accepter: profileByEmail.get(booking.accepter_email) || null
    }))
  );
});

export default router;
