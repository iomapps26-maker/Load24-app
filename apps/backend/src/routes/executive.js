import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { normalizeIndianPhone } from '../lib/phone.js';
import { notifyUser } from '../lib/notify.js';
import { BUSINESS_ROLES } from './onboarding.js';
import profileRouter from './profile.js';
import kycRouter from './kyc.js';
import bankDetailsRouter from './bankDetails.js';
import loadsRouter from './loads.js';
import trucksRouter from './trucks.js';
import truckAvailabilityRouter from './truckAvailability.js';

// Executive Desk (/executive/ in the website repo): a support
// executive takes a phone call and does, on the caller's behalf, whatever
// the caller could have done in the app themselves — register, fill the
// profile, upload KYC, add bank details, add a truck, post truck
// availability, post a load.
//
// Rather than re-implementing each of those flows, the executive calls the
// *same* user-facing route under /api/executive/users/:userId/<section>/...
// and actAsUser() below swaps req.user for that user before handing the
// request to the existing router. So every validation rule, verification
// reset and nearby-truck/nearby-load fan-out behaves exactly as if the user
// had done it themselves, and the result lands in the user's own app and in
// the normal admin verification queues (KYC, Bank Accounts, Trucks) with no
// parallel "executive copy" of anything. The only additions are:
//   - support_staff_id/support_action_at stamped on the touched row
//     (066_add_support_team_attribution.sql) -> "by Support Team" label in
//     the app and the admin portal;
//   - an in-app notification telling the user what support did;
//   - the audit_log row requireRole() already writes for every staff
//     mutation (actor = the executive, path includes the target user id).
//
// Verification stays with admin/managers: nothing here can approve KYC,
// bank accounts or trucks — those staff routes are not in the allowlists.

const router = Router();

// Must match whatsappAuth.ts's syntheticEmailFor(): a user registered here
// signs in later with WhatsApp OTP on the same number, and verify-otp finds
// this exact auth user by that email and logs them straight into it.
function syntheticEmailFor(phoneE164) {
  return `wa${phoneE164.replace('+', '')}@phone.load24.internal`;
}

const USER_SEARCH_COLUMNS =
  'user_id, full_name, mobile, city, state, company_name, user_email, user_type, kyc_status, is_active, created_at, support_staff_id, support_action_at';

