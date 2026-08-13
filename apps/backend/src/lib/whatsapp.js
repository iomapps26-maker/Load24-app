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
// Template uses Meta's named-variable format (required for templates created
// after Meta deprecated positional {{1}}/{{2}} for new templates) — the
// parameter_name values below (material_type, city) must match the variable
// names exactly as approved in Meta Business Manager.
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
              { type: 'text', parameter_name: 'material_type', text: material || 'A load' },
              { type: 'text', parameter_name: 'city', text: city || 'your area' }
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
