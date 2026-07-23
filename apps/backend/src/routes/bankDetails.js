import { Router } from 'express';

const router = Router();

// GET /api/bank-details/me — current user's bank details, or null if not saved yet
router.get('/me', async (req, res) => {
  const { data, error } = await req.supabase
    .from('bank_details')
    .select('*')
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// POST /api/bank-details — create/replace the caller's bank details.
// Any edit resets `verified` to false — only staff can re-verify (not built yet).
router.post('/', async (req, res) => {
  const { account_holder_name, account_number, ifsc_code, bank_name } = req.body;
  if (!account_holder_name || !account_number || !ifsc_code || !bank_name) {
    return res.status(400).json({ error: 'account_holder_name, account_number, ifsc_code and bank_name are required' });
  }

  const { data, error } = await req.supabase
    .from('bank_details')
    .upsert(
      {
        user_id: req.user.id,
        account_holder_name,
        account_number,
        ifsc_code,
        bank_name,
        verified: false,
        verified_at: null
      },
      { onConflict: 'user_id' }
    )
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

export default router;
