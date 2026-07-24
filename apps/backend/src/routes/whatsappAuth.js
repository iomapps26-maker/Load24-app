import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { supabaseAdmin } from '../lib/supabase.js';
import { sendWhatsAppOtp } from '../lib/whatsapp.js';
import { normalizeIndianPhone } from '../lib/phone.js';
import { whatsappSendOtpRateLimiter, whatsappVerifyOtpRateLimiter } from '../middleware/rateLimit.js';

// Matches the approved template's footer ("5 मिनट में समय-सीमा समाप्त हो
// जाएगी" / "expires in 5 minutes") — see load24_whatsapp_otp on the WABA.
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const BCRYPT_ROUNDS = 10;

const router = Router();

function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

// Deterministic, never-delivered placeholder email tied 1:1 to the phone
// number. Supabase auth.users always needs an email identity; this one only
// exists so generateLink() below can mint a session for a phone-only user.
// Deterministic means a repeat login from the same number always resolves
// to the same auth.users row, without needing a separate mapping table.
function syntheticEmailFor(phoneE164) {
  return `wa${phoneE164.replace('+', '')}@phone.load24.internal`;
}

// POST /api/auth/whatsapp/send-otp — unauthenticated (this *is* the login
// step, mounted in index.js before the requireAuth-gated /api/auth block).
// Same endpoint serves both sign-in and sign-up; which one happens is
// decided in verify-otp below, based on whether an auth.users row already
// exists for this phone's synthetic email.
router.post('/send-otp', whatsappSendOtpRateLimiter, async (req, res) => {
  const phone = normalizeIndianPhone(req.body?.phone);
  if (!phone) return res.status(400).json({ error: 'Enter a valid 10-digit Indian mobile number' });

  const code = generateCode();
  const code_hash = await bcrypt.hash(code, BCRYPT_ROUNDS);

  const { error: insertError } = await supabaseAdmin.from('whatsapp_otp_codes').insert({
    phone,
    code_hash,
    expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString()
  });
  if (insertError) return res.status(400).json({ error: insertError.message });

  try {
    await sendWhatsAppOtp(phone, code);
  } catch (err) {
    return res.status(502).json({ error: `Could not send WhatsApp message: ${err.message}` });
  }

  res.status(200).json({ ok: true, expires_in: OTP_TTL_MS / 1000 });
});

// POST /api/auth/whatsapp/verify-otp — checks the code against the most
// recent unconsumed one for this phone, creates the auth user on first
// login (a no-op on repeat logins — createUser fails "already registered"
// and that's treated as success), then hands back a magic-link token the
// app exchanges client-side via supabase.auth.verifyOtp(...) for a real
// session (see apps/mobile/lib/AuthContext.js verifyPhoneOtp). Keeping the
// actual session minting on the client, using Supabase's own token, means
// AuthGate/AuthContext need no special-casing for this login method.
router.post('/verify-otp', whatsappVerifyOtpRateLimiter, async (req, res) => {
  const phone = normalizeIndianPhone(req.body?.phone);
  const code = String(req.body?.code || '');
  if (!phone || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'phone and 6-digit code are required' });
  }

  const { data: otpRow, error: fetchError } = await supabaseAdmin
    .from('whatsapp_otp_codes')
    .select('id, code_hash, attempts, expires_at, consumed_at')
    .eq('phone', phone)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchError) return res.status(400).json({ error: fetchError.message });
  if (!otpRow || new Date(otpRow.expires_at) < new Date()) {
    return res.status(400).json({ error: 'Code expired, request a new one' });
  }
  if (otpRow.attempts >= OTP_MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many incorrect attempts, request a new code' });
  }

  const valid = await bcrypt.compare(code, otpRow.code_hash);
  if (!valid) {
    await supabaseAdmin
      .from('whatsapp_otp_codes')
      .update({ attempts: otpRow.attempts + 1 })
      .eq('id', otpRow.id);
    return res.status(401).json({ error: 'Incorrect code' });
  }

  await supabaseAdmin
    .from('whatsapp_otp_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', otpRow.id);

  const email = syntheticEmailFor(phone);

  const { error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    phone,
    email_confirm: true,
    phone_confirm: true,
    user_metadata: { signup_method: 'whatsapp_otp' }
  });
  const alreadyExists = /already.*registered|already.*exists|email_exists/i.test(
    createError?.message || createError?.code || ''
  );
  if (createError && !alreadyExists) {
    return res.status(400).json({ error: createError.message });
  }

  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email
  });
  if (linkError) return res.status(400).json({ error: linkError.message });

  res.status(200).json({ email, token_hash: linkData.properties?.hashed_token });
});

export default router;
