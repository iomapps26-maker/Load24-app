import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

function createAdminStore() {
  return { user_roles: [], user_profiles: [] };
}
let adminStore = createAdminStore();

function makeAdminQueryBuilder(table) {
  const filters = [];
  const builder = {
    select: () => builder,
    eq: (field, value) => {
      filters.push((r) => r[field] === value);
      return builder;
    },
    in: (field, values) => {
      filters.push((r) => values.includes(r[field]));
      return builder;
    },
    update(patch) {
      const updateFilters = [];
      const updateBuilder = {
        eq: (field, value) => {
          updateFilters.push((r) => r[field] === value);
          return updateBuilder;
        },
        select: () => ({
          single: () => {
            const match = (adminStore[table] || []).find((r) => updateFilters.every((f) => f(r)));
            if (!match) return Promise.resolve({ data: null, error: { message: 'no rows updated' } });
            Object.assign(match, patch);
            return Promise.resolve({ data: match, error: null });
          }
        })
      };
      return updateBuilder;
    },
    then: (resolve) => {
      const data = (adminStore[table] || []).filter((r) => filters.every((f) => f(r)));
      resolve({ data, error: null });
    }
  };
  return builder;
}

vi.mock('../../lib/supabase.js', () => ({
  supabaseAdmin: { from: (table) => makeAdminQueryBuilder(table) }
}));

const { default: hierarchyRouter } = await import('./hierarchy.js');
const { requireRole } = await import('../../middleware/requireRole.js');

const STAFF_ROLES = ['admin', 'support_executive', 'support_manager'];

function buildApp(userId = 'staff-1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use('/api/admin/hierarchy', requireRole(STAFF_ROLES), hierarchyRouter);
  return app;
}

beforeEach(() => {
  adminStore = createAdminStore();
});

function staff() {
  adminStore.user_roles.push({ id: 'ur-staff', user_id: 'staff-1', role: 'admin', reports_to_user_id: null });
}

describe('GET /api/admin/hierarchy', () => {
  it('rejects a non-staff caller with 403', async () => {
    // No role row for the caller at all, and requireRole's own lookup
    // doesn't hit the staff() seed below, so this naturally 403s.
    const res = await request(buildApp('user-1')).get('/api/admin/hierarchy');
    expect(res.status).toBe(403);
  });

  it('builds a tree rooted at whoever has no manager', async () => {
    staff();
    adminStore.user_roles.push(
      { id: 'ur1', user_id: 'manager-1', role: 'sales_manager', reports_to_user_id: null },
      { id: 'ur2', user_id: 'lead-1', role: 'sales_team_lead', reports_to_user_id: 'manager-1' },
      { id: 'ur3', user_id: 'exec-1', role: 'sales_executive', reports_to_user_id: 'lead-1' }
    );
    adminStore.user_profiles.push(
      { user_id: 'manager-1', full_name: 'Manager One' },
      { user_id: 'lead-1', full_name: 'Lead One' },
      { user_id: 'exec-1', full_name: 'Exec One' }
    );

    const res = await request(buildApp()).get('/api/admin/hierarchy');

    expect(res.status).toBe(200);
    const manager = res.body.find((n) => n.user_id === 'manager-1');
    expect(manager).toBeTruthy();
    expect(manager.direct_reports).toHaveLength(1);
    expect(manager.direct_reports[0].user_id).toBe('lead-1');
    expect(manager.direct_reports[0].direct_reports[0].user_id).toBe('exec-1');
  });

  it('treats a manager pointing at a since-removed staffer as a root, not missing', async () => {
    staff();
    adminStore.user_roles.push({ id: 'ur1', user_id: 'orphan-1', role: 'sales_executive', reports_to_user_id: 'ghost-manager' });
    adminStore.user_profiles.push({ user_id: 'orphan-1', full_name: 'Orphan' });

    const res = await request(buildApp()).get('/api/admin/hierarchy');

    expect(res.status).toBe(200);
    expect(res.body.some((n) => n.user_id === 'orphan-1')).toBe(true);
  });

  it('collapses multiple role rows for the same person into one node', async () => {
    staff();
    adminStore.user_roles.push(
      { id: 'ur1', user_id: 'multi-1', role: 'sales_executive', reports_to_user_id: null },
      { id: 'ur2', user_id: 'multi-1', role: 'accounts_executive', reports_to_user_id: null }
    );
    adminStore.user_profiles.push({ user_id: 'multi-1', full_name: 'Multi Role' });

    const res = await request(buildApp()).get('/api/admin/hierarchy');

    const matches = res.body.filter((n) => n.user_id === 'multi-1');
    expect(matches).toHaveLength(1);
    expect(matches[0].roles.sort()).toEqual(['accounts_executive', 'sales_executive']);
  });
});

