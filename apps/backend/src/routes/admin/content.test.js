import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

function createAdminStore() {
  return { content_blocks: [], app_versions: [], user_roles: [] };
}
let adminStore = createAdminStore();

function makeAdminQueryBuilder(table) {
  const filters = [];
  let sort = null;
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
    order: (field, { ascending = true } = {}) => {
      sort = { field, sign: ascending ? 1 : -1 };
      return builder;
    },
    maybeSingle: () => {
      const data = (adminStore[table] || []).filter((r) => filters.every((f) => f(r)));
      return Promise.resolve({ data: data[0] ?? null, error: null });
    },
    insert(row) {
      if ((adminStore[table] || []).some((r) => r.key === row.key)) {
        return { select: () => ({ single: () => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } }) }) };
      }
      const withId = { id: `id-${(adminStore[table] || []).length + 1}`, ...row };
      (adminStore[table] || (adminStore[table] = [])).push(withId);
      return { select: () => ({ single: () => Promise.resolve({ data: withId, error: null }) }) };
    },
    upsert(row, { onConflict } = {}) {
      const key = onConflict || 'id';
      const existing = (adminStore[table] || []).find((r) => r[key] === row[key]);
      if (existing) {
        Object.assign(existing, row);
        return { select: () => ({ single: () => Promise.resolve({ data: existing, error: null }) }) };
      }
      const withId = { id: `id-${(adminStore[table] || []).length + 1}`, ...row };
      (adminStore[table] || (adminStore[table] = [])).push(withId);
      return { select: () => ({ single: () => Promise.resolve({ data: withId, error: null }) }) };
    },
    update(patch) {
      const updateFilters = [];
      const updateBuilder = {
        eq: (field, value) => {
          updateFilters.push((r) => r[field] === value);
          return updateBuilder;
        },
        select: () => ({
          maybeSingle: () => {
            const match = (adminStore[table] || []).find((r) => updateFilters.every((f) => f(r)));
            if (!match) return Promise.resolve({ data: null, error: null });
            if (patch.key && (adminStore[table] || []).some((r) => r !== match && r.key === patch.key)) {
              return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } });
            }
            Object.assign(match, patch);
            return Promise.resolve({ data: match, error: null });
          }
        })
      };
      return updateBuilder;
    },
    delete() {
      const deleteFilters = [];
      const deleteBuilder = {
        eq: (field, value) => {
          deleteFilters.push((r) => r[field] === value);
          return deleteBuilder;
        },
        select: () => ({
          maybeSingle: () => {
            const idx = (adminStore[table] || []).findIndex((r) => deleteFilters.every((f) => f(r)));
            if (idx === -1) return Promise.resolve({ data: null, error: null });
            const [removed] = adminStore[table].splice(idx, 1);
            return Promise.resolve({ data: removed, error: null });
          }
        })
      };
      return deleteBuilder;
    },
    then: (resolve) => {
      let data = (adminStore[table] || []).filter((r) => filters.every((f) => f(r)));
      if (sort) {
        const { field, sign } = sort;
        data = [...data].sort((a, b) => (a[field] > b[field] ? sign : a[field] < b[field] ? -sign : 0));
      }
      resolve({ data, error: null });
    }
  };
  return builder;
}

vi.mock('../../lib/supabase.js', () => ({
  supabaseAdmin: { from: (table) => makeAdminQueryBuilder(table) }
}));

const { default: contentRouter, appVersionsRouter, appConfigHandler } = await import('./content.js');
const { requireRole } = await import('../../middleware/requireRole.js');

const STAFF_ROLES = ['admin', 'support_executive', 'support_manager'];

function buildApp(userId = 'staff-1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use('/api/admin/content-blocks', requireRole(STAFF_ROLES), contentRouter);
  app.use('/api/admin/app-versions', requireRole(STAFF_ROLES), appVersionsRouter);
  app.get('/api/app-config', appConfigHandler);
  return app;
}

beforeEach(() => {
  adminStore = createAdminStore();
});

function staff() {
  adminStore.user_roles.push({ user_id: 'staff-1', role: 'admin' });
}

describe('POST /api/admin/content-blocks', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).post('/api/admin/content-blocks').send({ key: 'x', type: 'banner' });
    expect(res.status).toBe(403);
  });

  it('requires key and type', async () => {
    staff();
    const res = await request(buildApp()).post('/api/admin/content-blocks').send({ key: 'home_banner' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid type', async () => {
    staff();
    const res = await request(buildApp()).post('/api/admin/content-blocks').send({ key: 'x', type: 'popup' });
    expect(res.status).toBe(400);
  });

  it('creates a content block, defaulting is_active to true and payload to {}', async () => {
    staff();
    const res = await request(buildApp()).post('/api/admin/content-blocks').send({ key: 'home_banner', type: 'banner' });
    expect(res.status).toBe(201);
    expect(res.body.is_active).toBe(true);
    expect(res.body.payload).toEqual({});
    expect(res.body.created_by).toBe('staff-1');
  });

  it('rejects a duplicate key', async () => {
    staff();
    await request(buildApp()).post('/api/admin/content-blocks').send({ key: 'home_banner', type: 'banner' });
    const res = await request(buildApp()).post('/api/admin/content-blocks').send({ key: 'home_banner', type: 'faq' });
    expect(res.status).toBe(409);
  });
});

describe('GET /api/admin/content-blocks', () => {
  it('filters by type and is_active', async () => {
    staff();
    adminStore.content_blocks.push(
      { id: '1', key: 'a', type: 'banner', is_active: true },
      { id: '2', key: 'b', type: 'faq', is_active: true },
      { id: '3', key: 'c', type: 'banner', is_active: false }
    );
    const res = await request(buildApp()).get('/api/admin/content-blocks?type=banner&is_active=true');
    expect(res.status).toBe(200);
    expect(res.body.map((r) => r.id)).toEqual(['1']);
  });
});