// Each section the executive may act in: which existing router serves it,
// exactly which of that router's endpoints are reachable (anything else —
// DELETE /api/profile, staff-only /queue and /verify routes, ... — 404s),
// which table to stamp and how to find the touched row, and what to tell
// the user afterwards. Paths are relative to the section mount.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SECTIONS = [
  {
    mount: 'profile',
    router: profileRouter,
    table: 'user_profiles',
    rowFilter: (req) => ['user_id', req.user.id],
    allow: [['GET', /^\/me$/], ['POST', /^\/$/]],
    notice: () => ({ title: 'Profile updated by Support Team', body: 'LOAD24 Support Team updated your profile details.' })
  },
  {
    mount: 'kyc',
    router: kycRouter,
    table: 'kyc_cases',
    rowFilter: (req) => ['user_id', req.user.id],
    allow: [['GET', /^\/case$/], ['POST', /^\/documents\/upload-url$/], ['POST', /^\/documents$/], ['POST', /^\/location$/], ['POST', /^\/submit$/]],
    notice: () => ({ title: 'KYC updated by Support Team', body: 'LOAD24 Support Team uploaded KYC details for you. They are now under review.' })
  },
  {
    mount: 'bank-details',
    router: bankDetailsRouter,
    table: 'bank_details',
    rowFilter: (req) => ['user_id', req.user.id],
    allow: [['GET', /^\/me$/], ['POST', /^\/$/], ['POST', /^\/proof\/upload-url$/], ['POST', /^\/proof$/]],
    notice: () => ({ title: 'Bank details added by Support Team', body: 'LOAD24 Support Team saved your bank details. They are now under review.' })
  },
  {
    mount: 'loads',
    router: loadsRouter,
    table: 'loads',
    rowFilter: (req, body) => (body?.id ? ['id', body.id] : null),
    allow: [['GET', /^\/$/], ['GET', new RegExp(`^/${UUID}$`)], ['POST', /^\/$/]],
    notice: (body) => ({
      title: 'Load posted by Support Team',
      body: `LOAD24 Support Team posted your load${body?.loading_city && body?.unloading_city ? ` ${body.loading_city} → ${body.unloading_city}` : ''}.`,
      data: { load_id: body?.id }
    })
  },
  {
    mount: 'trucks',
    router: trucksRouter,
    table: 'trucks',
    // POST /:id/documents answers with the truck_documents row, not the truck.
    rowFilter: (req, body) => {
      const truckId = body?.truck_id ?? body?.id;
      return truckId ? ['id', truckId] : null;
    },
    allow: [
      ['GET', /^\/$/],
      ['GET', new RegExp(`^/${UUID}$`)],
      ['POST', /^\/$/],
      ['PATCH', new RegExp(`^/${UUID}$`)],
      ['POST', new RegExp(`^/${UUID}/documents/upload-url$`)],
      ['POST', new RegExp(`^/${UUID}/documents$`)]
    ],
    notice: (body) => ({
      title: 'Truck updated by Support Team',
      body: `LOAD24 Support Team updated your truck${body?.registration_number ? ` ${body.registration_number}` : ''}. It is now under review.`,
      data: { truck_id: body?.truck_id ?? body?.id }
    })
  },
  {
    mount: 'truck-availability',
    router: truckAvailabilityRouter,
    table: 'truck_availabilities',
    rowFilter: (req, body) => (body?.id ? ['id', body.id] : null),
    allow: [['GET', /^\/$/], ['POST', /^\/$/], ['PATCH', new RegExp(`^/${UUID}$`)]],
    notice: (body) => ({
      title: 'Truck availability posted by Support Team',
      body: `LOAD24 Support Team listed your truck as available${body?.current_city ? ` in ${body.current_city}` : ''}.`,
      data: { truck_availability_id: body?.id }
    })
  }
];

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

// Resolves :userId to the real auth user and makes the rest of the request
// run as them: req.user is the same auth.users record requireAuth would have
// attached for that user's own token (id, email, phone), and req.supabase is
// the service-role client, since there is no user JWT to build an RLS-scoped
// one from. The routers mounted behind this already scope every read and
// write to req.user explicitly (.eq('owner_id', req.user.id), posted_by =
// req.user.email, ...), which is what keeps them to this one user's rows.
// The executive who's actually calling stays available as req.staffUser.
async function actAsUser(req, res, next) {
  try {
    const { userId } = req.params;
    if (!new RegExp(`^${UUID}$`).test(userId)) return res.status(404).json({ error: 'User not found' });

    const [{ data: authData, error: authError }, { data: staffRoles, error: rolesError }] = await Promise.all([
      supabaseAdmin.auth.admin.getUserById(userId),
      supabaseAdmin.from('user_roles').select('role').eq('user_id', userId)
    ]);
    if (authError || !authData?.user) return res.status(404).json({ error: 'User not found' });
    if (rolesError) return res.status(400).json({ error: rolesError.message });
    // user_roles only ever holds internal staff roles (see admin/users.js's
    // GRANTABLE_ROLES; app roles live in user_business_roles) — acting as a
    // staff account would let an executive borrow that account's powers.
    if (staffRoles && staffRoles.length > 0) {
      return res.status(403).json({ error: 'Staff accounts cannot be managed from the Executive Desk' });
    }

    req.staffUser = req.user;
    req.user = authData.user;
    req.supabase = supabaseAdmin;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

function allowOnly(section) {
  return (req, res, next) => {
    const allowed = section.allow.some(([method, pattern]) => method === req.method && pattern.test(req.path));
    if (!allowed) return res.status(404).json({ error: `Not available from the Executive Desk: ${req.method} ${section.mount}${req.path}` });
    next();
  };
}

// Stamps the touched row "by Support Team" and notifies the user, once the
// wrapped route has produced a successful response for a mutation. Hooks
// res.json so the stamp is written *before* the response goes out — the
// executive's screen reloads right after, and should already see the label.
// Upload-URL minting is skipped: nothing has actually changed yet at that
// point (the follow-up POST .../documents or .../proof is the real change).
export async function stampSupportAction(table, filter, staffUserId) {
  const [column, value] = filter;
  const { error } = await supabaseAdmin
    .from(table)
    .update({ support_staff_id: staffUserId, support_action_at: new Date().toISOString() })
    .eq(column, value);
  if (error) console.error('[executive] support stamp failed', table, error);
}

// One call often means several writes in a row to the same section (five
// KYC documents, a truck then its RC and insurance) — tell the user once,
// not once per write.
const NOTICE_DEDUPE_MS = 15 * 60 * 1000;

async function notifyOncePerSection(userId, section, body) {
  const { data: recent } = await supabaseAdmin
    .from('notifications')
    .select('id')
    .eq('user_id', userId)
    .eq('type', 'support_team_action')
    .eq('data->>section', section.mount)
    .gte('created_at', new Date(Date.now() - NOTICE_DEDUPE_MS).toISOString())
    .limit(1);
  if (recent && recent.length > 0) return;

  const { title, body: text, data } = section.notice(body);
  await notifyUser(userId, { type: 'support_team_action', title, body: text, data: { ...data, section: section.mount } });
}

function stampAfterSuccess(section) {
  return (req, res, next) => {
    if (!MUTATING_METHODS.has(req.method) || req.path.endsWith('/upload-url')) return next();

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 300) return originalJson(body);
      const filter = section.rowFilter(req, body);
      if (!filter) return originalJson(body);

      Promise.resolve()
        .then(() => stampSupportAction(section.table, filter, req.staffUser.id))
        .then(() => {
          if (body && typeof body === 'object' && !Array.isArray(body) && section.table !== 'kyc_cases') {
            body.support_staff_id = req.staffUser.id;
          }
          notifyOncePerSection(req.user.id, section, body).catch((err) => console.error('[executive] notify failed', err));
        })
        .catch((err) => console.error('[executive] support stamp failed', err))
        .finally(() => originalJson(body));
      return res;
    };
    next();
  };
}

