import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockAdminState = { bookingsRows: [], lookupError: null, updates: [], updateError: null, statusFilters: [], isColumns: [] };

vi.mock('./supabase.js', () => ({
  supabaseAdmin: {
    from(table) {
      if (table !== 'bookings') throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            in(field, values) {
              mockAdminState.statusFilters.push({ field, values });
              return {
                is: (column) => {
                  mockAdminState.isColumns.push(column);
                  return Promise.resolve({ data: mockAdminState.bookingsRows, error: mockAdminState.lookupError });
                }
              };
            }
          };
        },
        update(fields) {
          return {
            eq: (field, value) => {
              mockAdminState.updates.push({ fields, [field]: value });
              return Promise.resolve({ error: mockAdminState.updateError });
            }
          };
        }
      };
    }
  }
}));

const mockNotifyState = { calls: [] };
vi.mock('./notify.js', () => ({
  notifyEmail: (email, event) => {
    mockNotifyState.calls.push({ email, event });
    return Promise.resolve();
  }
}));

const { sendLoadingReminders } = await import('./loadingReminders.js');

function booking(overrides = {}) {
  return {
    id: 'bk-1',
    load_id: 'load-1',
    poster_email: 'poster@x.com',
    accepter_email: 'accepter@x.com',
    loads: { loading_date: '2026-01-10', loading_time: '10:00' },
    ...overrides
  };
}

describe('sendLoadingReminders', () => {
  beforeEach(() => {
    mockAdminState.bookingsRows = [];
    mockAdminState.lookupError = null;
    mockAdminState.updates = [];
    mockAdminState.updateError = null;
    mockAdminState.statusFilters = [];
    mockAdminState.isColumns = [];
    mockNotifyState.calls = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('queries only confirmed/in_transit bookings, once per reminder column', async () => {
    await sendLoadingReminders();
    expect(mockAdminState.statusFilters).toEqual([
      { field: 'status', values: ['confirmed', 'in_transit'] },
      { field: 'status', values: ['confirmed', 'in_transit'] },
      { field: 'status', values: ['confirmed', 'in_transit'] }
    ]);
    expect(mockAdminState.isColumns).toEqual([
      'loading_reminder_1h_sent_at',
      'loading_reminder_20m_sent_at',
      'loading_time_notified_at'
    ]);
  });

  it('notifies both parties and marks the row once the loading instant is reached', async () => {
    // loading instant = 2026-01-10T10:00 IST — set "now" to exactly that.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-10T04:30:00Z')); // 10:00 IST
    mockAdminState.bookingsRows = [booking()];

    await sendLoadingReminders();

    // All three reminders (1h-before, 20m-before, reached) are past-due at
    // the exact loading instant, each notifying poster + accepter.
    expect(mockNotifyState.calls).toHaveLength(6);
    expect(mockNotifyState.calls.map((c) => c.event.type)).toEqual([
      'loading_reminder_1h', 'loading_reminder_1h',
      'loading_reminder_20m', 'loading_reminder_20m',
      'loading_time_reached', 'loading_time_reached'
    ]);
    expect(mockNotifyState.calls[0]).toEqual({
      email: 'poster@x.com',
      event: {
        type: 'loading_reminder_1h',
        title: 'Loading in 1 hour',
        body: 'The scheduled loading time for your trip is coming up in about an hour.',
        data: { load_id: 'load-1', booking_id: 'bk-1' }
      }
    });

    expect(mockAdminState.updates).toEqual([
      { fields: { loading_reminder_1h_sent_at: expect.any(String) }, id: 'bk-1' },
      { fields: { loading_reminder_20m_sent_at: expect.any(String) }, id: 'bk-1' },
      { fields: { loading_time_notified_at: expect.any(String) }, id: 'bk-1' }
    ]);
  });

  it('does not fire a reminder before it is due', async () => {
    // 45 minutes before loading — the 1h-before window is open but the
    // 20m-before and reached windows are not yet.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-10T03:45:00Z')); // 09:15 IST, instant is 10:00 IST
    mockAdminState.bookingsRows = [booking()];

    await sendLoadingReminders();

    expect(mockNotifyState.calls.map((c) => c.event.type)).toEqual(['loading_reminder_1h', 'loading_reminder_1h']);
    expect(mockAdminState.updates).toHaveLength(1);
  });

  it('skips a booking whose loading_time is not a parseable HH:MM (pre-TimeField free text)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
    mockAdminState.bookingsRows = [booking({ loads: { loading_date: '2026-01-10', loading_time: 'morning' } })];

    await sendLoadingReminders();

    expect(mockNotifyState.calls).toHaveLength(0);
    expect(mockAdminState.updates).toHaveLength(0);
  });

  it('never throws when the lookup fails', async () => {
    mockAdminState.lookupError = { message: 'boom' };
    mockAdminState.bookingsRows = null;

    await expect(sendLoadingReminders()).resolves.toBeUndefined();
    expect(mockNotifyState.calls).toHaveLength(0);
  });
});