describe('PATCH /api/admin/hierarchy/:userId/manager', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).patch('/api/admin/hierarchy/exec-1/manager').send({ manager_user_id: 'lead-1' });
    expect(res.status).toBe(403);
  });

  it('rejects self-management', async () => {
    staff();
    const res = await request(buildApp()).patch('/api/admin/hierarchy/exec-1/manager').send({ manager_user_id: 'exec-1' });
    expect(res.status).toBe(400);
  });

  it('404s when the target user has no role assignment', async () => {
    staff();
    const res = await request(buildApp()).patch('/api/admin/hierarchy/nobody/manager').send({ manager_user_id: 'lead-1' });
    expect(res.status).toBe(404);
  });

  it('400s when the user holds multiple roles and none is specified', async () => {
    staff();
    adminStore.user_roles.push(
      { id: 'ur1', user_id: 'multi-1', role: 'sales_executive', reports_to_user_id: null },
      { id: 'ur2', user_id: 'multi-1', role: 'accounts_executive', reports_to_user_id: null }
    );
    const res = await request(buildApp()).patch('/api/admin/hierarchy/multi-1/manager').send({ manager_user_id: 'lead-1' });
    expect(res.status).toBe(400);
  });

  it('sets the manager on the specified role row when multiple exist', async () => {
    staff();
    adminStore.user_roles.push(
      { id: 'ur1', user_id: 'multi-1', role: 'sales_executive', reports_to_user_id: null },
      { id: 'ur2', user_id: 'multi-1', role: 'accounts_executive', reports_to_user_id: null }
    );
    const res = await request(buildApp())
      .patch('/api/admin/hierarchy/multi-1/manager')
      .send({ manager_user_id: 'lead-1', role: 'sales_executive' });

    expect(res.status).toBe(200);
    expect(res.body.reports_to_user_id).toBe('lead-1');
    expect(adminStore.user_roles.find((r) => r.id === 'ur1').reports_to_user_id).toBe('lead-1');
    expect(adminStore.user_roles.find((r) => r.id === 'ur2').reports_to_user_id).toBeNull();
  });

  it('sets a manager for a single-role user without needing role specified', async () => {
    staff();
    adminStore.user_roles.push({ id: 'ur1', user_id: 'exec-1', role: 'sales_executive', reports_to_user_id: null });
    const res = await request(buildApp()).patch('/api/admin/hierarchy/exec-1/manager').send({ manager_user_id: 'staff-1' });
    expect(res.status).toBe(200);
    expect(res.body.reports_to_user_id).toBe('staff-1');
  });

  it('clears the manager when manager_user_id is null', async () => {
    staff();
    adminStore.user_roles.push({ id: 'ur1', user_id: 'exec-1', role: 'sales_executive', reports_to_user_id: 'staff-1' });
    const res = await request(buildApp()).patch('/api/admin/hierarchy/exec-1/manager').send({ manager_user_id: null });
    expect(res.status).toBe(200);
    expect(res.body.reports_to_user_id).toBeNull();
  });

  it('rejects an assignment that would create a reporting cycle', async () => {
    staff();
    // A -> B (B reports to A). Trying to set A's manager to B would loop.
    adminStore.user_roles.push(
      { id: 'ur1', user_id: 'a', role: 'sales_manager', reports_to_user_id: null },
      { id: 'ur2', user_id: 'b', role: 'sales_team_lead', reports_to_user_id: 'a' }
    );
    const res = await request(buildApp()).patch('/api/admin/hierarchy/a/manager').send({ manager_user_id: 'b' });
    expect(res.status).toBe(400);
  });
});