for (const section of SECTIONS) {
  router.use(`/users/:userId/${section.mount}`, actAsUser, allowOnly(section), stampAfterSuccess(section), section.router);
}

// GET /api/executive/users?q= — find the caller: name, mobile or email.
// Commas/parens stripped for the same reason loads.js's sanitizePicks does
// it (they're PostgREST or() syntax). A bare 10-digit number also matches
// the stored +91 form.
router.get('/users', async (req, res) => {
  const q = String(req.query.q || '').replace(/[,()]/g, '').trim();
  if (!q) return res.json({ users: [] });

  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select(USER_SEARCH_COLUMNS)
    .or(`full_name.ilike.%${q}%,mobile.ilike.%${q}%,user_email.ilike.%${q}%,company_name.ilike.%${q}%`)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ users: data || [] });
});

// GET /api/executive/users/:userId/overview — everything the executive needs
// on one screen while on the call: profile, KYC case + documents, bank
// details, trucks, availability postings and recent loads. Read-only;
// bypasses actAsUser since it touches nothing.
router.get('/users/:userId/overview', async (req, res) => {
  const { userId } = req.params;
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (profileError) return res.status(400).json({ error: profileError.message });
  if (!profile) return res.status(404).json({ error: 'User not found' });

  const [kycCase, bank, trucks, availability, loads] = await Promise.all([
    supabaseAdmin.from('kyc_cases').select('*').eq('user_id', userId).maybeSingle(),
    supabaseAdmin.from('bank_details').select('*').eq('user_id', userId).maybeSingle(),
    supabaseAdmin.from('trucks').select('*').eq('owner_id', userId).order('created_at', { ascending: false }),
    supabaseAdmin
      .from('truck_availabilities')
      .select('*, truck:trucks(registration_number, truck_type)')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false })
      .limit(20),
    supabaseAdmin.from('loads').select('*').eq('posted_by', profile.user_email).order('created_at', { ascending: false }).limit(20)
  ]);
  const failed = [kycCase, bank, trucks, availability, loads].find((r) => r.error);
  if (failed) return res.status(400).json({ error: failed.error.message });

  const { data: kycDocuments, error: docsError } = kycCase.data
    ? await supabaseAdmin.from('kyc_documents').select('document_type, file_name, uploaded_at').eq('case_id', kycCase.data.id)
    : { data: [], error: null };
  if (docsError) return res.status(400).json({ error: docsError.message });

  // proof_path is a storage key, not something the desk needs to see.
  const bankDetails = bank.data ? (({ proof_path, ...rest }) => rest)(bank.data) : null;

  res.json({
    profile,
    kyc: { case: kycCase.data, documents: kycDocuments || [] },
    bank_details: bankDetails,
    trucks: trucks.data || [],
    availability: availability.data || [],
    loads: loads.data || []
  });
});

