import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = {
  profilesByMobile: {} as Record<string, { user_id: string }>,
  profilesByUserId: {} as Record<string, { user_id: string; mobile?: string; mobile_verified?: boolean }>,
  usersById: {} as Record<string, { id: string; email: string; phone?: string }>
};

vi.mock('./supabase.js', () => ({
  supabaseAdmin: {
    from(table: string) {
      if (table === 'user_profiles') {
        return {
          select: () => ({
            eq: (field: string, value: string) => ({
              maybeSingle: async () => {
                if (field === 'mobile') return { data: state.profilesByMobile[value] || null, error: null };
                if (field === 'user_id') return { data: state.profilesByUserId[value] || null, error: null };
                return { data: null, error: null };
              }
            })
          }),
          update: (fields: any) => ({
            eq: async (field: string, value: string) => {
              if (field === 'user_id' && state.profilesByUserId[value]) {
                Object.assign(state.profilesByUserId[value], fields);
              }
              return { error: null };
            }
          })
        };
      }
      if (table === 'auth_link_events') {
        return { insert: async () => ({ error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: state.usersById[id] || null }, error: null }),
        updateUserById: async (id: string, attrs: any) => {
          if (state.usersById[id]) Object.assign(state.usersById[id], attrs);
          return { data: {}, error: null };
        }
      }
    }
  }
}));

const { findAccountOwningPhone, hasRealActivity, linkVerifiedPhoneToUser, clearPhoneFromUser } = await import(
  './identityLinking.js'
);

beforeEach(() => {
  state.profilesByMobile = {};
  state.profilesByUserId = {};
  state.usersById = {};
});

describe('findAccountOwningPhone', () => {
  it('returns null when no profile has this mobile', async () => {
    expect(await findAccountOwningPhone('+919876543210')).toBeNull();
  });

  it('resolves the owning user id and email', async () => {
    state.profilesByMobile['+919876543210'] = { user_id: 'user-1' };
    state.usersById['user-1'] = { id: 'user-1', email: 'real@gmail.com' };

    const result = await findAccountOwningPhone('+919876543210');
    expect(result).toEqual({ userId: 'user-1', authEmail: 'real@gmail.com' });
  });
});

describe('hasRealActivity', () => {
  it('is false when no user_profiles row exists', async () => {
    expect(await hasRealActivity('user-1')).toBe(false);
  });

  it('is true when a user_profiles row exists', async () => {
    state.profilesByUserId['user-1'] = { user_id: 'user-1' };
    expect(await hasRealActivity('user-1')).toBe(true);
  });
});

describe('linkVerifiedPhoneToUser', () => {
  it('sets phone on auth.users and mirrors onto an existing profile', async () => {
    state.usersById['user-1'] = { id: 'user-1', email: 'real@gmail.com' };
    state.profilesByUserId['user-1'] = { user_id: 'user-1' };

    await linkVerifiedPhoneToUser('user-1', '+919876543210');

    expect(state.usersById['user-1'].phone).toBe('+919876543210');
    expect(state.profilesByUserId['user-1'].mobile).toBe('+919876543210');
    expect(state.profilesByUserId['user-1'].mobile_verified).toBe(true);
  });

  it('is a no-op on the profile row when none exists yet', async () => {
    state.usersById['user-1'] = { id: 'user-1', email: 'real@gmail.com' };

    await expect(linkVerifiedPhoneToUser('user-1', '+919876543210')).resolves.toBeUndefined();
    expect(state.usersById['user-1'].phone).toBe('+919876543210');
  });
});

describe('clearPhoneFromUser', () => {
  it('clears the phone on the given account', async () => {
    state.usersById['user-2'] = { id: 'user-2', email: 'wa919876543210@phone.load24.internal', phone: '+919876543210' };

    await clearPhoneFromUser('user-2');

    expect(state.usersById['user-2'].phone).toBe('');
  });
});
