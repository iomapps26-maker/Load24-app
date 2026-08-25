// One-off script to submit the "Smart Load Broadcast" WhatsApp template
// (routes/loads.js's sendWhatsAppLoadBroadcast) for Meta approval — via the
// Graph API directly rather than clicking through WhatsApp Manager, so the
// body's variables and button URLs are guaranteed to land exactly as this
// codebase expects, with no UI-driven typos. Approval itself still has to
// happen on Meta's side (check status in WhatsApp Manager > Message
// Templates) — this only submits it.
//
// Usage:
//   node scripts/create-whatsapp-load-broadcast-template.mjs
//
// Run from apps/backend/ so dotenv picks up .env (needs WHATSAPP_ACCESS_TOKEN
// + WHATSAPP_BUSINESS_ACCOUNT_ID — the same two already used for the
// load24_whatsapp_otp / load24_load_nearby_alert templates).
import 'dotenv/config';

const GRAPH_API_VERSION = 'v19.0';
const TEMPLATE_NAME = process.env.WHATSAPP_LOAD_BROADCAST_TEMPLATE_NAME || 'load24_load_broadcast';
const TEMPLATE_LANG = process.env.WHATSAPP_LOAD_BROADCAST_TEMPLATE_LANG || 'hi';

const { WHATSAPP_ACCESS_TOKEN, WHATSAPP_BUSINESS_ACCOUNT_ID } = process.env;
if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_BUSINESS_ACCOUNT_ID) {
  console.error('Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_BUSINESS_ACCOUNT_ID in apps/backend/.env');
  process.exit(1);
}

// Positional {{1}}..{{5}} variables, not Meta's named-variable format —
// WhatsApp Manager's template editor rejects named variables outright for
// this account ("Variable parameters must be whole numbers with two sets
// of curly brackets"), so this matches what the UI actually accepts:
// {{1}}=route, {{2}}=vehicle_type, {{3}}=tonnage, {{4}}=pickup, {{5}}=freight.
// lib/whatsapp.js's sendWhatsAppLoadBroadcast sends body parameters in this
// same order — if you change the order or count here, change it there too.
//
// The body also needs enough surrounding static text: Meta rejects a
// template with "too many variables for its length" (5 variables against
// almost no fixed wording doesn't pass) and separately rejects a variable
// sitting at the very start or end of the body — hence the leading and
// trailing sentences below, not just the bare field labels.
//
// Deliberately neutral wording, no emoji, no "NEW ... AVAILABLE" excited
// framing — Meta's automated category check flagged an earlier version of
// this copy as reading like Marketing rather than Utility ("Category does
// not match"). This is genuinely Utility (it's a status update tied to the
// recipient's own already-active truck-availability posting, not cold
// outreach), so the fix is wording it that way — framed as a match against
// their own listing — rather than switching category.
//
// Both buttons are Visit-Website URL buttons with a static base
// (https://load24.in/loads/) and one dynamic {{1}} suffix each — the actual
// load id, supplied per-message by sendWhatsAppLoadBroadcast's two button
// components (index '0' = View Load, index '1' = Bid; both get the same id
// since both open the same in-app screen, PlaceBidScreen, via the Android
// App Link declared in AndroidManifest.xml). This needs load24.in serving
// https://load24.in/.well-known/assetlinks.json for Android to open the app
// directly instead of just a browser — see the App Links setup notes
// wherever this script's output was shared.
const body = {
  name: TEMPLATE_NAME,
  language: TEMPLATE_LANG,
  category: 'UTILITY',
  components: [
    { type: 'HEADER', format: 'TEXT', text: 'Load Match Update – Load24.in' },
    {
      type: 'BODY',
      text: 'A load matching your registered vehicle\'s current availability has been found.\n\nRoute: {{1}}\nVehicle required: {{2}}\nLoad weight: {{3}} Ton\nPickup time: {{4}}\nFreight offered: ₹{{5}}\n\nView the full details or place your bid using the options below.',
      example: {
        body_text: [['Delhi → Mumbai', '32 FT', '18', 'Today, 6 PM', '45,000']]
      }
    },
    { type: 'FOOTER', text: 'Load24.in – Load & Vehicle Exchange' },
    {
      type: 'BUTTONS',
      buttons: [
        { type: 'URL', text: 'View Load', url: 'https://load24.in/loads/{{1}}', example: ['b3e1a7d0-0000-4000-8000-000000000000'] },
        { type: 'URL', text: 'Bid', url: 'https://load24.in/loads/{{1}}', example: ['b3e1a7d0-0000-4000-8000-000000000000'] }
      ]
    }
  ]
};

async function main() {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error('Template submission failed:', JSON.stringify(payload, null, 2));
    process.exit(1);
  }

  console.log(`Submitted '${TEMPLATE_NAME}' (id ${payload.id}) — status: ${payload.status}`);
  console.log('Check approval progress in Meta Business Manager > WhatsApp Manager > Message Templates.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
