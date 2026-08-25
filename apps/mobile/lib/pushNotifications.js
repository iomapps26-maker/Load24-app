import { Platform } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import notifee, { AndroidImportance } from '@notifee/react-native';
import { api } from './api';
import { getDeviceId, getDeviceInfo } from './device';
import { navigate } from './navigationRef';
import { navigateForNotification } from './notificationRouting';
import { setPendingNotification } from './pendingNotification';

// Must match AndroidManifest.xml's default_notification_channel_id
// meta-data — that's what Android auto-displays a background/killed-state
// push into; this is what makes the channel actually exist to display into.
const DEFAULT_CHANNEL_ID = 'default';

// Idempotent (creating a channel with an existing id just updates it, never
// duplicates) — safe to call on every app start. Needs to have run at least
// once before Android tries to auto-display a background/killed-state push,
// so App.jsx calls this unconditionally on mount, not gated on sign-in.
export async function ensureNotificationChannel() {
  if (Platform.OS !== 'android') return;
  await notifee.createChannel({ id: DEFAULT_CHANNEL_ID, name: 'Load24', importance: AndroidImportance.HIGH });
}

// Asks for POST_NOTIFICATIONS (Android 13+ only — a no-op on older versions,
// where notification permission is implicit at install time) and, if
// granted, fetches this device's FCM token and registers it against the
// current session via the same /devices/checkin call AuthContext.js already
// makes on every sign-in (see routes/auth.ts) — best-effort throughout,
// same as that call: a failure here must never block sign-in.
export async function registerPushToken() {
  try {
    const authStatus = await messaging().requestPermission();
    const granted =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED || authStatus === messaging.AuthorizationStatus.PROVISIONAL;
    if (!granted) return;

    const token = await messaging().getToken();
    const device_id = await getDeviceId();
    await api.auth.deviceCheckin({ device_id, device_info: getDeviceInfo(), push_token: token });
  } catch {
    // best-effort — Play Services unavailable, permission dialog dismissed,
    // a flaky token fetch, ... none of it should surface to the caller.
  }
}

// Wires up the three things that only make sense once, for the app's whole
// lifetime, not per-screen: re-registering the token when it rotates (FCM
// can reissue one at any time), displaying a foreground push ourselves
// (Android auto-displays a "notification"-payload push into the system
// tray for a backgrounded/killed app, but never for a foreground one —
// onMessage is the only signal we get for that case, so notifee.
// displayNotification does the half FCM won't), and routing a tap to the
// right screen. Call once from App.jsx; returns an unsubscribe.
export function subscribeToPushNotifications() {
  const unsubscribeRefresh = messaging().onTokenRefresh(() => {
    registerPushToken();
  });

  const unsubscribeForeground = messaging().onMessage(async (remoteMessage) => {
    const { notification, data } = remoteMessage;
    if (!notification) return;
    await notifee.displayNotification({
      title: notification.title,
      body: notification.body,
      data,
      // smallIcon omitted — notifee falls back to the app's own launcher
      // icon automatically, same asset AndroidManifest.xml's
      // default_notification_channel_id meta-data comment already notes as
      // a cosmetic (not functional) gap pending a dedicated monochrome icon.
      android: { channelId: DEFAULT_CHANNEL_ID, pressAction: { id: 'default' } }
    });
  });

  // Tapped while backgrounded (not killed) — the navigation container is
  // already mounted and past AuthGate's loading/auth gate by definition
  // (the user was already using the app before backgrounding it), so this
  // navigates straight away rather than going through the pending-queue
  // App.jsx uses for the cold-start case below.
  const unsubscribeOpened = messaging().onNotificationOpenedApp((remoteMessage) => {
    const { data } = remoteMessage;
    if (data?.type) navigateForNotification({ navigate }, { type: data.type, data });
  });

  // Tapped from a killed state — this resolves during initial app startup,
  // possibly before AuthGate's Stack.Navigator (and therefore the screen
  // being routed to) even exists yet, so it's queued the same way
  // App.jsx's WhatsApp-deep-link handling queues via pendingLoadLink — see
  // App.jsx's "consume pending notification" effect.
  messaging()
    .getInitialNotification()
    .then((remoteMessage) => {
      const data = remoteMessage?.data;
      if (data?.type) setPendingNotification({ type: data.type, data });
    });

  return () => {
    unsubscribeRefresh();
    unsubscribeForeground();
    unsubscribeOpened();
  };
}
