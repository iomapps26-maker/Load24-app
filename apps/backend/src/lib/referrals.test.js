import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();
const mockState = { referralCodes: [], referrals: [], userProfiles: [] };

vi.mock('./supabase.js', () => ({
  supabaseAdmin: {
    rpc: (...args) => rpcMock(...args),
    from(table) {
      if (table === 'referral_codes') {
        return {
          select() {
            const filters = [];
            const builder = {
              eq(field, value) {
                filters.push((r) => r[field] === value);
                return builder;
              },
              maybeSingle: () =>
                Promise.resolve({ data: mockState.referralCodes.find((r) => filters.every((f) => f(r))) ?? null, error: null })
            };
            return builder;
          }
        };
      }
      if (table === 'referrals') {
        return {
          select() {
            return {
              eq(field, value) {
                return Promise.resolve({ data: mockState.referrals.filter((r) => r[field] === value), error: null });
              }
            };
          },
          insert(row) {
            if (mockState.referrals.some((r) => r.referred_user_id === row.referred_user_id)) {
              return Promise.resolve({ error: { code: '23505', message: 'duplicate' } });
            }
            mockState.referrals.push(row);
            return Promise.resolve({ error: null });
          }
        };
      }
      if (table === 'user_profiles') {
        return {
          select() {
            const filters = [];
            const builder = {
              in(field, values) {
                filters.push((r) => values.includes(r[field]));
                return builder;
              },
              eq(field, value) {
                filters.push((r) => r[field] === value);
                return Promise.resolve({ data: mockState.userProfiles.filter((r) => filters.every((f) => f(r))), error: null });
              }
            };
            return builder;
          }
        };
      }
      throw new Error(`unexpected table ${table}`);
    }
  }
}));

const {
  getOrCreateReferralCode,
  getOrCreateSalesContactReferralCode,
  recordReferral,
  getReferralStats,
  getSalesContactReferralStats
} = await import('./referrals.js');

beforeEach(() => {
  rpcMock.mockReset();
  mockState.referralCodes = [];
  mockState.referrals = [];
  mockState.userProfiles = [];
});

describe('getOrCreateReferralCode', () => {
  it('calls get_or_create_referral_code with p_user_id and returns the code', async () => {
    rpcMock.mockResolvedValue({ data: 'ABCD2345', error: null });
    const result = await getOrCreateReferralCode('user-1');
    expect(rpcMock).toHaveBeenCalledWith('get_or_create_referral_code', { p_user_id: 'user-1' });
    expect(result).toBe('ABCD2345');
  });

  it('throws on an RPC error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error('boom') });
    await expect(getOrCreateReferralCode('user-1')).rejects.toThrow('boom');
  });
});

describe('getOrCreateSalesContactReferralCode', () => {
  it('calls get_or_create_sales_contact_referral_code with p_sales_contact_id and returns the code', async () => {
    rpcMock.mockResolvedValue({ data: 'WXYZ6789', error: null });
    const result = await getOrCreateSalesContactReferralCode('contact-1');
    expect(rpcMock).toHaveBeenCalledWith('get_or_create_sales_contact_referral_code', { p_sales_contact_id: 'contact-1' });
    expect(result).toBe('WXYZ6789');
  });

  it('throws on an RPC error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error('boom') });
    await expect(getOrCreateSalesContactReferralCode('contact-1')).rejects.toThrow('boom');
  });
});

