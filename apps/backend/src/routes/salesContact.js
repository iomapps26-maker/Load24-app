import { Router } from 'express';
import { getOrAssignSalesContact } from '../lib/contactAssignment.js';

const LOG = '[sales-contact]';

const router = Router();

// GET /api/sales-contact/mine — the caller's permanent, round-robin
// assigned sales contact (db/migrations/061_...), for the app's Profile ->
// Support screen. Soft-fails on an empty/misconfigured roster or any RPC
// error (logs, returns nulls) rather than 500ing — the screen falls back to
// the existing hardcoded SALES_PHONE constant when phone is null, so this
// degrades to today's behaviour instead of breaking the screen.
router.get('/mine', async (req, res) => {
  try {
    const contact = await getOrAssignSalesContact(req.user.id);
    res.json(contact ?? { id: null, name: null, phone: null, email: null });
  } catch (err) {
    console.error(LOG, err);
    res.json({ id: null, name: null, phone: null, email: null });
  }
});

export default router;
