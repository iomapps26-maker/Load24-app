// Where to send the user once the authenticated app tree exists, when a
// load deep link (WhatsApp's "View Load"/"Bid" buttons — see App.jsx's
// Linking listener) arrives before that tree is mounted (cold start, or
// tapped while signed out). Same plain-module-state shape as
// postLoginIntent.js — the whole round trip happens within one JS session.
let pendingLoadId = null;

export function setPendingLoadLink(loadId) {
  pendingLoadId = loadId;
}

export function consumePendingLoadLink() {
  const loadId = pendingLoadId;
  pendingLoadId = null;
  return loadId;
}
