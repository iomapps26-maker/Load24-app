import { Router } from 'express';

const router = Router();

// GET /api/support-tickets/mine — the caller's tickets, newest first
router.get('/mine', async (req, res) => {
  const { data, error } = await req.supabase
    .from('support_tickets')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// POST /api/support-tickets — raise a new ticket
router.post('/', async (req, res) => {
  const { subject, message } = req.body;
  if (!subject || !message) {
    return res.status(400).json({ error: 'subject and message are required' });
  }

  const { data, error } = await req.supabase
    .from('support_tickets')
    .insert({ user_id: req.user.id, subject, message })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

export default router;
