import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { mpinLoginRateLimiter, linkPhoneSendOtpRateLimiter, linkPhoneVerifyOtpRateLimiter } from '../middleware/rateLimit.js';
import { CONSENT_TYPES, REQUIRED_CONSENTS, missingRequiredConsents } from '../lib/consents.js';
import { normalizeIndianPhone } from '../lib/phone.js';
import { issueOtp, consumeOtp } from '../lib/otp.js';
import {
  findAccountOwningPhone,
  hasRealActivity,
  linkVerifiedPhoneToUser,
  clearPhoneFromUser,
  logAuthLinkEvent
} from '../lib/identityLinking.js';
import { clientIp } from '../lib/http.js';

const SUSPICIOUS_WINDOW_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const MPIN_PATTERN = /^\d{4,6}$/;
const MPIN_MAX_ATTEMPTS = 5;
const MPIN_LOCKOUT_MS = 15 * 60 * 1000;
const BCRYPT_ROUNDS = 10;

const router = Router();

// POST /api/auth/devices/checkin — called by the app right after a
// successful login (OTP, password, or OAuth) to register/refresh the
// device's session record and flag first-time-in-90-days devices. Also
// doubles as where a device's FCM push token gets (re)registered — see
// AuthContext.js, which fetches the token asynchronously and may call this
// again with just push_token once it's ready, after the initial checkin.
router.post('/devices/checkin', async (req, res) => {
  const { device_id, device_info, push_token } = req.body;
  if (!device_id) return res.status(400).json({ error: 'device_id is required' });

  const now = new Date();
  const ip_address = clientIp(req);

  const { data: existing, error: fetchError } = await req.supabase
    .from('user_devices')
    .select('id, last_login_at')
    .eq('user_id', req.user.id)
    .eq('device_id', device_id)
    .maybeSingle();

  if (fetchError) return res.status(400).json({ error: fetchError.message });

  const isNewDevice = !existing;
  const isStaleDevice =
    existing?.last_login_at && now.getTime() - new Date(existing.last_login_at).getTime() > SUSPICIOUS_WINDOW_MS;

  if (isNewDevice || isStaleDevice) {
    // Log only, per spec — no blocking. A real deployment would forward
    // this to the notifications/fraud pipeline instead of console.warn.
    console.warn(
      `[suspicious-login] user=${req.user.id} device=${device_id} reason=${isNewDevice ? 'new_device' : 'stale_device'} ip=${ip_address}`
    );
  }

  const { data, error } = await req.supabase
    .from('user_devices')
    .upsert(
      {
        user_id: req.user.id,
        device_id,
        device_info: device_info ?? null,
        ip_address,
        platform: device_info?.platform ?? 'web',
        // Only included when the caller actually sent one — omitting the
        // key (rather than writing null) means a routine re-checkin that
        // hasn't fetched a fresh token yet doesn't wipe out the token this
        // device already registered.
        ...(push_token ? { push_token } : {}),
        last_login_at: now.toISOString(),
        last_seen_at: now.toISOString()
      },
      { onConflict: 'user_id,device_id' }
    )
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(200).json({ device: data, suspicious: isNewDevice || isStaleDevice });
});

// POST /api/auth/logout-all-devices — invalidates every access token issued
// before now for this user (see requireAuth's token_valid_after check) and
// revokes their Supabase refresh tokens so no new access token can be
// minted elsewhere either.
router.post('/logout-all-devices', async (req, res) => {
  const now = new Date().toISOString();

  const { error: updateError } = await supabaseAdmin
    .from('user_profiles')
    .update({ token_valid_after: now })
    .eq('user_id', req.user.id);

  if (updateError) return res.status(400).json({ error: updateError.message });

  const { error: signOutError } = await supabaseAdmin.auth.admin.signOut(req.token, 'global');
  if (signOutError) return res.status(400).json({ error: signOutError.message });

  res.status(200).json({ ok: true, invalidated_at: now });
});

// POST /api/auth/mpin/set — (re)sets the caller's MPIN. Requires the caller
// to already be authenticated (Supabase session) the same as every other
// route here; this is not a signup/registration endpoint.
router.post('/mpin/set', async (req, res) => {
  const { mpin } = req.body;
  if (!MPIN_PATTERN.test(mpin || '')) {
    return res.status(400).json({ error: 'mpin must be 4-6 digits' });
  }

  const { data: existing, error: fetchError } = await req.supabase
    .from('user_profiles')
    .select('user_id')
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (fetchError) return res.status(400).json({ error: fetchError.message });
  if (!existing) return res.status(404).json({ error: 'Profile not found' });

  const mpin_hash = await bcrypt.hash(mpin, BCRYPT_ROUNDS);

  const { error } = await req.supabase
    .from('user_profiles')
    .update({
      mpin_hash,
      mpin_set_at: new Date().toISOString(),
      mpin_failed_attempts: 0,
      mpin_locked_until: null
    })
    .eq('user_id', req.user.id);

  if (error) return res.status(400).json({ error: error.message });
  res.status(200).json({ ok: true });
});

