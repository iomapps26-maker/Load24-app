import { describe, it, expect, beforeEach, vi } from 'vitest';

// firebase-admin is a real SDK construct at import time (and would try to
// actually talk to Google if it weren't mocked), so both of its ESM
// subpaths get stubbed here. sendEachForMulticast's return value is
// controlled per-test via mockState.sendResponse.
const mockState = { sendResponse: { responses: [] }, sendError: null, sendCalls: [] };

vi.mock('firebase-admin/app', () => ({
  getApps: () => [],
  initializeApp: vi.fn(),
  cert: vi.fn((x) => x)
}));

vi.mock('firebase-admin/messaging', () => ({
  getMessaging: () => ({
    sendEachForMulticast: (payload) => {
      mockState.sendCalls.push(payload);
      if (mockState.sendError) return Promise.reject(mockState.sendError);
      return Promise.resolve(mockState.sendResponse);
    }
  })
}));

// supabaseAdmin is a real Supabase client construct at import time, so it's
// mocked here too — push.js only ever touches user_devices.
const mockAdminState = { devices: [], lookupError: null, pruneUpdates: [] };

vi.mock('./supabase.js', () => ({
  supabaseAdmin: {
    from(table) {
      if (table !== 'user_devices') throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            eq() {
              return {
                not: () => Promise.resolve({ data: mockAdminState.devices, error: mockAdminState.lookupError })
              };
            }
          };
        },
        update(fields) {
          return {
            in(field, values) {
              mockAdminState.pruneUpdates.push({ fields, [field]: values });
              return Promise.resolve({ error: null });
            }
          };
        }
      };
    }
  }
}));

const { sendPushToUser } = await import('./push.js');

describe('sendPushToUser', () => {
  beforeEach(() => {
    mockState.sendResponse = { responses: [] };
    mockState.sendError = null;
    mockState.sendCalls = [];
    mockAdminState.devices = [];
    mockAdminState.lookupError = null;
    mockAdminState.pruneUpdates = [];
    delete process.env.FIREBASE_SERVICE_ACCOUNT;
  });

  it('no-ops without throwing when Firebase is not configured', async () => {
    mockAdminState.devices = [{ id: 'd1', push_token: 'tok-1' }];
    await sendPushToUser('user-1', { title: 'Hi', body: 'there' });
    expect(mockState.sendCalls).toHaveLength(0);
  });

  it('no-ops when the user has no registered push tokens', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = Buffer.from('{}').toString('base64');
    mockAdminState.devices = [];
    await sendPushToUser('user-1', { title: 'Hi', body: 'there' });
    expect(mockState.sendCalls).toHaveLength(0);
  });

  it('sends to every registered token with stringified data', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = Buffer.from('{}').toString('base64');
    mockAdminState.devices = [{ id: 'd1', push_token: 'tok-1' }, { id: 'd2', push_token: 'tok-2' }];
    mockState.sendResponse = { responses: [{ success: true }, { success: true }] };

    await sendPushToUser('user-1', { title: 'Load nearby', body: 'Cement, Delhi', data: { load_id: 42 } });

    expect(mockState.sendCalls).toHaveLength(1);
    expect(mockState.sendCalls[0].tokens).toEqual(['tok-1', 'tok-2']);
    expect(mockState.sendCalls[0].notification).toEqual({ title: 'Load nearby', body: 'Cement, Delhi' });
    expect(mockState.sendCalls[0].data).toEqual({ load_id: '42' });
  });

  it('prunes tokens FCM reports as unregistered, leaving valid ones alone', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = Buffer.from('{}').toString('base64');
    mockAdminState.devices = [{ id: 'd1', push_token: 'dead-tok' }, { id: 'd2', push_token: 'live-tok' }];
    mockState.sendResponse = {
      responses: [
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
        { success: true }
      ]
    };

    await sendPushToUser('user-1', { title: 'Hi' });

    expect(mockAdminState.pruneUpdates).toEqual([{ fields: { push_token: null }, id: ['d1'] }]);
  });

  it('never throws when the send itself fails', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = Buffer.from('{}').toString('base64');
    mockAdminState.devices = [{ id: 'd1', push_token: 'tok-1' }];
    mockState.sendError = new Error('network down');

    await expect(sendPushToUser('user-1', { title: 'Hi' })).resolves.toBeUndefined();
  });

  it('never throws when the device lookup fails', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = Buffer.from('{}').toString('base64');
    mockAdminState.lookupError = { message: 'boom' };

    await expect(sendPushToUser('user-1', { title: 'Hi' })).resolves.toBeUndefined();
    expect(mockState.sendCalls).toHaveLength(0);
  });
});
