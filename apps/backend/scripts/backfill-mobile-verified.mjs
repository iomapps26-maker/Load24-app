// One-off backfill for the mobile_verified bug fixed in routes/profile.js:
// every account that signed up (or logged in) via WhatsApp OTP before that
// fix proved possession of its phone number at the auth level
// (auth.users.phone + phone_confirm — see routes/whatsappAuth.ts) but never
// got that reflected in user_profiles.mobile_verified, because POST
// /api/profile never touched that column. This walks every profile with
// mobile_verified = false and flips it to true wherever its stored `mobile`
// matches that same account's OTP-verified auth phone — exactly the
// condition the fixed route now checks going forward, just applied
// retroactively.
//
// Read-only until the final update; --dry-run prints what it *would* change
// without writing anything.
//
// Usage:
//   node scripts/backfill-mobile-verified.mjs [--dry-run]
//
// Run from apps/backend/ so dotenv picks up .env (needs SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY).
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const DRY_RUN = process.argv.includes('--dry-run');

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

function normalizeIndianPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  const last10 = digits.slice(-10);
  if (last10.length !== 10 || !/^[6-9]/.test(last10)) return null;
  return `+91${last10}`;
}

async function main() {
  const { data: profiles, error } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, mobile')
    .eq('mobile_verified', false)
    .not('mobile', 'is', null);
  if (error) throw error;

  console.log(`Checking ${profiles.length} unverified profile(s)...`);

  let fixed = 0;
  for (const profile of profiles) {
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(profile.user_id);
    if (userError || !userData?.user) {
      console.warn(`  (skipping ${profile.user_id} — could not load auth user: ${userError?.message || 'not found'})`);
      continue;
    }

    const verifiedAuthPhone = userData.user.phone ? normalizeIndianPhone(userData.user.phone) : null;
    if (!verifiedAuthPhone || verifiedAuthPhone !== profile.mobile) continue;

    console.log(`  ${profile.user_id} (${userData.user.email}): mobile ${profile.mobile} matches OTP-verified auth phone — marking verified`);
    fixed += 1;
    if (!DRY_RUN) {
      const { error: updateError } = await supabaseAdmin
        .from('user_profiles')
        .update({ mobile_verified: true })
        .eq('user_id', profile.user_id);
      if (updateError) console.error(`    update failed: ${updateError.message}`);
    }
  }

  console.log(`\n${DRY_RUN ? 'Would fix' : 'Fixed'} ${fixed} of ${profiles.length} unverified profile(s).`);
  if (DRY_RUN) console.log('Re-run without --dry-run to apply.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
