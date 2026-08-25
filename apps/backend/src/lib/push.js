import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { supabaseAdmin } from './supabase.js';

// Lazily initializes the Firebase Admin SDK from FIREBASE_SERVICE_ACCOUNT
// (the project's service-account JSON, base64-encoded — see .env.example)
// the first time a push actually needs to go out, rather than at import
// time. Most local/dev environments won't have this configured yet; failing
// to even import this module would take down everything that imports
// notify.js along with it, so an absent env var is a silent no-op here, not
// a crash.
let messaging = null;
function getMessagingClient() {
  if (messaging) return messaging;
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!encoded) return null;

  if (!getApps().length) {
    const serviceAccount = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    initializeApp({ credential: cert(serviceAccount) });
  }
  messaging = getMessaging();
  return messaging;
}

function isUnregisteredError(err) {
  return (
    err?.code === 'messaging/registration-token-not-registered' ||
    err?.code === 'messaging/invalid-registration-token' ||
    err?.code === 'messaging/invalid-argument'
  );
}

// Pushes to every device this user is currently registered on (see
// user_devices.push_token, written by routes/auth.ts's /devices/checkin —
// the one client call already made on every login). Best-effort and silent
// throughout: this is called from notify.js right after an in-app
// notification is created, and a push failure (Firebase not configured, no
// registered device, a dead token, a network hiccup) must never surface
// back to whatever triggered that notification.
export async function sendPushToUser(userId, { title, body, data }) {
  if (!userId) return;
  const client = getMessagingClient();
  if (!client) return;

  const { data: devices, error } = await supabaseAdmin
    .from('user_devices')
    .select('id, push_token')
    .eq('user_id', userId)
    .not('push_token', 'is', null);
  if (error) return console.error('[push] device lookup failed', error);
  if (!devices?.length) return;

  // FCM data payloads are string->string only — every other field type
  // (numbers, the load_id/truck_availability_id uuids, ...) has to be
  // stringified, same as the WhatsApp template params in whatsapp.js.
  const stringData = Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [k, String(v)]));

  const response = await client
    .sendEachForMulticast({
      tokens: devices.map((d) => d.push_token),
      notification: { title, body: body ?? undefined },
      data: stringData,
      android: { priority: 'high' }
    })
    .catch((err) => {
      console.error('[push] send failed', err);
      return null;
    });
  if (!response) return;

  // A token FCM reports as no-longer-registered will just fail again on
  // every future notification otherwise — clear it so the next /devices/
  // checkin (which happens on every login) can repopulate it fresh. Clears
  // the column rather than deleting the row: the row still carries this
  // device's login/session history (see auth.ts's suspicious-login check).
  const staleIds = response.responses
    .map((r, i) => (!r.success && isUnregisteredError(r.error) ? devices[i].id : null))
    .filter(Boolean);
  if (staleIds.length) {
    const { error: pruneError } = await supabaseAdmin.from('user_devices').update({ push_token: null }).in('id', staleIds);
    if (pruneError) console.error('[push] failed to prune stale tokens', pruneError);
  }
}
