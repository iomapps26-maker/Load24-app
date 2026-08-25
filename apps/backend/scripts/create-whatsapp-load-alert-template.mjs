// One-off script to submit the "Load Nearby Alert" WhatsApp template
// (lib/whatsapp.js's sendWhatsAppLoadAlert, called from
// routes/truckAvailability.js's notifyNearbyLoads) for Meta approval — via
// the Graph API directly rather than clicking through WhatsApp Manager, so
// the body's variables land exactly as this codebase expects, with no
// UI-driven typos. This template never actually got submitted the first
// time around (WHATSAPP_LOAD_ALERT_TEMPLATE_NAME has been referenced in
// code since before the Smart Load Broadcast work, but no matching template
// ever existed in WhatsApp Manager). Approval itself still has to happen on
// Meta's side (check status in WhatsApp Manager > Message Templates) — this
// only submits it.
//
// Usage:
//   node scripts/create-whatsapp-load-alert-template.mjs
//
// Run from apps/backend/ so dotenv picks up .env (needs WHATSAPP_ACCESS_TOKEN
// + WHATSAPP_BUSINESS_ACCOUNT_ID — the same two already used for the
// load24_whatsapp_otp / load24_load_broadcast templates).
import 'dotenv/config';

const GRAPH_API_VERSION = 'v19.0';
const TEMPLATE_NAME = process.env.WHATSAPP_LOAD_ALERT_TEMPLATE_NAME || 'load24_load_nearby_alert';
const TEMPLATE_LANG = process.env.WHATSAPP_LOAD_ALERT_TEMPLATE_LANG || 'hi';

const { WHATSAPP_ACCESS_TOKEN, WHATSAPP_BUSINESS_ACCOUNT_ID } = process.env;
if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_BUSINESS_ACCOUNT_ID) {
  console.error('Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_BUSINESS_ACCOUNT_ID in apps/backend/.env');
  process.exit(1);
}

// Positional {{1}}/{{2}} variables, not Meta's named-variable format —
// see create-whatsapp-load-broadcast-template.mjs's identical note: this
// account's WhatsApp Manager editor rejects named variables outright
// ("Variable parameters must be whole numbers with two sets of curly
// brackets"), so {{1}}=material_type, {{2}}=city in that order.
// lib/whatsapp.js's sendWhatsAppLoadAlert sends body parameters in this
// same order — if you change the order or count here, change it there too.
//
// No BUTTONS component: sendWhatsAppLoadAlert doesn't send any button
// parameters today (unlike sendWhatsAppLoadBroadcast's View Load/Bid pair),
// so a template with buttons here would just show dead buttons Meta expects
// parameters for that this send call never provides. A follow-up could wire
// this to the same deep-link pattern; out of scope for just getting this
// template approved and unblocked.
//
// Deliberately neutral, non-promotional wording, same reasoning as the
// broadcast template's comment — this is a status update tied to the
// recipient's own already-active truck-availability posting, not cold
// outreach, so it reads as genuinely Utility rather than Marketing.
const body = {
  name: TEMPLATE_NAME,
  language: TEMPLATE_LANG,
  category: 'UTILITY',
  components: [
    { type: 'HEADER', format: 'TEXT', text: 'Load Found Near You – Load24.in' },
    {
      type: 'BODY',
      text: 'A load matching your posted truck availability was found nearby.\n\nMaterial: {{1}}\nLocation: {{2}}\n\nOpen the Load24 app to view details and place your bid.',
      example: {
        body_text: [['Cement', 'Pune']]
      }
    },
    { type: 'FOOTER', text: 'Load24.in – Load & Vehicle Exchange' }
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
