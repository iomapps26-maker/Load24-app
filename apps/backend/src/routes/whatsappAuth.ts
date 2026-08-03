import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { normalizeIndianPhone } from '../lib/phone.js';
import { issueOtp, consumeOtp } from '../lib/otp.js';
import { findAccountOwningPhone, linkVerifiedPhoneToUser, logAuthLinkEvent } from '../lib/identityLinking.js';
import { whatsappSendOtpRateLimiter, whatsappVerifyOtpRateLimiter } from '../middleware/rateLimit.js';
import { clientIp } from '../lib/http.js';

const router = Router();

// Deterministic, never-delivered placeholder email tied 1:1 to the phone
// number. Supabase auth.users always needs an email identity; this one only
// exists so generateLink() below can mint a session for a phone-only user.
// Deterministic means a repeat login from the same number always resolves
// to the same auth.users row, without needing a separate mapping table.
function syntheticEmailFor(phoneE164: string): string {
  return `wa${phoneE164.replace('+', '')}@phone.load24.internal`;
}

const sendOtpSchema = z.object({ phone: z.string() });
const verifyOtpSchema = z.object({ phone: z.string(), code: z.string().regex(/^\d{6}$/) });

// POST /api/auth/whatsapp/send-otp — unauthenticated (this *is* the login
// step, mounted in index.js before the requireAuth-gated /api/auth block).
// Same endpoint serves both sign-in and sign-up; which one happens is
// decided in verify-otp below, based on whether an auth.users row already
// exists for this phone's synthetic email (or a different account already
// owns this phone — see verify-otp).
router.post('/send-otp', whatsappSendOtpRateLimiter, async (req, res) => {
  const parsed = sendOtpSchema.safeParse(req.body);
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

// POST /api/auth/whatsapp/verify-otp — checks the code against the most
// recent unconsumed one for this phone. If this phone is already verified
// on a *different* real account (e.g. a Google account that completed
// profile setup with this same number), links this fresh OTP proof into
// that account instead of minting a new one — see identityLinking.ts.
// Otherwise creates the phone's own auth user on first login (a no-op on
// repeat logins). Either way, hands back a magic-link token the app
// exchanges client-side via supabase.auth.verifyOtp(...) for a real session
// (see apps/mobile/lib/AuthContext.js verifyPhoneOtp) — the actual session
// minting stays on the client using Supabase's own token, so AuthGate/
// AuthContext need no special-casing for either outcome here.
router.post('/verify-otp', whatsappVerifyOtpRateLimiter, async (req, res) => {
  const parsed = verifyOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'phone and 6-digit code are required' });
  }
  const phone = normalizeIndianPhone(parsed.data.phone);
  if (!phone) return res.status(400).json({ error: 'phone and 6-digit code are required' });

  const result = await consumeOtp(phone, parsed.data.code);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, attempts_remaining: result.attempts_remaining });
  }

  const syntheticEmail = syntheticEmailFor(phone);

  let targetEmail = syntheticEmail;

  const owner = await findAccountOwningPhone(phone).catch(() => null);
  if (owner && owner.authEmail !== syntheticEmail) {
    // A different, already-onboarded account owns this number — the OTP the
    // caller just proved possession of *is* fresh verification, so it's
    // safe to auto-link into that account rather than create a second one.
    await linkVerifiedPhoneToUser(owner.userId, phone);
    await logAuthLinkEvent({ userId: owner.userId, eventType: 'phone_auto_linked', phone, ipAddress: clientIp(req) });
    targetEmail = owner.authEmail;
  } else {
    const { error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: syntheticEmail,
      phone,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { signup_method: 'whatsapp_otp' }
    });
    const alreadyExists = /already.*registered|already.*exists|email_exists/i.test(
      createError?.message || (createError as any)?.code || ''
    );
    if (createError && !alreadyExists) {
      return res.status(400).json({ error: createError.message });
    }
  }

  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: targetEmail
  });
  if (linkError) return res.status(400).json({ error: linkError.message });

  res.status(200).json({ email: targetEmail, token_hash: linkData.properties?.hashed_token });
});

export default router;
