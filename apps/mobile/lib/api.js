import { API_URL } from '@env';
import { supabase } from './supabase';

// Thin wrapper around the Express API: attaches the Supabase access token
// as a bearer token so req.supabase on the server runs under the caller's RLS.
async function request(path, { method = 'GET', body } = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    const err = new Error(payload.error || `Request failed: ${res.status}`);
    err.status = res.status;
    // Some endpoints (e.g. mpin/login) put extra detail alongside `error`
    // (attempts_remaining, locked_until) — surface it on the thrown Error
    // instead of forcing every caller to re-parse the response body.
    Object.assign(err, payload);
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  profile: {
    me: () => request('/api/profile/me'),
    save: (body) => request('/api/profile', { method: 'POST', body }),
    deleteAccount: () => request('/api/profile', { method: 'DELETE' })
  },
  bankDetails: {
    me: () => request('/api/bank-details/me'),
    save: (body) => request('/api/bank-details', { method: 'POST', body })
  },
  reviews: {
    mine: () => request('/api/reviews/mine')
  },
  supportTickets: {
    mine: () => request('/api/support-tickets/mine'),
    create: (body) => request('/api/support-tickets', { method: 'POST', body })
  },
  onboarding: {
    selectRole: (roles) => request('/api/onboarding/select-role', { method: 'POST', body: { roles } })
  },
  kyc: {
    case: () => request('/api/profile/kyc/case'),
    uploadUrl: (document_type, file_name) =>
      request('/api/profile/kyc/documents/upload-url', { method: 'POST', body: { document_type, file_name } }),
    confirmDocument: (body) => request('/api/profile/kyc/documents', { method: 'POST', body }),
    submit: () => request('/api/profile/kyc/submit', { method: 'POST' })
  },
  auth: {
    deviceCheckin: (body) => request('/api/auth/devices/checkin', { method: 'POST', body }),
    logoutAllDevices: () => request('/api/auth/logout-all-devices', { method: 'POST' }),
    mpinSet: (mpin) => request('/api/auth/mpin/set', { method: 'POST', body: { mpin } }),
    mpinLogin: (mpin) => request('/api/auth/mpin/login', { method: 'POST', body: { mpin } }),
    consentsStatus: () => request('/api/auth/consents/status'),
    acceptTerms: () => request('/api/auth/accept-terms', { method: 'POST' }),
    whatsappSendOtp: (phone) => request('/api/auth/whatsapp/send-otp', { method: 'POST', body: { phone } }),
    whatsappVerifyOtp: (phone, code) =>
      request('/api/auth/whatsapp/verify-otp', { method: 'POST', body: { phone, code } })
  },
  loads: {
    list: (params = {}) => {
      const defined = Object.fromEntries(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null)
      );
      const qs = new URLSearchParams(defined).toString();
      return request(`/api/loads${qs ? `?${qs}` : ''}`);
    },
    mine: () => request('/api/loads?mine=true'),
    create: (body) => request('/api/loads', { method: 'POST', body })
  },
  loadLikes: {
    mine: () => request('/api/load-likes/mine'),
    like: (body) => request('/api/load-likes', { method: 'POST', body }),
    unlike: (id) => request(`/api/load-likes/${id}`, { method: 'DELETE' })
  }
};
