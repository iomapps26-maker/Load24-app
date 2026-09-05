import { createContext, useContext, useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { supabase } from './supabase';
import { api } from './api';
import { getDeviceId, getDeviceInfo } from './device';
import { registerPushToken } from './pushNotifications';

const AuthContext = createContext(null);

const REDIRECT_URL = 'load24://auth-callback';

// The OAuth redirect can carry tokens either as a query string (?code=...,
// PKCE flow) or a URL fragment (#access_token=..., implicit flow).
function parseUrlParams(url) {
  const params = {};
  const paramString = url.includes('#') ? url.split('#')[1] : url.split('?')[1];
  if (!paramString) return params;
  for (const pair of paramString.split('&')) {
    const [key, value] = pair.split('=');
    if (key) params[decodeURIComponent(key)] = decodeURIComponent(value || '');
  }
  return params;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setIsLoadingAuth(false);
      // Cold start with an already-persisted session (the common case —
      // sessions outlive any single app open by weeks) skips the SIGNED_IN
      // branch below entirely, so without this, a permission denied/
      // dismissed or a token fetch that failed at the one-time original
      // sign-in would never get retried again for the life of the install.
      // registerPushToken() is idempotent and best-effort (see
      // pushNotifications.js), so re-running it on every cold start is safe.
      if (data.session) registerPushToken();
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      if (event === 'SIGNED_IN' && newSession) {
        getDeviceId()
          .then((device_id) => api.auth.deviceCheckin({ device_id, device_info: getDeviceInfo() }))
          .catch(() => {}); // best-effort; never block sign-in on this
        // Separate call, not folded into the checkin above: fetching an FCM
        // token touches Google Play Services and can be slow or fail (no
        // Play Services, permission dialog dismissed, ...) — isolating it
        // means that never delays or breaks the base device checkin, which
        // suspicious-login detection actually depends on.
        registerPushToken();
      }
    });

    // Catches the browser redirect back into the app after Google sign-in.
    const handleDeepLink = async ({ url }) => {
      if (!url.startsWith(REDIRECT_URL)) return;
      const params = parseUrlParams(url);
      if (params.code) {
        await supabase.auth.exchangeCodeForSession(params.code);
      } else if (params.access_token && params.refresh_token) {
        await supabase.auth.setSession({
          access_token: params.access_token,
          refresh_token: params.refresh_token
        });
      }
    };
    const linkingSubscription = Linking.addEventListener('url', handleDeepLink);
    Linking.getInitialURL().then((url) => { if (url) handleDeepLink({ url }); });

    return () => {
      subscription.subscription.unsubscribe();
      linkingSubscription.remove();
    };
  }, []);

  // Sends a one-time passcode to email — swap for phone OTP via
  // supabase.auth.signInWithOtp({ phone }) once SMS provider is configured.
  const sendOtp = (email) => supabase.auth.signInWithOtp({ email });

  const verifyOtp = (email, token) =>
    supabase.auth.verifyOtp({ email, token, type: 'email' });

  // Verifies the code from Supabase's "Confirm signup" email against a
  // pending signUpWithPassword() — distinct `type` from the passwordless
  // sign-in OTP above.
  const verifySignupOtp = (email, token) =>
    supabase.auth.verifyOtp({ email, token, type: 'signup' });

  const resendSignupOtp = (email) =>
    supabase.auth.resend({ type: 'signup', email });

  // Opens an OAuth provider's sign-in page in the system browser; the result
  // comes back via the load24://auth-callback deep link handled above.
  const signInWithOAuth = async (provider) => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: REDIRECT_URL, skipBrowserRedirect: true }
    });
    if (error) return { error };
    if (data?.url) await Linking.openURL(data.url);
    return { error: null };
  };

  const signInWithGoogle = () => signInWithOAuth('google');

  // Attaches a Google identity to the *current* session's account instead of
  // signing into a (possibly different) one — the counterpart to
  // signInWithGoogle for a user who's already authenticated (e.g. via phone
  // OTP) and wants Google as an additional sign-in method on the same
  // account. Requires "Allow manual linking" enabled in the Supabase
  // dashboard (Authentication -> Providers -> Advanced); Supabase rejects
  // linkIdentity calls without it.
  const linkGoogleIdentity = async () => {
    const { data, error } = await supabase.auth.linkIdentity({
      provider: 'google',
      options: { redirectTo: REDIRECT_URL, skipBrowserRedirect: true }
    });
    if (error) return { error };
    if (data?.url) await Linking.openURL(data.url);
    return { error: null };
  };

  const signInWithPassword = (email, password) =>
    supabase.auth.signInWithPassword({ email, password });

  const signUpWithPassword = (email, password) =>
    supabase.auth.signUp({ email, password });

  const resetPassword = (email) =>
    supabase.auth.resetPasswordForEmail(email, { redirectTo: REDIRECT_URL });

  const signOut = () => supabase.auth.signOut();

  // WhatsApp OTP login: the backend generates/verifies the code and
  // delivers it via the WhatsApp Cloud API (Supabase Free has no custom
  // "Send SMS" hook to reuse its built-in phone auth), then hands back a
  // magic-link token minted server-side for a phone-derived account. The
  // actual session is still established here, client-side, via Supabase's
  // own verifyOtp — same trust boundary as every other sign-in method, no
  // custom session-forging.
  const sendPhoneOtp = async (phone) => {
    try {
      await api.auth.whatsappSendOtp(phone);
      return { error: null };
    } catch (err) {
      return { error: err };
    }
  };

  const verifyPhoneOtp = async (phone, code) => {
    try {
      const { token_hash } = await api.auth.whatsappVerifyOtp(phone, code);
      return await supabase.auth.verifyOtp({ token_hash, type: 'magiclink' });
    } catch (err) {
      return { error: err };
    }
  };

  // Revokes every device's session, not just this one, then signs out locally.
  const signOutAllDevices = async () => {
    await api.auth.logoutAllDevices();
    await supabase.auth.signOut();
  };

  // Attaches a phone number to the *current* account via a real WhatsApp
  // OTP round-trip (Linked Accounts screen) — the counterpart to
  // sendPhoneOtp/verifyPhoneOtp for a user who's already signed in (e.g. via
  // Google) and wants phone login too. Unlike the sign-in flow, no session
  // is minted here — the backend just attaches the verified phone to the
  // caller's existing session (see /api/auth/link-phone/verify-otp).
  const sendLinkPhoneOtp = async (phone) => {
    try {
      await api.auth.linkPhoneSendOtp(phone);
      return { error: null };
    } catch (err) {
      return { error: err };
    }
  };

  const verifyLinkPhoneOtp = async (phone, code) => {
    try {
      await api.auth.linkPhoneVerifyOtp(phone, code);
      return { error: null };
    } catch (err) {
      return { error: err };
    }
  };

  const getLinkedIdentities = () => api.auth.identities();

  const value = {
    session,
    user: session?.user ?? null,
    isAuthenticated: !!session,
    isLoadingAuth,
    sendOtp,
    verifyOtp,
    verifySignupOtp,
    resendSignupOtp,
    signInWithGoogle,
    linkGoogleIdentity,
    signInWithPassword,
    signUpWithPassword,
    resetPassword,
    signOut,
    signOutAllDevices,
    sendPhoneOtp,
    verifyPhoneOtp,
    sendLinkPhoneOtp,
    verifyLinkPhoneOtp,
    getLinkedIdentities
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
