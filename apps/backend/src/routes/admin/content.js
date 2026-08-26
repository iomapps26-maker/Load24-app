import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';

const CONTENT_BLOCK_TYPES = ['banner', 'faq', 'config'];
const PLATFORMS = ['android', 'ios'];

const router = Router();

function validateContentBlockType(type) {
  if (!CONTENT_BLOCK_TYPES.includes(type)) return `type must be one of: ${CONTENT_BLOCK_TYPES.join(', ')}`;
  return null;
}

// GET /api/admin/content-blocks?type=&is_active=&key=
router.get('/', async (req, res) => {
  let query = supabaseAdmin.from('content_blocks').select('*').order('created_at', { ascending: false });
  const { type, is_active, key } = req.query;
  if (type) query = query.eq('type', type);
  if (is_active !== undefined) query = query.eq('is_active', is_active === 'true');
  if (key) query = query.eq('key', key);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// GET /api/admin/content-blocks/:id
router.get('/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('content_blocks').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Content block not found' });
  res.json(data);
});

// POST /api/admin/content-blocks { key, type, payload?, is_active? }
router.post('/', async (req, res) => {
  const { key, type, payload, is_active } = req.body;
  if (!key || !type) return res.status(400).json({ error: 'key and type are required' });
  const typeError = validateContentBlockType(type);
  if (typeError) return res.status(400).json({ error: typeError });

  const { data, error } = await supabaseAdmin
    .from('content_blocks')
    .insert({
      key,
      type,
      payload: payload ?? {},
      is_active: is_active !== undefined ? !!is_active : true,
      created_by: req.user.id
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: `A content block with key "${key}" already exists` });
    return res.status(400).json({ error: error.message });
  }
  res.status(201).json(data);
});

// PATCH /api/admin/content-blocks/:id
router.patch('/:id', async (req, res) => {
  const { key, type, payload, is_active } = req.body;
  const patch = {};

  if (key !== undefined) patch.key = key;
  if (type !== undefined) {
    const typeError = validateContentBlockType(type);
    if (typeError) return res.status(400).json({ error: typeError });
    patch.type = type;
  }
  if (payload !== undefined) patch.payload = payload;
  if (is_active !== undefined) patch.is_active = !!is_active;

  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No fields to update' });
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin.from('content_blocks').update(patch).eq('id', req.params.id).select().maybeSingle();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: `A content block with key "${key}" already exists` });
    return res.status(400).json({ error: error.message });
  }
  if (!data) return res.status(404).json({ error: 'Content block not found' });
  res.json(data);
});

// DELETE /api/admin/content-blocks/:id
router.delete('/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('content_blocks').delete().eq('id', req.params.id).select().maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Content block not found' });
  res.status(204).end();
});

export default router;

// GET /api/admin/app-versions — admin management for app_versions, kept as
// a second small router in this same file (rather than a separate one)
// since it's the "app_versions table" half of this file's spec, mounted at
// its own path (/api/admin/app-versions) in index.js because it's a
// distinct resource from content_blocks, not a sub-path of it.
export const appVersionsRouter = Router();

appVersionsRouter.get('/', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('app_versions').select('*').order('platform', { ascending: true });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// PUT /api/admin/app-versions/:platform { min_supported_version, latest_version }
// Upsert rather than separate POST/PATCH — app_versions has exactly one row
// per platform by construction (platform unique, checked against PLATFORMS
// below), so "create" and "update" are the same operation from the caller's
// perspective. Same onConflict-keyed-upsert shape as trucks.js's
// truck_documents upsert.
appVersionsRouter.put('/:platform', async (req, res) => {
  const { platform } = req.params;
  if (!PLATFORMS.includes(platform)) return res.status(400).json({ error: `platform must be one of: ${PLATFORMS.join(', ')}` });

  const { min_supported_version, latest_version } = req.body;
  if (!min_supported_version || !latest_version) {
    return res.status(400).json({ error: 'min_supported_version and latest_version are required' });
  }

  const { data, error } = await supabaseAdmin
    .from('app_versions')
    .upsert({ platform, min_supported_version, latest_version, updated_at: new Date().toISOString() }, { onConflict: 'platform' })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// GET /api/app-config — public, no auth: the mobile app calls this on
// launch, before any session exists, so it goes through supabaseAdmin
// directly rather than req.supabase (there is no req.supabase — this route
// is mounted with no requireAuth in front of it, same as whatsappAuth.ts's
// OTP endpoints). Named export, not the default router — a single public
// handler mounted directly in index.js rather than nested under a
// requireAuth/requireRole-gated router.
//
// ?platform=android|ios narrows app_versions to that one platform's row;
// omitted, it returns all platforms so a caller (or a future web client)
// can pick.
export async function appConfigHandler(req, res) {
  const { platform } = req.query;

  const [{ data: blocks, error: blocksError }, { data: versions, error: versionsError }] = await Promise.all([
    supabaseAdmin.from('content_blocks').select('key, type, payload').eq('is_active', true),
    supabaseAdmin.from('app_versions').select('platform, min_supported_version, latest_version')
  ]);
  if (blocksError) return res.status(400).json({ error: blocksError.message });
  if (versionsError) return res.status(400).json({ error: versionsError.message });

  const banners = [];
  const faqs = [];
  const config = {};
  for (const block of blocks || []) {
    if (block.type === 'banner') banners.push({ key: block.key, payload: block.payload });
    else if (block.type === 'faq') faqs.push({ key: block.key, payload: block.payload });
    else if (block.type === 'config') config[block.key] = block.payload;
  }

  const appVersionsByPlatform = {};
  for (const v of versions || []) {
    appVersionsByPlatform[v.platform] = { min_supported_version: v.min_supported_version, latest_version: v.latest_version };
  }

  res.json({
    banners,
    faqs,
    config,
    app_versions: platform ? appVersionsByPlatform[platform] || null : appVersionsByPlatform
  });
}