// POST /api/auth/mpin/login — MPIN is a local-unlock credential in front of
// the Supabase session the app already has cached on-device (persistSession
// in apps/mobile lib/supabase.js), not a standalone login: the caller must
// already hold a valid bearer token (requireAuth has run). A successful
// check just re-confirms "this is still the same person" so the app can
// skip re-prompting for the full password after being backgrounded/locked.
// Failed attempts are tracked on user_profiles (not just the in-memory
// mpinLoginRateLimiter) so a lockout survives an API server restart.
router.post('/mpin/login', mpinLoginRateLimiter, async (req, res) => {
  const { mpin } = req.body;
  if (!MPIN_PATTERN.test(mpin || '')) {
    return res.status(400).json({ error: 'mpin must be 4-6 digits' });
  }

  const { data: profile, error: fetchError } = await req.supabase
    .from('user_profiles')
    .select('mpin_hash, mpin_failed_attempts, mpin_locked_until')
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (fetchError) return res.status(400).json({ error: fetchError.message });
  if (!profile?.mpin_hash) return res.status(400).json({ error: 'MPIN not set' });

  if (profile.mpin_locked_until && new Date(profile.mpin_locked_until) > new Date()) {
    return res.status(429).json({ error: 'MPIN locked, try again later', locked_until: profile.mpin_locked_until });
  }

  const valid = await bcrypt.compare(mpin, profile.mpin_hash);

  if (!valid) {
    const attempts = (profile.mpin_failed_attempts || 0) + 1;
    const locked = attempts >= MPIN_MAX_ATTEMPTS;
    await req.supabase
      .from('user_profiles')
      .update({
        mpin_failed_attempts: attempts,
        mpin_locked_until: locked ? new Date(Date.now() + MPIN_LOCKOUT_MS).toISOString() : null
      })
      .eq('user_id', req.user.id);

    return res.status(401).json({
      error: 'Invalid MPIN',
      attempts_remaining: Math.max(MPIN_MAX_ATTEMPTS - attempts, 0)
    });
  }

  await req.supabase
    .from('user_profiles')
    .update({ mpin_failed_attempts: 0, mpin_locked_until: null })
    .eq('user_id', req.user.id);

  res.status(200).json({ ok: true });
});

// GET /api/auth/consents/status — lets the app check, before hitting a
// requireConsents-gated route, whether it needs to show the terms screen.
router.get('/consents/status', async (req, res) => {
  const { data, error } = await req.supabase
    .from('consents')
    .select('consent_type, version, granted')
    .eq('user_id', req.user.id)
    .eq('granted', true);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ missing_consents: missingRequiredConsents(data) });
});

// POST /api/auth/accept-terms — records versioned rows in the existing
// `consents` table (db/migrations/003_add_roles_devices_consents.sql).
// Defaults to REQUIRED_CONSENTS (terms_of_service + privacy_policy at their
// current version) when no body is sent; callers can also pass an explicit
// `consents` array to additionally record optional marketing opt-ins.
// requireConsents (src/middleware/requireConsents.js) reads this same table
// to gate access to non-onboarding routes.
//
// consents has no UPDATE RLS policy (acceptances are insert-only/versioned —
// see db/README.md), so this checks for already-recorded rows itself instead
// of upserting, making repeat calls with the same version a no-op.
type ConsentEntry = { consent_type: string; version: string; granted?: boolean };