describe('PATCH /api/admin/content-blocks/:id', () => {
  it('toggles is_active', async () => {
    staff();
    adminStore.content_blocks.push({ id: '1', key: 'a', type: 'banner', payload: {}, is_active: true });
    const res = await request(buildApp()).patch('/api/admin/content-blocks/1').send({ is_active: false });
    expect(res.status).toBe(200);
    expect(res.body.is_active).toBe(false);
  });

  it('404s for an unknown id', async () => {
    staff();
    const res = await request(buildApp()).patch('/api/admin/content-blocks/nope').send({ is_active: false });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/content-blocks/:id', () => {
  it('removes a content block', async () => {
    staff();
    adminStore.content_blocks.push({ id: '1', key: 'a', type: 'banner', is_active: true });
    const res = await request(buildApp()).delete('/api/admin/content-blocks/1');
    expect(res.status).toBe(204);
    expect(adminStore.content_blocks).toHaveLength(0);
  });
});

describe('PUT /api/admin/app-versions/:platform', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).put('/api/admin/app-versions/android').send({ min_supported_version: '1.0.0', latest_version: '1.2.0' });
    expect(res.status).toBe(403);
  });

  it('rejects an unknown platform', async () => {
    staff();
    const res = await request(buildApp()).put('/api/admin/app-versions/windows').send({ min_supported_version: '1.0.0', latest_version: '1.2.0' });
    expect(res.status).toBe(400);
  });

  it('requires both version fields', async () => {
    staff();
    const res = await request(buildApp()).put('/api/admin/app-versions/android').send({ min_supported_version: '1.0.0' });
    expect(res.status).toBe(400);
  });

  it('creates a platform row on first write', async () => {
    staff();
    const res = await request(buildApp()).put('/api/admin/app-versions/android').send({ min_supported_version: '1.0.0', latest_version: '1.2.0' });
    expect(res.status).toBe(200);
    expect(res.body.platform).toBe('android');
    expect(adminStore.app_versions).toHaveLength(1);
  });

  it('upserts in place on a second write to the same platform', async () => {
    staff();
    await request(buildApp()).put('/api/admin/app-versions/android').send({ min_supported_version: '1.0.0', latest_version: '1.2.0' });
    const res = await request(buildApp()).put('/api/admin/app-versions/android').send({ min_supported_version: '1.1.0', latest_version: '1.3.0' });
    expect(res.status).toBe(200);
    expect(adminStore.app_versions).toHaveLength(1);
    expect(res.body.min_supported_version).toBe('1.1.0');
  });
});

describe('GET /api/app-config', () => {
  it('requires no auth at all', async () => {
    // buildApp's own req.user stub is irrelevant here — appConfigHandler is
    // mounted with no requireAuth/requireRole in front of it, matching how
    // it's wired in index.js.
    adminStore.content_blocks.push({ id: '1', key: 'home_banner', type: 'banner', payload: { image_url: 'x.png' }, is_active: true });
    const app = express();
    app.get('/api/app-config', appConfigHandler);
    const res = await request(app).get('/api/app-config');
    expect(res.status).toBe(200);
  });

  it('groups active content_blocks into banners/faqs/config, and excludes inactive ones', async () => {
    adminStore.content_blocks.push(
      { id: '1', key: 'home_banner', type: 'banner', payload: { image_url: 'x.png' }, is_active: true },
      { id: '2', key: 'shipping_faq', type: 'faq', payload: { q: 'Q', a: 'A' }, is_active: true },
      { id: '3', key: 'min_load_amount', type: 'config', payload: { value: 500 }, is_active: true },
      { id: '4', key: 'old_banner', type: 'banner', payload: {}, is_active: false }
    );
    const res = await request(buildApp()).get('/api/app-config');
    expect(res.status).toBe(200);
    expect(res.body.banners).toEqual([{ key: 'home_banner', payload: { image_url: 'x.png' } }]);
    expect(res.body.faqs).toEqual([{ key: 'shipping_faq', payload: { q: 'Q', a: 'A' } }]);
    expect(res.body.config).toEqual({ min_load_amount: { value: 500 } });
  });

  it('returns app_versions keyed by platform when no ?platform is given', async () => {
    adminStore.app_versions.push(
      { platform: 'android', min_supported_version: '1.0.0', latest_version: '1.2.0' },
      { platform: 'ios', min_supported_version: '2.0.0', latest_version: '2.1.0' }
    );
    const res = await request(buildApp()).get('/api/app-config');
    expect(res.body.app_versions).toEqual({
      android: { min_supported_version: '1.0.0', latest_version: '1.2.0' },
      ios: { min_supported_version: '2.0.0', latest_version: '2.1.0' }
    });
  });

  it('narrows app_versions to one platform when ?platform is given', async () => {
    adminStore.app_versions.push(
      { platform: 'android', min_supported_version: '1.0.0', latest_version: '1.2.0' },
      { platform: 'ios', min_supported_version: '2.0.0', latest_version: '2.1.0' }
    );
    const res = await request(buildApp()).get('/api/app-config?platform=ios');
    expect(res.body.app_versions).toEqual({ min_supported_version: '2.0.0', latest_version: '2.1.0' });
  });

  it('returns null app_versions for an unknown platform', async () => {
    const res = await request(buildApp()).get('/api/app-config?platform=windows');
    expect(res.body.app_versions).toBeNull();
  });
});
