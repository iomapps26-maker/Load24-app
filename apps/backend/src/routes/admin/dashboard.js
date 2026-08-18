import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';

const router = Router();

// A count-only query — {count:'exact', head:true} tells PostgREST to
// return just the row count in a header, no rows — same idea as the
// GET /api/wallet/withdrawals/pending style queries elsewhere, just without
// fetching any data at all. Any per-filter error is logged and folded into
// a 0 rather than failing the whole dashboard for one bad tile.
async function countRows(table, applyFilter) {
  let query = supabaseAdmin.from(table).select('*', { count: 'exact', head: true });
  if (applyFilter) query = applyFilter(query);
  const { count, error } = await query;
  if (error) {
    console.error('[admin/dashboard] count failed', table, error);
    return 0;
  }
  return count ?? 0;
}

// GET /api/admin/dashboard — top-line counts for the staff dashboard.
// Role-gated at the router level (see index.js), not per-route like
// kyc.js/wallet.js, since every route under /api/admin/* is staff-only with
// no user-facing counterpart.
router.get('/', async (req, res) => {
  const [
    total_users,
    kyc_pending,
    live_loads,
    available_vehicles,
    bookings,
    active_trips,
    completed_loads,
    revenueResult
  ] = await Promise.all([
    // auth.users isn't a PostgREST-queryable table (only 'public' schema
    // is exposed) — the Admin API is the only way to reach it. perPage:1
    // deliberately: this project's Admin API 500s ("Database error finding
    // users") on any page whose row window included a couple of malformed
    // seed rows we've since cleaned up (see grant-staff-role.mjs's
    // findUserByEmail comment) — asking for the smallest possible page
    // keeps this tile from breaking again if that ever recurs, since all we
    // need is the `total` field, not the users themselves.
    supabaseAdmin.auth.admin
      .listUsers({ page: 1, perPage: 1 })
      .then(({ data, error }) => {
        if (error) {
          console.error('[admin/dashboard] listUsers failed', error);
          return 0;
        }
        return data.total ?? 0;
      }),
    // Mirrors kyc.js's GET /queue definition exactly: anything not yet
    // resolved (verified/rejected), so this tile and the KYC Queue page
    // always agree on what "pending" means.
    countRows('kyc_cases', (q) => q.in('status', ['pending', 'partial', 'submitted'])),
    countRows('loads', (q) => q.eq('status', 'active')),
    countRows('truck_availabilities', (q) => q.eq('status', 'available')),
    countRows('loads', (q) => q.eq('status', 'matched')), // "bookings"
    countRows('loads', (q) => q.eq('status', 'in_transit')), // "active trips"
    countRows('loads', (q) => q.eq('status', 'completed')),
    // admin_wallet_revenue() (031_add_admin_extras.sql) sums completed
    // commission/service_charge transactions — the platform's own take, not
    // gross money moving through wallets. A plain PostgREST aggregate
    // (.select('total:amount.sum()')) isn't an option: this project has
    // aggregate functions disabled ("PGRST123 Use of aggregate functions is
    // not allowed"), so the sum has to happen in a SQL function instead.
    supabaseAdmin.rpc('admin_wallet_revenue').then(({ data, error }) => {
      if (error) {
        console.error('[admin/dashboard] revenue rpc failed', error);
        return 0;
      }
      return Number(data ?? 0);
    })
  ]);

  res.json({
    total_users,
    kyc_pending,
    live_loads,
    available_vehicles,
    bookings,
    active_trips,
    completed_loads,
    revenue: revenueResult
  });
});

export default router;