describe('recordReferral', () => {
  it('attributes the referred user to the code owner', async () => {
    mockState.referralCodes = [{ user_id: 'referrer-1', code: 'ABCD2345' }];
    const result = await recordReferral('new-user', 'abcd2345');
    expect(result).toBe('referrer-1');
    expect(mockState.referrals).toEqual([
      { referrer_user_id: 'referrer-1', referrer_sales_contact_id: null, referred_user_id: 'new-user', code_used: 'ABCD2345' }
    ]);
  });

  it('attributes the referred user to a sales contact when the code belongs to one', async () => {
    mockState.referralCodes = [{ sales_contact_id: 'contact-1', code: 'WXYZ6789' }];
    const result = await recordReferral('new-user', 'wxyz6789');
    expect(result).toBe('contact-1');
    expect(mockState.referrals).toEqual([
      { referrer_user_id: null, referrer_sales_contact_id: 'contact-1', referred_user_id: 'new-user', code_used: 'WXYZ6789' }
    ]);
  });

  it('returns null for an unknown code, without throwing', async () => {
    const result = await recordReferral('new-user', 'NOPE0000');
    expect(result).toBeNull();
    expect(mockState.referrals).toEqual([]);
  });

  it('returns null and records nothing for a self-referral', async () => {
    mockState.referralCodes = [{ user_id: 'user-1', code: 'ABCD2345' }];
    const result = await recordReferral('user-1', 'ABCD2345');
    expect(result).toBeNull();
    expect(mockState.referrals).toEqual([]);
  });

  it('returns null for a user who is already attributed to someone else', async () => {
    mockState.referralCodes = [{ user_id: 'referrer-1', code: 'ABCD2345' }];
    mockState.referrals = [{ referrer_user_id: 'someone-else', referred_user_id: 'new-user', code_used: 'OLDCODE1' }];
    const result = await recordReferral('new-user', 'ABCD2345');
    expect(result).toBeNull();
    expect(mockState.referrals).toHaveLength(1);
  });

  it('returns null for an empty/missing code without querying', async () => {
    expect(await recordReferral('new-user', '')).toBeNull();
    expect(await recordReferral('new-user', null)).toBeNull();
    expect(await recordReferral('new-user', '   ')).toBeNull();
  });
});

describe('getReferralStats', () => {
  it('returns the code with zero counts when nobody has been referred yet', async () => {
    rpcMock.mockResolvedValue({ data: 'ABCD2345', error: null });
    const result = await getReferralStats('user-1');
    expect(result).toEqual({ code: 'ABCD2345', total_referred: 0, verified_count: 0 });
  });

  it('counts total referrals and only the ones whose kyc_status is verified', async () => {
    rpcMock.mockResolvedValue({ data: 'ABCD2345', error: null });
    mockState.referrals = [
      { referrer_user_id: 'user-1', referred_user_id: 'ref-a' },
      { referrer_user_id: 'user-1', referred_user_id: 'ref-b' },
      { referrer_user_id: 'user-1', referred_user_id: 'ref-c' }
    ];
    mockState.userProfiles = [
      { user_id: 'ref-a', kyc_status: 'verified' },
      { user_id: 'ref-b', kyc_status: 'pending' },
      { user_id: 'ref-c', kyc_status: 'verified' }
    ];
    const result = await getReferralStats('user-1');
    expect(result).toEqual({ code: 'ABCD2345', total_referred: 3, verified_count: 2 });
  });
});

describe('getSalesContactReferralStats', () => {
  it('returns the code with zero counts when nobody has been referred yet', async () => {
    rpcMock.mockResolvedValue({ data: 'WXYZ6789', error: null });
    const result = await getSalesContactReferralStats('contact-1');
    expect(result).toEqual({ code: 'WXYZ6789', total_referred: 0, verified_count: 0 });
  });

  it('counts only referrals attributed to this sales contact, not to app-user referrers', async () => {
    rpcMock.mockResolvedValue({ data: 'WXYZ6789', error: null });
    mockState.referrals = [
      { referrer_sales_contact_id: 'contact-1', referred_user_id: 'ref-a' },
      { referrer_sales_contact_id: 'contact-1', referred_user_id: 'ref-b' },
      { referrer_user_id: 'some-app-user', referred_user_id: 'ref-c' }
    ];
    mockState.userProfiles = [
      { user_id: 'ref-a', kyc_status: 'verified' },
      { user_id: 'ref-b', kyc_status: 'pending' }
    ];
    const result = await getSalesContactReferralStats('contact-1');
    expect(result).toEqual({ code: 'WXYZ6789', total_referred: 2, verified_count: 1 });
  });
});
