import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { supabaseAdmin } from './supabase.js';
import { sendWhatsAppOtp } from './whatsapp.js';

// Matches the approved template's footer ("5 मिनट में समय-सीमा समाप्त हो
// जाएगी" / "expires in 5 minutes") — see load24_whatsapp_otp on the WABA.
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const BCRYPT_ROUNDS = 10;

export type IssueOtpResult = { expires_in: number };

export type ConsumeOtpResult =
  | { ok: true }
  | { ok: false; status: 400 | 401 | 429; error: string; attempts_remaining?: number };

function generateCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

// Shared by the public WhatsApp sign-in flow (whatsappAuth.ts) and the
// authenticated "link a phone to my account" flow (auth.ts) — both need
// the exact same issue/verify-with-lockout behavior against the same
// whatsapp_otp_codes table, just triggered from different entry points.
export async function issueOtp(phone: string): Promise<IssueOtpResult> {
  const code = generateCode();
  const code_hash = await bcrypt.hash(code, BCRYPT_ROUNDS);

  const { error: insertError } = await supabaseAdmin.from('whatsapp_otp_codes').insert({
    phone,
    code_hash,
    expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString()
  });
  if (insertError) throw new Error(insertError.message);

  await sendWhatsAppOtp(phone, code);

  return { expires_in: OTP_TTL_MS / 1000 };
}

export async function consumeOtp(phone: string, code: string): Promise<ConsumeOtpResult> {
  const { data: otpRow, error: fetchError } = await supabaseAdmin
    .from('whatsapp_otp_codes')
    .select('id, code_hash, attempts, expires_at, consumed_at')
    .eq('phone', phone)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchError) return { ok: false, status: 400, error: fetchError.message };
  if (!otpRow || new Date(otpRow.expires_at) < new Date()) {
    return { ok: false, status: 400, error: 'Code expired, request a new one' };
  }
  if (otpRow.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, status: 429, error: 'Too many incorrect attempts, request a new code' };
  }

  const valid = await bcrypt.compare(code, otpRow.code_hash);
  if (!valid) {
    await supabaseAdmin
      .from('whatsapp_otp_codes')
      .update({ attempts: otpRow.attempts + 1 })
      .eq('id', otpRow.id);
    return {
      ok: false,
      status: 401,
      error: 'Incorrect code',
      attempts_remaining: Math.max(OTP_MAX_ATTEMPTS - (otpRow.attempts + 1), 0)
    };
  }

  await supabaseAdmin
    .from('whatsapp_otp_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', otpRow.id);

  return { ok: true };
}
