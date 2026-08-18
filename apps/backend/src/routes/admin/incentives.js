import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';
import { evaluateIncentiveRules } from '../../lib/incentiveEvaluation.js';

const router = Router();

// Kept in sync with 038_add_incentive_rules.sql's metric check constraint
// and lib/incentiveEvaluation.js's METRIC_EVALUATORS.
const METRICS = ['trips_completed'];

function validatePositiveNumber(value, fieldName) {
  const parsed = Number(value);
  if (!parsed || parsed <= 0) return `${fieldName} must be a number greater than 0`;
  return null;
}

// GET /api/admin/incentives?is_active=&metric=
router.get('/', async (req, res) => {
  let query = supabaseAdmin.from('incentive_rules').select('*').order('created_at', { ascending: false });
  const { is_active, metric } = req.query;
  if (is_active !== undefined) query = query.eq('is_active', is_active === 'true');
  if (metric) query = query.eq('metric', metric);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// GET /api/admin/incentives/:id
router.get('/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('incentive_rules').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Incentive rule not found' });
  res.json(data);
});

// POST /api/admin/incentives { metric, threshold, reward_amount, is_active? }
router.post('/', async (req, res) => {
  const { metric, threshold, reward_amount, is_active } = req.body;
  if (!METRICS.includes(metric)) return res.status(400).json({ error: `metric must be one of: ${METRICS.join(', ')}` });
  const thresholdError = validatePositiveNumber(threshold, 'threshold');
  if (thresholdError) return res.status(400).json({ error: thresholdError });
  const rewardError = validatePositiveNumber(reward_amount, 'reward_amount');
  if (rewardError) return res.status(400).json({ error: rewardError });

  const { data, error } = await supabaseAdmin
    .from('incentive_rules')
    .insert({
      metric,
      threshold: Number(threshold),
      reward_amount: Number(reward_amount),
      is_active: is_active !== undefined ? !!is_active : true,
      created_by: req.user.id
    })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

// PATCH /api/admin/incentives/:id
router.patch('/:id', async (req, res) => {
  const { metric, threshold, reward_amount, is_active } = req.body;
  const patch = {};

  if (metric !== undefined) {
    if (!METRICS.includes(metric)) return res.status(400).json({ error: `metric must be one of: ${METRICS.join(', ')}` });
    patch.metric = metric;
  }
  if (threshold !== undefined) {
    const err = validatePositiveNumber(threshold, 'threshold');
    if (err) return res.status(400).json({ error: err });
    patch.threshold = Number(threshold);
  }
  if (reward_amount !== undefined) {
    const err = validatePositiveNumber(reward_amount, 'reward_amount');
    if (err) return res.status(400).json({ error: err });
    patch.reward_amount = Number(reward_amount);
  }
  if (is_active !== undefined) patch.is_active = !!is_active;

  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No fields to update' });
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin.from('incentive_rules').update(patch).eq('id', req.params.id).select().maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Incentive rule not found' });
  res.json(data);
});

// DELETE /api/admin/incentives/:id
router.delete('/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('incentive_rules').delete().eq('id', req.params.id).select().maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Incentive rule not found' });
  res.status(204).end();
});

// POST /api/admin/incentives/evaluate — runs the same job the scheduled
// interval (index.js) does, on demand.
router.post('/evaluate', async (req, res) => {
  try {
    const result = await evaluateIncentiveRules();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
