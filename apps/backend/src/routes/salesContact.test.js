import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const getOrAssignSalesContactMock = vi.fn();

vi.mock('../lib/contactAssignment.js', () => ({
  getOrAssignSalesContact: (...args) => getOrAssignSalesContactMock(...args)
}));

const { default: salesContactRouter } = await import('./salesContact.js');

function buildApp(userId = 'user-1') {
  const app = express();
  app.use((req, res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use('/api/sales-contact', salesContactRouter);
  return app;
}

beforeEach(() => {
  getOrAssignSalesContactMock.mockReset();
});

describe('GET /api/sales-contact/mine', () => {
  it("returns the caller's assigned sales contact", async () => {
    getOrAssignSalesContactMock.mockResolvedValue({ id: 'c1', name: 'Vivek', phone: '9000000003', email: null });
    const res = await request(buildApp('user-1')).get('/api/sales-contact/mine');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'c1', name: 'Vivek', phone: '9000000003', email: null });
    expect(getOrAssignSalesContactMock).toHaveBeenCalledWith('user-1');
  });

  it('degrades to nulls (not 500) when the roster is empty', async () => {
    getOrAssignSalesContactMock.mockResolvedValue(null);
    const res = await request(buildApp()).get('/api/sales-contact/mine');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: null, name: null, phone: null, email: null });
  });

  it('degrades to nulls (not 500) when the RPC throws', async () => {
    getOrAssignSalesContactMock.mockRejectedValue(new Error('boom'));
    const res = await request(buildApp()).get('/api/sales-contact/mine');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: null, name: null, phone: null, email: null });
  });
});
