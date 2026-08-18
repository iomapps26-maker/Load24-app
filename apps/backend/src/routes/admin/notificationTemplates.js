import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';

const router = Router();

const CHANNELS = ['push', 'email', 'whatsapp'];

// Validated for shape (balanced {{ }}) only, not against a known variable
// list — the set of variables differs per event_key/call site and isn't
// tracked anywhere central yet (src/lib/notify.js's call sites aren't
// rewired to use these templates in this pass — see 034_add_notification_
// templates.sql).
//
// Counts individual braces, not "{{"/"}}" substrings — counting substrings
// misses a stray extra brace like "{{name}}}" (2 "{{" opens, but the 3
// trailing "}" chars still produce exactly 2 non-overlapping "}}" matches,
// so an opens===closes substring count wrongly calls that balanced). Every
// brace has to pair up, and pairing only happens two at a time ({{ / }}),
// so both totals need to be equal AND even.
function hasBalancedPlaceholders(text) {
  if (!text) return true;
  const openBraces = (text.match(/\{/g) || []).length;
  const closeBraces = (text.match(/\}/g) || []).length;
  return openBraces === closeBraces && openBraces % 2 === 0;
}

// GET /api/admin/notification-templates?channel=&event_key=
router.get('/', async (req, res) => {
  let query = supabaseAdmin.from('notification_templates').select('*').order('event_key', { ascending: true });
  const { channel, event_key } = req.query;
  if (channel) query = query.eq('channel', channel);
  if (event_key) query = query.eq('event_key', event_key);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// GET /api/admin/notification-templates/:id
router.get('/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('notification_templates').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Template not found' });
  res.json(data);
});

// POST /api/admin/notification-templates { channel, event_key, subject?, body }
router.post('/', async (req, res) => {
  const { channel, event_key, subject, body } = req.body;
  if (!CHANNELS.includes(channel)) return res.status(400).json({ error: `channel must be one of: ${CHANNELS.join(', ')}` });
  if (!event_key) return res.status(400).json({ error: 'event_key is required' });
  if (!body) return res.status(400).json({ error: 'body is required' });
  if (!hasBalancedPlaceholders(subject) || !hasBalancedPlaceholders(body)) {
    return res.status(400).json({ error: 'subject/body have unbalanced {{ }} placeholders' });
  }

  const { data, error } = await supabaseAdmin
    .from('notification_templates')
    .insert({ channel, event_key, subject: subject ?? null, body })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: `A ${channel} template for ${event_key} already exists` });
    return res.status(400).json({ error: error.message });
  }
  res.status(201).json(data);
});

// PATCH /api/admin/notification-templates/:id { channel?, event_key?, subject?, body? }
router.patch('/:id', async (req, res) => {
  const { channel, event_key, subject, body } = req.body;
  const patch = {};

  if (channel !== undefined) {
    if (!CHANNELS.includes(channel)) return res.status(400).json({ error: `channel must be one of: ${CHANNELS.join(', ')}` });
    patch.channel = channel;
  }
  if (event_key !== undefined) patch.event_key = event_key;
  if (subject !== undefined) patch.subject = subject;
  if (body !== undefined) patch.body = body;

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }
  if (!hasBalancedPlaceholders(patch.subject) || !hasBalancedPlaceholders(patch.body)) {
    return res.status(400).json({ error: 'subject/body have unbalanced {{ }} placeholders' });
  }
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('notification_templates')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .maybeSingle();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'A template for that channel/event_key already exists' });
    return res.status(400).json({ error: error.message });
  }
  if (!data) return res.status(404).json({ error: 'Template not found' });
  res.json(data);
});

// DELETE /api/admin/notification-templates/:id
router.delete('/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('notification_templates').delete().eq('id', req.params.id).select().maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Template not found' });
  res.status(204).end();
});

export default router;
