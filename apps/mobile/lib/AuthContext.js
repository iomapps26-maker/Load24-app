import { createContext, useContext, useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { supabase } from './supabase';
import { api } from './api';
import { getDeviceId, getDeviceInfo } from './device';

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
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      if (event === 'SIGNED_IN' && newSession) {
        getDeviceId()
          .then((device_id) => api.auth.deviceCheckin({ device_id, device_info: getDeviceInfo() }))
          .catch(() => {}); // best-effort; never block sign-in on this
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

  const signInWithPassword = (email, password) =>
    supabase.auth.signInWithPassword({ email, password });

  const signUpWithPassword = (email, password) =>
    supabase.auth.signUp({ email, password });

  const resetPassword = (email) =>
    supabase.auth.resetPasswordForEmail(email, { redirectTo: REDIRECT_URL });

  const signOut = () => supabase.auth.signOut();

  // Revokes every device's session, not just this one, then signs out locally.
  const signOutAllDevices = async () => {
    await api.auth.logoutAllDevices();
    await supabase.auth.signOut();
  };

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
    signInWithPassword,
    signUpWithPassword,
    resetPassword,
    signOut,
    signOutAllDevices
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
