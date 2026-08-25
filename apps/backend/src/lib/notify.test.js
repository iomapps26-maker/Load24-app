import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockAdminState = { inserts: [], insertError: null, profileRows: [] };

vi.mock('./supabase.js', () => ({
  supabaseAdmin: {
    from(table) {
      if (table === 'notifications') {
        return {
          insert(row) {
            mockAdminState.inserts.push(row);
            return Promise.resolve({ error: mockAdminState.insertError });
          }
        };
      }
      if (table === 'user_profiles') {
        return {
          select() {
            return {
              eq(field, value) {
                return {
                  maybeSingle: () =>
                    Promise.resolve({ data: mockAdminState.profileRows.find((r) => r[field] === value) ?? null, error: null })
                };
              }
            };
          }
        };
      }
      throw new Error(`unexpected table ${table}`);
    }
  }
}));

const mockPushState = { calls: [] };
vi.mock('./push.js', () => ({
  sendPushToUser: (userId, event) => {
    mockPushState.calls.push({ userId, event });
    return Promise.resolve();
  }
}));

const { notifyUser, notifyEmail } = await import('./notify.js');

describe('notifyUser', () => {
  beforeEach(() => {
    mockAdminState.inserts = [];
    mockAdminState.insertError = null;
    mockAdminState.profileRows = [];
    mockPushState.calls = [];
  });

  it('creates the in-app notification and forwards it to sendPushToUser', async () => {
    await notifyUser('user-1', { type: 'load_available_nearby', title: 'Load nearby', body: 'Cement, Delhi', data: { load_id: 'l1' } });

    expect(mockAdminState.inserts).toEqual([
      { user_id: 'user-1', type: 'load_available_nearby', title: 'Load nearby', body: 'Cement, Delhi', data: { load_id: 'l1' } }
    ]);
    expect(mockPushState.calls).toEqual([
      {
        userId: 'user-1',
        event: { title: 'Load nearby', body: 'Cement, Delhi', data: { load_id: 'l1', type: 'load_available_nearby' } }
      }
    ]);
  });

  it('does nothing for a null userId (no row, no push)', async () => {
    await notifyUser(null, { type: 'x', title: 'Hi' });
    expect(mockAdminState.inserts).toHaveLength(0);
    expect(mockPushState.calls).toHaveLength(0);
  });

  it('still attempts the push even when the in-app insert fails', async () => {
    mockAdminState.insertError = { message: 'boom' };
    await notifyUser('user-1', { type: 'x', title: 'Hi' });
    expect(mockPushState.calls).toHaveLength(1);
  });
});

describe('notifyEmail', () => {
  beforeEach(() => {
    mockAdminState.inserts = [];
    mockAdminState.profileRows = [{ user_email: 'poster@x.com', user_id: 'user-2' }];
    mockPushState.calls = [];
  });

  it('resolves the email to a user_id before notifying', async () => {
    await notifyEmail('poster@x.com', { type: 'bid_placed', title: 'New bid' });
    expect(mockAdminState.inserts[0].user_id).toBe('user-2');
    expect(mockPushState.calls[0].userId).toBe('user-2');
  });
});
