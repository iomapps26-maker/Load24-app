import crypto from 'crypto';
import { supabaseAdmin } from './supabase.js';

const INCREASE_TYPES = new Set(['add_money', 'credit', 'refund', 'security_release']);

export function generateTransactionId() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `TXN${stamp}${random}`;
}

export function isIncreaseType(type) {
  return INCREASE_TYPES.has(type);
}

// Every wallet route needs the caller's wallet row; verified users get one
// lazily on first touch (mirrors getOrCreateCase in routes/kyc.js) rather
// than provisioning one at signup for accounts that may never use it.
export async function getOrCreateWallet(userId) {
  const { data: existing, error: fetchError } = await supabaseAdmin.from('wallets').select('*').eq('user_id', userId).maybeSingle();
  if (fetchError) throw fetchError;
  if (existing) return existing;

  const { data: created, error: createError } = await supabaseAdmin.from('wallets').insert({ user_id: userId }).select().single();
  if (createError) throw createError;
  return created;
}

// Shared ledger-write: one completed wallet_transactions row for a given
// user/type/amount. Used by both routes/wallet.js's POST /adjust (a staff
// member typing an amount in by hand) and automatic adjustments applied
// elsewhere (loadBids.js auto-applies a matching commission_rules row on
// trip completion) — one insert shape for "record a completed adjustment",
// so neither call site duplicates the other's column list.
export async function applyWalletAdjustment({ user_id, type, amount, notes, reference_load_id }) {
  const wallet = await getOrCreateWallet(user_id);
  const transaction_id = generateTransactionId();
  const { data, error } = await supabaseAdmin
    .from('wallet_transactions')
    .insert({
      transaction_id,
      wallet_id: wallet.id,
      user_id,
      type,
      amount,
      status: 'completed',
      reference_load_id: reference_load_id || null,
      notes: notes || null
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Requested-but-not-yet-paid withdrawals are held out of the spendable
// balance so a user can't request the same money twice while staff review
// is still pending — wallets.balance itself only moves once a withdrawal
// is actually paid out (see routes/wallet.js POST /withdrawals/:id/pay).
export async function getAvailableBalance(wallet) {
  const { data, error } = await supabaseAdmin
    .from('withdrawal_requests')
    .select('amount')
    .eq('wallet_id', wallet.id)
    .in('status', ['pending', 'approved']);
  if (error) throw error;

  const held = (data || []).reduce((sum, row) => sum + Number(row.amount), 0);
  return Number(wallet.balance) - held;
}
