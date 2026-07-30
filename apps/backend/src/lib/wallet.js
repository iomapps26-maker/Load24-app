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
