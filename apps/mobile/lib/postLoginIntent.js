// Where to send the user right after they finish signing in, set by an
// entry point tapped while signed out (e.g. LandingScreen's "I am a vehicle
// owner" button) so intent survives the sign-in round trip. Plain module
// state is enough — the whole round trip (tap -> AuthChoice -> sign in ->
// AuthGate switches to the authenticated tree) happens within one JS
// session, even for the OAuth deep-link case.
let pendingIntent = null;

export function setPostLoginIntent(intent) {
  pendingIntent = intent;
}

export function consumePostLoginIntent() {
  const intent = pendingIntent;
  pendingIntent = null;
  return intent;
}

// Non-destructive read for callers that just want to react to the intent
// (e.g. preselecting a role on the profile-setup form) without stopping it
// from also being consumed later by the screen that actually redirects.
export function peekPostLoginIntent() {
  return pendingIntent;
}
