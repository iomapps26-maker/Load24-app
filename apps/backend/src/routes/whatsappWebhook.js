import { Router } from 'express';

// Receives WhatsApp Cloud API webhook callbacks — the only way to see real
// delivery status (sent/delivered/read/failed) for a message, since the
// POST /messages response (see lib/whatsapp.js) only confirms Meta queued
// it, not that it reached the device. Public, no auth: Meta calls this
// directly and authenticates the GET handshake via WHATSAPP_WEBHOOK_VERIFY_TOKEN
// instead. Register this route's full URL (https://<render-host>/api/whatsapp/webhook)
// in Meta App Dashboard > WhatsApp > Configuration > Webhook, with the same
// verify token, subscribed to the "messages" field.
const router = Router();

router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Meta requires a fast 200 regardless of payload contents — respond first,
// process after, and never throw back out to index.js's error handler.
router.post('/', (req, res) => {
  res.sendStatus(200);

  const value = req.body?.entry?.[0]?.changes?.[0]?.value;

  for (const status of value?.statuses || []) {
    const errorSuffix = status.errors ? ` errors=${JSON.stringify(status.errors)}` : '';
    console.log(`[whatsapp webhook] ${status.recipient_id} message ${status.id} -> ${status.status}${errorSuffix}`);
  }

  for (const message of value?.messages || []) {
    console.log(`[whatsapp webhook] inbound message from ${message.from}: ${message.text?.body ?? `<${message.type}>`}`);
  }
});

export default router;
