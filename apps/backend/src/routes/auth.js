import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';

const SUSPICIOUS_WINDOW_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

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

export default router;
