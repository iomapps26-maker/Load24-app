// One-off script to send the "load24_registration_invite" MARKETING template
// (lib/whatsapp.js's sendWhatsAppRegistrationInvite) to one or more phone
// numbers — used both for a single test send and, later, for the real
// 2000-contact run by passing more numbers.
//
// Usage (run from apps/backend/ so dotenv picks up .env):
//   node scripts/send-whatsapp-registration-invite.mjs <phone> [name]
//
// <phone> can be a bare 10-digit Indian number (91 is prepended) or a full
// E.164 number (with or without the leading +).
import 'dotenv/config';
import { sendWhatsAppRegistrationInvite } from '../src/lib/whatsapp.js';

const [, , rawPhone, name] = process.argv;

if (!rawPhone) {
  console.error('Usage: node scripts/send-whatsapp-registration-invite.mjs <phone> [name]');
  process.exit(1);
}

const digits = rawPhone.replace(/\D/g, '');
const phoneE164 = digits.length === 10 ? `+91${digits}` : `+${digits}`;

const { WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_REGISTRATION_INVITE_TEMPLATE_NAME } = process.env;
if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_REGISTRATION_INVITE_TEMPLATE_NAME) {
  console.error('Missing WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, or WHATSAPP_REGISTRATION_INVITE_TEMPLATE_NAME in apps/backend/.env');
  process.exit(1);
}

sendWhatsAppRegistrationInvite(phoneE164, name || 'there')
  .then((res) => {
    console.log(`Sent to ${phoneE164}:`, JSON.stringify(res, null, 2));
  })
  .catch((err) => {
    console.error(`Failed to send to ${phoneE164}:`, err.message);
    process.exit(1);
  });
