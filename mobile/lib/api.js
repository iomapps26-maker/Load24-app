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
    throw new Error(payload.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  profile: {
    me: () => request('/api/profile/me'),
    save: (body) => request('/api/profile', { method: 'POST', body })
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