// POST /api/executive/users — registers someone who isn't on LOAD24 yet,
// straight from the call: creates the same phone-login auth user the
// WhatsApp OTP sign-up would (so their first app login lands in this
// account, already set up) plus their profile, stamped "by Support Team".
// mobile_verified is true for the same reason profile.js sets it when the
// profile mobile matches auth.users.phone — here that phone was confirmed
// by the executive speaking to the caller on it.
router.post('/users', async (req, res) => {
  const { mobile, full_name, user_type, company_name, city, state, pincode } = req.body;
  if (!mobile || !full_name || !user_type) {
    return res.status(400).json({ error: 'mobile, full_name and user_type are required' });
  }
  if (!BUSINESS_ROLES.includes(user_type)) {
    return res.status(400).json({ error: `user_type must be one of: ${BUSINESS_ROLES.join(', ')}` });
  }
  const phone = normalizeIndianPhone(mobile);
  if (!phone) return res.status(400).json({ error: 'Enter a valid 10-digit Indian mobile number' });

  const { data: existing, error: lookupError } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id')
    .eq('mobile', phone)
    .maybeSingle();
  if (lookupError) return res.status(400).json({ error: lookupError.message });
  if (existing) {
    return res.status(409).json({ error: 'This mobile number is already registered on LOAD24.', user_id: existing.user_id });
  }

  const email = syntheticEmailFor(phone);
  let userId = null;
  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    phone,
    email_confirm: true,
    phone_confirm: true,
    user_metadata: { signup_method: 'support_executive', registered_by: req.user.id }
  });
  if (created?.user) {
    userId = created.user.id;
  } else {
    // An auth user for this number can already exist without a profile —
    // someone who got as far as the WhatsApp OTP and never finished
    // onboarding. Reuse it (generateLink only resolves the user here; no
    // link is sent anywhere).
    const alreadyExists = /already.*registered|already.*exists|email_exists/i.test(createError?.message || createError?.code || '');
    if (!alreadyExists) return res.status(400).json({ error: createError?.message || 'Could not create the user' });
    const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({ type: 'magiclink', email });
    userId = linkData?.user?.id ?? null;
    if (!userId) {
      return res.status(409).json({ error: 'This mobile number is already attached to another LOAD24 login. Ask the user to sign in and finish their profile in the app.' });
    }
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .insert({
      user_id: userId,
      user_email: email,
      full_name,
      mobile: phone,
      mobile_verified: true,
      user_type,
      company_name: company_name || null,
      city: city || null,
      state: state || null,
      pincode: pincode || null,
      support_staff_id: req.user.id,
      support_action_at: new Date().toISOString()
    })
    .select()
    .single();
  if (profileError) {
    if (profileError.code === '23505') return res.status(409).json({ error: 'This mobile number is already registered on LOAD24.' });
    return res.status(400).json({ error: profileError.message });
  }

  // Mirrors ProfileSetupScreen's follow-up onboarding.selectRole() call —
  // best-effort there too.
  const { error: roleError } = await supabaseAdmin.from('user_business_roles').insert({ user_id: userId, role: user_type });
  if (roleError) console.error('[executive] user_business_roles insert failed', roleError);

  res.status(201).json({ user_id: userId, profile });
});

// GET /api/executive/my-activity — the signed-in executive's own recent
// actions, from the audit_log rows requireRole() writes for them.
router.get('/my-activity', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('audit_log')
    .select('id, action, created_at')
    .eq('actor_user_id', req.user.id)
    .like('action', '% /api/executive/%')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ activity: data || [] });
});

export default router;
