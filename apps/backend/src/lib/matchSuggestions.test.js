import { describe, it, expect, vi, beforeEach } from 'vitest';

function createStore() {
  return { loads: [], load_bids: [], truck_availabilities: [], user_profiles: [], match_suggestions: [] };
}
let store = createStore();

function makeBuilder(table) {
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
    upsert: (rows) => {
      store[table].push(...rows);
      return Promise.resolve({ data: rows, error: null });
    },
    then: (resolve) => {
      const data = (store[table] || []).filter((r) => filters.every((f) => f(r)));
      resolve({ data, error: null });
    }
  };
  return builder;
}

vi.mock('./supabase.js', () => ({
  supabaseAdmin: { from: (table) => makeBuilder(table) }
}));

const { generateMatchSuggestions } = await import('./matchSuggestions.js');

beforeEach(() => {
  store = createStore();
});

const now = () => new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

describe('generateMatchSuggestions', () => {
  it('does nothing when there are no active loads', async () => {
    store.loads.push({ id: 'l1', posted_by: 'a@x.com', status: 'completed', material_type: 'Cement', required_truck_type: 'tata_407' });
    const result = await generateMatchSuggestions();
    expect(result.suggestions_upserted).toBe(0);
    expect(store.match_suggestions).toHaveLength(0);
  });

  it('suggests a transporter who recently bid on a similar load', async () => {
    store.loads.push(
      { id: 'target', posted_by: 'poster@x.com', status: 'active', material_type: 'Cement', required_truck_type: 'tata_407', loading_pincode: '400001' },
      { id: 'past', posted_by: 'other@x.com', status: 'completed', material_type: 'Cement', required_truck_type: 'tata_407' }
    );
    store.load_bids.push({ load_id: 'past', bid_by_email: 'trucker@x.com', created_at: daysAgo(5) });
    store.user_profiles.push({ user_id: 'trucker-user', user_email: 'trucker@x.com' });

    const result = await generateMatchSuggestions();

    expect(result.suggestions_upserted).toBe(1);
    expect(store.match_suggestions[0]).toMatchObject({ load_id: 'target', suggested_transporter_id: 'trucker-user' });
    expect(store.match_suggestions[0].reason).toContain('Cement');
  });

  it('ignores a bid outside the recent window', async () => {
    store.loads.push(
      { id: 'target', posted_by: 'poster@x.com', status: 'active', material_type: 'Cement', required_truck_type: 'tata_407', loading_pincode: '400001' },
      { id: 'past', posted_by: 'other@x.com', status: 'completed', material_type: 'Cement', required_truck_type: 'tata_407' }
    );
    store.load_bids.push({ load_id: 'past', bid_by_email: 'trucker@x.com', created_at: daysAgo(120) });
    store.user_profiles.push({ user_id: 'trucker-user', user_email: 'trucker@x.com' });

    const result = await generateMatchSuggestions();
    expect(result.suggestions_upserted).toBe(0);
  });

  it('ignores a bid on a load with a different material/truck type', async () => {
    store.loads.push(
      { id: 'target', posted_by: 'poster@x.com', status: 'active', material_type: 'Cement', required_truck_type: 'tata_407', loading_pincode: '400001' },
      { id: 'past', posted_by: 'other@x.com', status: 'completed', material_type: 'Steel', required_truck_type: 'tata_407' }
    );
    store.load_bids.push({ load_id: 'past', bid_by_email: 'trucker@x.com', created_at: daysAgo(5) });
    store.user_profiles.push({ user_id: 'trucker-user', user_email: 'trucker@x.com' });

    const result = await generateMatchSuggestions();
    expect(result.suggestions_upserted).toBe(0);
  });

  it('suggests a transporter with an available truck at the pickup pincode', async () => {
    store.loads.push({ id: 'target', posted_by: 'poster@x.com', status: 'active', material_type: 'Cement', required_truck_type: 'tata_407', loading_pincode: '400001' });
    store.truck_availabilities.push({ owner_id: 'owner-user', current_pincode: '400001', status: 'available' });

    const result = await generateMatchSuggestions();

    expect(result.suggestions_upserted).toBe(1);
    expect(store.match_suggestions[0]).toMatchObject({ load_id: 'target', suggested_transporter_id: 'owner-user' });
    expect(store.match_suggestions[0].reason).toContain('400001');
  });

  it('never suggests the poster to themselves via recent bids', async () => {
    store.loads.push(
      { id: 'target', posted_by: 'same@x.com', status: 'active', material_type: 'Cement', required_truck_type: 'tata_407', loading_pincode: '400001' },
      { id: 'past', posted_by: 'other@x.com', status: 'completed', material_type: 'Cement', required_truck_type: 'tata_407' }
    );
    store.load_bids.push({ load_id: 'past', bid_by_email: 'same@x.com', created_at: daysAgo(5) });
    store.user_profiles.push({ user_id: 'same-user', user_email: 'same@x.com' });

    const result = await generateMatchSuggestions();
    expect(result.suggestions_upserted).toBe(0);
  });

  it('ignores an unavailable (booked) truck posting even at a matching pincode', async () => {
    store.loads.push({ id: 'target', posted_by: 'poster@x.com', status: 'active', material_type: 'Cement', required_truck_type: 'tata_407', loading_pincode: '400001' });
    store.truck_availabilities.push({ owner_id: 'owner-user', current_pincode: '400001', status: 'booked' });

    const result = await generateMatchSuggestions();
    expect(result.suggestions_upserted).toBe(0);
  });
});
