import { Router } from 'express';
import bcrypt from 'bcrypt';
import { supabaseAdmin } from '../lib/supabase.js';
import { mpinLoginRateLimiter } from '../middleware/rateLimit.js';
import { CONSENT_TYPES, REQUIRED_CONSENTS, missingRequiredConsents } from '../lib/consents.js';

const SUSPICIOUS_WINDOW_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const MPIN_PATTERN = /^\d{4,6}$/;
const MPIN_MAX_ATTEMPTS = 5;
const MPIN_LOCKOUT_MS = 15 * 60 * 1000;
const BCRYPT_ROUNDS = 10;

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || null;
}

const router = Router();

// POST /api/auth/devices/checkin — called by the app right after a
// successful login (OTP, password, or OAuth) to register/refresh the
// device's session record and flag first-time-in-90-days devices.
router.post('/devices/checkin', async (req, res) => {
  const { device_id, device_info } = req.body;
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
router.post('/accept-terms', async (req, res) => {
  const entries =
    Array.isArray(req.body?.consents) && req.body.consents.length > 0 ? req.body.consents : REQUIRED_CONSENTS;

  for (const entry of entries) {
    if (!CONSENT_TYPES.includes(entry?.consent_type) || typeof entry?.version !== 'string' || !entry.version) {
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

export default router;
