import type { User, SupabaseClient } from '@supabase/supabase-js';

// requireAuth (src/middleware/auth.js) attaches these before any route
// handler runs; every authenticated route relies on them being present.
declare global {
  namespace Express {
    interface Request {
      user: User;
      token: string;
      supabase: SupabaseClient;
    }
  }
}

export {};
