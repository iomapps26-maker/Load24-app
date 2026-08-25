// One-off / reusable staff provisioning script — there's no self-serve way
// to grant staff access yet (see PrivacyPolicy footnote in the website repo
// and the 403 message in /admin/*), so this exists to do by hand what a
// future admin UI should eventually do for itself:
//   1. look up an existing Supabase Auth user by email (must already exist —
//      create it via Supabase Dashboard > Authentication > Users first, this
//      script never sets a password)
//   2. grant it a row in user_roles (what requireRole() checks)
//   3. record the two REQUIRED_CONSENTS rows (see src/lib/consents.js) so
//      requireConsents-gated routes like /api/wallet/* aren't blocked either
//
// Usage:
//   node scripts/grant-staff-role.mjs <email> <role>
// Role must be one of the STAFF_ROLES kyc.js/wallet.js actually check:
//   admin | support_executive | support_manager
//
// Run from apps/backend/ so dotenv picks up .env (needs SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY).
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const [, , email, role] = process.argv;
const VALID_ROLES = ['admin', 'support_executive', 'support_manager'];

if (!email || !VALID_ROLES.includes(role)) {
  console.error(`Usage: node scripts/grant-staff-role.mjs <email> <role>\nrole must be one of: ${VALID_ROLES.join(', ')}`);
  process.exit(1);
}

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// listUsers 500s ("Database error finding users") on any page whose 10-row
// window covers rows 11-20 of this project's auth.users, regardless of
// perPage — looks like one bad row in that range, unrelated to this script.
// Work around it by paginating at 10/page and skipping (not aborting on) any
// page that 500s, up to a generous page ceiling.
async function findUserByEmail(targetEmail) {
  const target = targetEmail.toLowerCase();
  const perPage = 10;
  const maxPages = 300; // 3000 users
  for (let page = 1; page <= maxPages; page++) {
    let data;
    try {
      ({ data } = await supabaseAdmin.auth.admin.listUsers({ page, perPage }).then((r) => {
        if (r.error) throw r.error;
        return r;
      }));
    } catch (err) {
      console.warn(`  (skipping page ${page} — ${err.message || err})`);
      continue;
    }
    const match = data.users.find((u) => u.email?.toLowerCase() === target);
    if (match) return match;
    if (data.users.length < perPage) return null; // exhausted every page
  }
  return null;
}

async function main() {
  const user = await findUserByEmail(email);
  if (!user) {
    console.error(`No Supabase Auth user with email ${email}. Create it in the dashboard first (Authentication > Users > Add User), then re-run this.`);
    process.exit(1);
  }
  console.log(`Found user ${user.id} (${user.email})`);

  const { error: roleError } = await supabaseAdmin
    .from('user_roles')
    .upsert({ user_id: user.id, role }, { onConflict: 'user_id,role' });
  if (roleError) throw roleError;
  console.log(`Granted role '${role}'`);

  const REQUIRED_CONSENTS = [
    { consent_type: 'terms_of_service', version: '1.0' },
    { consent_type: 'privacy_policy', version: '1.0' }
  ];
  for (const c of REQUIRED_CONSENTS) {
    const { error } = await supabaseAdmin
      .from('consents')
      .upsert({ user_id: user.id, consent_type: c.consent_type, version: c.version, granted: true }, { onConflict: 'user_id,consent_type,version' });
    if (error) throw error;
    console.log(`Recorded consent ${c.consent_type}@${c.version}`);
  }

  console.log(`\n${email} can now sign in at /admin/login/.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
