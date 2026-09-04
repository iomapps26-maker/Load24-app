// Shared HTTP error responders. Extracted from routes/loadBids.js (which was
// the only file doing this properly) so every route can stop forwarding raw
// PostgREST/Postgres error.message strings to clients — those can carry
// internal schema detail (missing table/column names, constraint names, RLS
// policy text). Log the real error server-side, send the client something
// safe and useful.

// For reads and generic failures: log, return a generic 400 with the caller's
// own fallback message. Nothing from `error` reaches the client.
export function dbError(res, error, fallbackMessage, { log = '[db]' } = {}) {
  console.error(log, error);
  return res.status(400).json({ error: fallbackMessage });
}

// For writes where the *class* of failure is safe and useful to surface: a
// CHECK/NOT-NULL/FK violation means the payload was wrong; a missing
// column/table means this server is running against an un-migrated database.
// The SQLSTATE code and constraint name can't leak data the way the free-text
// message can, and without them a failed write is just an opaque error.
export function writeError(res, error, fallbackMessage, { log = '[db]' } = {}) {
  console.error(log, error);
  const code = error?.code;
  if (code === '23514') {
    return res.status(400).json({
      error: `${fallbackMessage}: a value was rejected by a database rule (${error.constraint || 'check constraint'}).`,
      code: 'check_violation',
      constraint: error.constraint ?? null
    });
  }
  if (code === '23502') {
    return res.status(400).json({ error: `${fallbackMessage}: a required field was missing.`, code: 'not_null_violation' });
  }
  if (code === '23505') {
    return res.status(409).json({ error: `${fallbackMessage}: it already exists.`, code: 'unique_violation' });
  }
  if (code === '23503') {
    return res.status(400).json({
      error: `${fallbackMessage}: it referenced something that no longer exists (${error.constraint || 'foreign key'}).`,
      code: 'foreign_key_violation'
    });
  }
  if (code === '42501') {
    return res.status(403).json({
      error: `${fallbackMessage}: the database blocked the write (row-level security).`,
      code: 'rls_denied'
    });
  }
  if (code === '42703' || code === '42P01') {
    return res.status(500).json({
      error: `${fallbackMessage}: the server's database is missing a required migration — contact support.`,
      code: 'schema_out_of_date'
    });
  }
  return res.status(400).json({ error: fallbackMessage });
}
