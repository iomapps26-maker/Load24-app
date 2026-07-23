import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import supportTicketsRouter from './supportTickets.js';

// In-memory stand-in for req.supabase.from('support_tickets')...
function createMockSupabase(seedRows = []) {
  let rows = [...seedRows];

  return {
    _rows: () => rows,
    from(table) {
      if (table !== 'support_tickets') throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            eq(field, value) {
              return {
                order: () =>
                  Promise.resolve({
                    data: rows
                      .filter((r) => r[field] === value)
                      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
                    error: null
                  })
              };
            }
          };
        },
        insert(row) {
          const created = { id: `ticket-${rows.length + 1}`, status: 'open', created_at: new Date().toISOString(), ...row };
          rows.push(created);
          return {
            select() {
              return { single: () => Promise.resolve({ data: created, error: null }) };
            }
          };
        }
      };
    }
  };
}

function buildApp(mockSupabase, userId = 'user-1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    req.supabase = mockSupabase;
    next();
  });
  app.use('/api/support-tickets', supportTicketsRouter);
  return app;
}

describe('GET /api/support-tickets/mine', () => {
  it('returns only the caller\'s tickets', async () => {
    const mockSupabase = createMockSupabase([
      { id: 't1', user_id: 'user-1', subject: 'A', created_at: '2026-01-01T00:00:00Z' },
      { id: 't2', user_id: 'user-2', subject: 'B', created_at: '2026-01-02T00:00:00Z' }
    ]);
    const app = buildApp(mockSupabase, 'user-1');
    const res = await request(app).get('/api/support-tickets/mine');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].subject).toBe('A');
  });
});

describe('POST /api/support-tickets', () => {
  it('requires subject and message', async () => {
    const app = buildApp(createMockSupabase());
    const res = await request(app).post('/api/support-tickets').send({ subject: 'Only subject' });
    expect(res.status).toBe(400);
  });

  it('creates an open ticket for the caller', async () => {
    const app = buildApp(createMockSupabase());
    const res = await request(app)
      .post('/api/support-tickets')
      .send({ subject: 'Payment issue', message: 'My payout is delayed' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('open');
    expect(res.body.user_id).toBe('user-1');
  });
});
