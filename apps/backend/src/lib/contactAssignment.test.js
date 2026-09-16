import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();

vi.mock('./supabase.js', () => ({
  supabaseAdmin: { rpc: (...args) => rpcMock(...args) }
}));

const { getOrAssignSupportContact, getOrAssignSalesContact } = await import('./contactAssignment.js');

beforeEach(() => {
  rpcMock.mockReset();
});

describe('getOrAssignSupportContact', () => {
  it('calls assign_support_contact with p_user_id and unwraps the first row', async () => {
    rpcMock.mockResolvedValue({ data: [{ id: 'c1', name: 'Asha', phone: '9000000001', email: null }], error: null });
    const result = await getOrAssignSupportContact('user-1');
    expect(rpcMock).toHaveBeenCalledWith('assign_support_contact', { p_user_id: 'user-1' });
    expect(result).toEqual({ id: 'c1', name: 'Asha', phone: '9000000001', email: null });
  });

  it('returns null when no rows come back (empty active roster)', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    expect(await getOrAssignSupportContact('user-1')).toBeNull();
  });

  it('throws on an RPC error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error('boom') });
    await expect(getOrAssignSupportContact('user-1')).rejects.toThrow('boom');
  });
});

describe('getOrAssignSalesContact', () => {
  it('calls assign_sales_contact with p_user_id and unwraps the first row', async () => {
    rpcMock.mockResolvedValue({ data: [{ id: 'c2', name: 'Vivek', phone: '9000000003', email: null }], error: null });
    const result = await getOrAssignSalesContact('user-2');
    expect(rpcMock).toHaveBeenCalledWith('assign_sales_contact', { p_user_id: 'user-2' });
    expect(result).toEqual({ id: 'c2', name: 'Vivek', phone: '9000000003', email: null });
  });

  it('returns null when no rows come back (empty active roster)', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    expect(await getOrAssignSalesContact('user-2')).toBeNull();
  });

  it('throws on an RPC error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error('boom') });
    await expect(getOrAssignSalesContact('user-2')).rejects.toThrow('boom');
  });
});