router.post('/accept-terms', async (req, res) => {
  const entries: ConsentEntry[] =
    Array.isArray(req.body?.consents) && req.body.consents.length > 0 ? req.body.consents : REQUIRED_CONSENTS;

  for (const entry of entries) {
    if (
      typeof entry?.consent_type !== 'string' ||
      !CONSENT_TYPES.includes(entry.consent_type) ||
      typeof entry?.version !== 'string' ||
      !entry.version
    ) {
      return res.status(400).json({ error: `Invalid consent entry: ${JSON.stringify(entry)}` });
    }
  }

  const { data: existing, error: fetchError } = await req.supabase
    .from('consents')
    .select('consent_type, version')
    .eq('user_id', req.user.id);

  if (fetchError) return res.status(400).json({ error: fetchError.message });

  const already = new Set((existing || []).map((row) => `${row.consent_type}@${row.version}`));
  const ip_address = clientIp(req);
  const toInsert = entries
    .filter((entry) => !already.has(`${entry.consent_type}@${entry.version}`))
    .map((entry) => ({
      user_id: req.user.id,
      consent_type: entry.consent_type,
      version: entry.version,
      granted: entry.granted ?? true,
      granted_at: new Date().toISOString(),
      ip_address
    }));

  if (toInsert.length === 0) {
    return res.status(200).json({ consents: [] });
  }

  const { data, error } = await req.supabase.from('consents').insert(toInsert).select();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ consents: data });
});

const linkPhoneSendSchema = z.object({ phone: z.string() });
const linkPhoneVerifySchema = z.object({ phone: z.string(), code: z.string().regex(/^\d{6}$/) });

// POST /api/auth/link-phone/send-otp — authenticated. Sends a real WhatsApp
// OTP to a phone number the caller wants to attach to their *current*
// account (e.g. a Google-signed-in user who wants phone login too). Shares
// the same OTP infra as the public sign-in flow (lib/otp.ts), just
// rate-limited per-user instead of per-phone since there's already a session.
router.post('/link-phone/send-otp', linkPhoneSendOtpRateLimiter, async (req, res) => {
  const parsed = linkPhoneSendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid 10-digit Indian mobile number' });

  const phone = normalizeIndianPhone(parsed.data.phone);
  if (!phone) return res.status(400).json({ error: 'Enter a valid 10-digit Indian mobile number' });

  try {
    const { expires_in } = await issueOtp(phone);
    res.status(200).json({ ok: true, expires_in });
  } catch (err: any) {
    res.status(502).json({ error: err.message || 'Could not send WhatsApp message' });
  }
});

// POST /api/auth/link-phone/verify-otp — authenticated. On a correct code,
// attaches the phone to req.user's account:
//   - unclaimed, or already on this account -> link directly.
//   - claimed by a different account with NO profile (an empty shell, e.g.
//     an abandoned phone-only signup that never finished onboarding) -> safe
//     to re-home, since there's no real data to lose.
//   - claimed by a different account that HAS a profile -> refuse. Never
//     silently merge two accounts that both hold real data; the caller has
//     to go through support.
router.post('/link-phone/verify-otp', linkPhoneVerifyOtpRateLimiter, async (req, res) => {
  const parsed = linkPhoneVerifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'phone and 6-digit code are required' });

  const phone = normalizeIndianPhone(parsed.data.phone);
  if (!phone) return res.status(400).json({ error: 'phone and 6-digit code are required' });

  const result = await consumeOtp(phone, parsed.data.code);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, attempts_remaining: result.attempts_remaining });
  }

  const owner = await findAccountOwningPhone(phone);

  if (owner && owner.userId !== req.user.id) {
    const ownerHasProfile = await hasRealActivity(owner.userId);
    if (ownerHasProfile) {
      await logAuthLinkEvent({
        userId: req.user.id,
        eventType: 'phone_link_blocked',
        phone,
        ipAddress: clientIp(req)
      });
      return res.status(409).json({
        error: 'This number is linked to another account. Contact support to merge accounts.'
      });
    }
    // Empty shell — safe to re-home: it holds no data, so nothing is lost.
    await clearPhoneFromUser(owner.userId);
  }

  await linkVerifiedPhoneToUser(req.user.id, phone);
  await logAuthLinkEvent({ userId: req.user.id, eventType: 'phone_manual_linked', phone, ipAddress: clientIp(req) });

  res.status(200).json({ ok: true });
});

// GET /api/auth/identities — which sign-in methods are linked to the
// caller's account, for a Settings/"Linked Accounts" screen.
router.get('/identities', async (req, res) => {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(req.user.id);
  if (error || !data?.user) return res.status(400).json({ error: error?.message || 'User not found' });

  const providers = new Set((data.user.identities ?? []).map((identity) => identity.provider));
  // Phone-only accounts carry a synthetic, never-delivered email (see
  // whatsappAuth.ts syntheticEmailFor) — not a real linked email identity.
  const isSyntheticEmail = data.user.email?.endsWith('@phone.load24.internal') ?? false;

  res.json({
    email: isSyntheticEmail ? null : (data.user.email ?? null),
    google_linked: providers.has('google'),
    phone: data.user.phone || null,
    phone_linked: !!data.user.phone
  });
});

export default router;
