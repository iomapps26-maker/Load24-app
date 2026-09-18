import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const maybeSingleMock = vi.fn();
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));
const getOrAssignSalesContactMock = vi.fn();

vi.mock('../lib/supabase.js', () => ({
  supabaseAdmin: { from: (...args) => fromMock(...args) }
}));

vi.mock('../lib/contactAssignment.js', () => ({
  getOrAssignSalesContact: (...args) => getOrAssignSalesContactMock(...args)
}));

vi.mock('../middleware/rateLimit.js', () => ({
  publicSalesContactLookupRateLimiter: (req, res, next) => next()
}));

const { default: publicSalesContactRouter } = await import('./publicSalesContact.js');

function buildApp() {
  const app = express();
  app.use('/api/public/sales-contact', publicSalesContactRouter);
  return app;
}

beforeEach(() => {
  maybeSingleMock.mockReset();
  getOrAssignSalesContactMock.mockReset();
});

describe('GET /api/public/sales-contact', () => {
  it('400s on a missing/invalid mobile number', async () => {
    const res = await request(buildApp()).get('/api/public/sales-contact').query({ mobile: '123' });
    expect(res.status).toBe(400);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('returns nulls (not a lookup) when no account matches the number', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const res = await request(buildApp()).get('/api/public/sales-contact').query({ mobile: '9876543210' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: null, name: null, phone: null, email: null });
    expect(getOrAssignSalesContactMock).not.toHaveBeenCalled();
  });

  it("returns the matched account's assigned sales contact", async () => {
    maybeSingleMock.mockResolvedValue({ data: { user_id: 'user-1' }, error: null });
    getOrAssignSalesContactMock.mockResolvedValue({ id: 'c1', name: 'Vivek', phone: '9000000003', email: null });
    const res = await request(buildApp()).get('/api/public/sales-contact').query({ mobile: '9876543210' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'c1', name: 'Vivek', phone: '9000000003', email: null });
    expect(getOrAssignSalesContactMock).toHaveBeenCalledWith('user-1');
  });

  it('degrades to nulls (not 500) when assignment fails', async () => {
    maybeSingleMock.mockResolvedValue({ data: { user_id: 'user-1' }, error: null });
    getOrAssignSalesContactMock.mockRejectedValue(new Error('boom'));
    const res = await request(buildApp()).get('/api/public/sales-contact').query({ mobile: '9876543210' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: null, name: null, phone: null, email: null });
  });
});
