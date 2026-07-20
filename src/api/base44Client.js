import { createClient } from '@supabase/supabase-js';

// Base44 was replaced with Supabase (see MIGRATION.md). This client keeps the
// same `base44.auth` / `base44.entities.*` shape the rest of the app already
// calls, so pages didn't need to be touched one-by-one. Only UserProfile,
// Load and LoadLike have a real Postgres table + RLS policy (Backend/sql/001_init.sql);
// every other entity, plus functions/integrations/agents, is a stub until its
// own table + Express route is built, per MIGRATION.md's "repeating this
// pattern" section.

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
});

/** @param {string} path @param {{ method?: string, body?: any }} [options] */
async function apiRequest(path, { method = 'GET', body } = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${apiUrl}${path}`, {
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

// Base44 entities used '-created_date'-style sort strings; Postgres columns
// here are 'created_at'/'updated_at'.
const SORT_FIELD_ALIASES = { created_date: 'created_at', updated_date: 'updated_at' };

function parseSort(sort) {
  if (!sort) return null;
  const descending = sort.startsWith('-');
  const field = descending ? sort.slice(1) : sort;
  return { column: SORT_FIELD_ALIASES[field] || field, ascending: !descending };
}

function makeSupabaseEntity(table) {
  const runQuery = async (query, sort, limit) => {
    let q = supabase.from(table).select('*');
    if (query && Object.keys(query).length) q = q.match(query);
    const parsedSort = parseSort(sort);
    if (parsedSort) q = q.order(parsedSort.column, { ascending: parsedSort.ascending });
    if (limit) q = q.limit(limit);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data;
  };

  return {
    list: (sort, limit) => runQuery(null, sort, limit),
    filter: (query, sort, limit) => runQuery(query, sort, limit),
    get: async (id) => {
      const { data, error } = await supabase.from(table).select('*').eq('id', id).single();
      if (error) throw new Error(error.message);
      return data;
    },
    create: async (payload) => {
      const { data, error } = await supabase.from(table).insert(payload).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    bulkCreate: async (rows) => {
      const { data, error } = await supabase.from(table).insert(rows).select();
      if (error) throw new Error(error.message);
      return data;
    },
    update: async (id, payload) => {
      const { data, error } = await supabase.from(table).update(payload).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    delete: async (id) => {
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) throw new Error(error.message);
      return true;
    }
  };
}

function stubMessage(label) {
  const message = `${label} has no Supabase backend yet (Base44 migration in progress — see MIGRATION.md)`;
  console.warn(`[base44Client] ${message}`);
  return message;
}

function notImplemented(label) {
  return async () => { throw new Error(stubMessage(label)); };
}

function makeStubEntity(name) {
  return {
    list: async () => { stubMessage(`entities.${name}.list()`); return []; },
    filter: async () => { stubMessage(`entities.${name}.filter()`); return []; },
    get: notImplemented(`entities.${name}.get()`),
    create: notImplemented(`entities.${name}.create()`),
    bulkCreate: notImplemented(`entities.${name}.bulkCreate()`),
    update: notImplemented(`entities.${name}.update()`),
    delete: notImplemented(`entities.${name}.delete()`)
  };
}

const SUPABASE_BACKED_ENTITIES = {
  UserProfile: 'user_profiles',
  Load: 'loads',
  LoadLike: 'load_likes'
};

const STUB_ENTITY_NAMES = [
  'ChatMessage', 'ChatRoom', 'CompanySettings', 'Deal', 'DepositRequest', 'EmptyTruck', 'Expense',
  'Invoice', 'LoadDocument', 'Notification', 'OnboardingLead', 'PendingNotification',
  'PerformanceAchievement', 'PerformanceTarget', 'Rating', 'Referral', 'SupportTicket', 'TeamMember',
  'Truck', 'TruckLocation', 'TruckMaintenance', 'User', 'Wallet', 'WalletTransaction', 'WithdrawalRequest'
];

const entities = {};
for (const [name, table] of Object.entries(SUPABASE_BACKED_ENTITIES)) {
  entities[name] = makeSupabaseEntity(table);
}
for (const name of STUB_ENTITY_NAMES) {
  entities[name] = makeStubEntity(name);
}

export const base44 = {
  auth: {
    isAuthenticated: async () => {
      const { data } = await supabase.auth.getSession();
      return !!data.session;
    },
    me: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const profile = await apiRequest('/api/profile/me').catch(() => null);
      return { id: session.user.id, email: session.user.email, ...profile };
    },
    updateMe: (payload) => apiRequest('/api/profile', { method: 'POST', body: payload }),
    logout: async (redirectUrl) => {
      await supabase.auth.signOut();
      if (redirectUrl) window.location.href = redirectUrl;
    },
    // Base44's hosted login page is gone; there's no Supabase-native login UI
    // in this web app yet (that only exists in mobile/), so send users to the
    // closest in-app entry point rather than granting access.
    redirectToLogin: () => {
      console.warn(stubMessage('auth.redirectToLogin()'));
      window.location.href = '/MobileLogin';
    }
  },
  entities,
  functions: {
    invoke: notImplemented('functions.invoke()')
  },
  integrations: {
    Core: {
      InvokeLLM: notImplemented('integrations.Core.InvokeLLM()'),
      SendEmail: notImplemented('integrations.Core.SendEmail()'),
      UploadFile: notImplemented('integrations.Core.UploadFile()')
    }
  },
  agents: {
    createConversation: notImplemented('agents.createConversation()'),
    getConversation: notImplemented('agents.getConversation()'),
    listConversations: notImplemented('agents.listConversations()'),
    addMessage: notImplemented('agents.addMessage()'),
    subscribeToConversation: () => { stubMessage('agents.subscribeToConversation()'); return () => {}; }
  },
  appLogs: {
    logUserInApp: async () => {}
  },
  users: {
    inviteUser: notImplemented('users.inviteUser()')
  }
};
