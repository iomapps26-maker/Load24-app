import { Router } from 'express';

const router = Router();

// GET /api/reviews/mine — reviews left for the current user, newest first
router.get('/mine', async (req, res) => {
  const { data, error } = await req.supabase
    .from('reviews')
    .select('*')
    .eq('reviewee_user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

export default router;
