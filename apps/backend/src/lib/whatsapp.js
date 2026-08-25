const GRAPH_API_VERSION = 'v19.0';

// Sends the approved AUTHENTICATION-category template (WHATSAPP_OTP_TEMPLATE_NAME,
// e.g. "load24_whatsapp_otp") with the code filled into both the body's
// {{1}} and the "Copy Code" button's {{1}}. Meta requires a pre-approved
// template for OTPs sent outside a user-initiated 24h chat window — plain
// text messages are rejected.
export async function sendWhatsAppOtp(phoneE164, code) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phoneE164.replace('+', ''),
      type: 'template',
      template: {
        name: process.env.WHATSAPP_OTP_TEMPLATE_NAME,
        language: { code: process.env.WHATSAPP_OTP_TEMPLATE_LANG },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] }
        ]
      }
    })
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error?.message || `WhatsApp send failed: ${res.status}`);
  }
  return payload;
}

// Sends the approved UTILITY-category template (WHATSAPP_LOAD_ALERT_TEMPLATE_NAME)
// telling a truck owner a load was found near their posted-available truck.
// Same reasoning as sendWhatsAppOtp: this fires outside any user-initiated
// 24h chat window, so it must be a pre-approved template, not free text.
// Positional {{1}}/{{2}} body variables, not Meta's named-variable format —
// this account's WhatsApp Manager rejects named variables outright (see
// scripts/create-whatsapp-load-alert-template.mjs and
// sendWhatsAppLoadBroadcast's identical note below), so {{1}}=material_type,
// {{2}}=city in that order; the send call has to match — no parameter_name,
// just positional array order.
export async function sendWhatsAppLoadAlert(phoneE164, { material, city }) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phoneE164.replace('+', ''),
      type: 'template',
      template: {
        name: process.env.WHATSAPP_LOAD_ALERT_TEMPLATE_NAME,
        language: { code: process.env.WHATSAPP_LOAD_ALERT_TEMPLATE_LANG },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: material || 'A load' },
              { type: 'text', text: city || 'your area' }
            ]
          }
        ]
      }
    })
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error?.message || `WhatsApp send failed: ${res.status}`);
  }
  return payload;
}

// Sends the approved UTILITY-category interactive template
// (WHATSAPP_LOAD_BROADCAST_TEMPLATE_NAME) that starts the "Smart Load
// Broadcast" flow — routes/loads.js's notifyNearbyTruckOwners calls this for
// each matched, verified owner. The template's two buttons ("View Load" /
// "Bid") are Visit-Website URL buttons configured in Meta Business Manager
// with a static base (https://load24.in/loads/) and one dynamic {{1}}
// suffix each — both buttons open the same PlaceBidScreen in the app (an
// Android App Link; see AndroidManifest.xml + App.jsx's deep-link handling),
// there's no separate webhook step the way a Quick Reply button would need.
//
// Positional {{1}}..{{5}} body variables, not Meta's newer named-variable
// format (unlike sendWhatsAppLoadAlert's material_type/city) — WhatsApp
// Manager's template editor rejected named variables outright ("Variable
// parameters must be whole numbers with two sets of curly brackets") for
// this account, so the approved template uses {{1}}=route, {{2}}=vehicle_type,
// {{3}}=tonnage, {{4}}=pickup, {{5}}=freight in that order, and the send
// call has to match: no parameter_name, just positional array order.
export async function sendWhatsAppLoadBroadcast(phoneE164, { loadId, route, vehicleType, tonnage, pickup, freight }) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phoneE164.replace('+', ''),
      type: 'template',
      template: {
        name: process.env.WHATSAPP_LOAD_BROADCAST_TEMPLATE_NAME,
        language: { code: process.env.WHATSAPP_LOAD_BROADCAST_TEMPLATE_LANG },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: route || 'a route near you' },
              { type: 'text', text: vehicleType || 'Any' },
              { type: 'text', text: String(tonnage ?? '-') },
              { type: 'text', text: pickup || 'To be confirmed' },
              { type: 'text', text: String(freight ?? '-') }
            ]
          },
          // index '0' = the "View Load" button, index '1' = "Bid" — both
          // buttons' dynamic URL suffix in the template is just {{1}}, and
          // both get the same load id here since both open the same screen.
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: String(loadId) }] },
          { type: 'button', sub_type: 'url', index: '1', parameters: [{ type: 'text', text: String(loadId) }] }
        ]
      }
    })
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error?.message || `WhatsApp send failed: ${res.status}`);
  }
  return payload;
}
