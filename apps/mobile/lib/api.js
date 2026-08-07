import { API_URL } from '@env';
import { supabase } from './supabase';

const REQUEST_TIMEOUT_MS = 20000;

// Render's free tier spins the backend down when idle, so the first request
// after a lull can hang far longer than a normal network call. Without a
// timeout that hang never rejects, so callers (e.g. React Query) sit on
// isLoading forever instead of surfacing an error + retry.
function withTimeout(ms, message) {
  let timer;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

async function getSessionWithTimeout() {
  const { promise, cancel } = withTimeout(REQUEST_TIMEOUT_MS, 'Timed out checking login session');
  try {
    return await Promise.race([supabase.auth.getSession(), promise]);
  } finally {
    cancel();
  }
}

// Thin wrapper around the Express API: attaches the Supabase access token
// as a bearer token so req.supabase on the server runs under the caller's RLS.
async function request(path, { method = 'GET', body } = {}) {
  const { data: { session } } = await getSessionWithTimeout();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out. The server may be waking up — please try again.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

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
  trucks: {
    mine: () => request('/api/trucks'),
    get: (id) => request(`/api/trucks/${id}`),
    create: (body) => request('/api/trucks', { method: 'POST', body }),
    update: (id, body) => request(`/api/trucks/${id}`, { method: 'PATCH', body }),
    remove: (id) => request(`/api/trucks/${id}`, { method: 'DELETE' }),
    uploadUrl: (id, document_type, file_name) =>
      request(`/api/trucks/${id}/documents/upload-url`, { method: 'POST', body: { document_type, file_name } }),
    confirmDocument: (id, body) => request(`/api/trucks/${id}/documents`, { method: 'POST', body })
  },
  truckAvailability: {
    mine: () => request('/api/truck-availability?mine=true'),
    list: (params = {}) => {
      const query = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
      ).toString();
      return request(`/api/truck-availability${query ? `?${query}` : ''}`);
    },
    create: (body) => request('/api/truck-availability', { method: 'POST', body }),
    update: (id, body) => request(`/api/truck-availability/${id}`, { method: 'PATCH', body }),
    remove: (id) => request(`/api/truck-availability/${id}`, { method: 'DELETE' })
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
    saveLocation: (body) => request('/api/profile/kyc/location', { method: 'POST', body }),
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
      request('/api/auth/whatsapp/verify-otp', { method: 'POST', body: { phone, code } }),
    identities: () => request('/api/auth/identities'),
    linkPhoneSendOtp: (phone) => request('/api/auth/link-phone/send-otp', { method: 'POST', body: { phone } }),
    linkPhoneVerifyOtp: (phone, code) =>
      request('/api/auth/link-phone/verify-otp', { method: 'POST', body: { phone, code } })
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
  },
  loadBids: {
    mine: () => request('/api/load-bids/mine'),
    place: (body) => request('/api/load-bids', { method: 'POST', body }),
    forLoad: (loadId) => request(`/api/load-bids/load/${loadId}`),
    tripDetails: (loadId) => request(`/api/load-bids/load/${loadId}/trip-details`),
    approve: (id) => request(`/api/load-bids/${id}/approve`, { method: 'POST' }),
    reject: (id) => request(`/api/load-bids/${id}/reject`, { method: 'POST' })
  },
  wallet: {
    balance: () => request('/api/wallet'),
    transactions: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return request(`/api/wallet/transactions${qs ? `?${qs}` : ''}`);
    },
    addMoney: (amount) => request('/api/wallet/add-money', { method: 'POST', body: { amount } }),
    withdrawalsMine: () => request('/api/wallet/withdrawals/mine'),
    withdraw: (amount) => request('/api/wallet/withdraw', { method: 'POST', body: { amount } }),
    // CSV response, not JSON — can't go through request() above, which
    // always calls res.json().
    statementCsv: async () => {
      const { data: { session } } = await getSessionWithTimeout();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let res;
      try {
        res = await fetch(`${API_URL}/api/wallet/statement`, {
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
          signal: controller.signal
        });
      } catch (err) {
        if (err.name === 'AbortError') {
          throw new Error('Request timed out. The server may be waking up — please try again.');
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) throw new Error(`Failed to fetch statement: ${res.status}`);
      return res.text();
    }
  }
};
