// Where to route the user once the authenticated app tree exists, when a
// push notification is tapped before that tree is mounted (cold start via
// tap — see pushNotifications.js's getInitialNotification handling). Same
// plain-module-state shape as postLoginIntent.js/pendingLoadLink.js — the
// whole round trip happens within one JS session. A tap while the app is
// already running (backgrounded, not killed) skips this entirely and
// navigates immediately instead, since the tree is already there.
let pending = null;

export function setPendingNotification(notification) {
  pending = notification;
}

export function consumePendingNotification() {
  const notification = pending;
  pending = null;
  return notification;
}
