import { supabaseAdmin } from './supabase.js';

// Permanent, evenly round-robin-assigned support/sales contacts (marketplace
// feature: "my point of contact"). See db/migrations/061_add_support_sales_contacts.sql
// for the schema and the assign_support_contact()/assign_sales_contact()
// functions this calls — both are idempotent get-or-assign, safe under
// concurrency (advisory lock + FOR UPDATE SKIP LOCKED), so calling either
// redundantly is always safe.
//
// Routes call these wrappers, never supabaseAdmin.rpc(...) directly — keeps
// the RPC call mockable in route tests without needing a `.rpc()` stub on
// every test's Supabase mock.

export async function getOrAssignSupportContact(userId) {
  const { data, error } = await supabaseAdmin.rpc('assign_support_contact', { p_user_id: userId });
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function getOrAssignSalesContact(userId) {
  const { data, error } = await supabaseAdmin.rpc('assign_sales_contact', { p_user_id: userId });
  if (error) throw error;
  return data?.[0] ?? null;
}
