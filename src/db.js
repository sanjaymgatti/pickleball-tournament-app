const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and paste your Supabase connection string into it.'
  );
}

// Supabase requires SSL. `rejectUnauthorized: false` is the standard
// setting for connecting to Supabase from a normal Node server (their
// certificate chain isn't always in Node's default trust store).
//
// Pool sizing: a traditional long-running server (local dev, Render, a
// VPS) is a single process, so a larger pool is fine and efficient. On
// Vercel, many function instances can run in parallel, each with its own
// pool - a large `max` per instance would multiply quickly and can
// exhaust Supabase's connection limit. `process.env.VERCEL` is set
// automatically by Vercel's runtime, so this adapts without any extra
// configuration. If you deploy to Vercel, also point DATABASE_URL at
// Supabase's "Transaction pooler" connection string (Project Settings ->
// Database -> Connection Pooling, port 6543) rather than the direct
// connection (port 5432) - see .env.example and the README for details.
const isServerless = !!process.env.VERCEL;
const poolMax = parseInt(process.env.PG_POOL_MAX || (isServerless ? '3' : '10'), 10);

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: poolMax,
  idleTimeoutMillis: isServerless ? 10000 : 30000
});

pool.on('error', (err) => {
  // Errors on idle clients in the pool (e.g. a dropped connection)
  // shouldn't crash the whole process.
  console.error('Unexpected error on idle Postgres client', err);
});

/**
 * Run a query against the pool. Use $1, $2, ... placeholders (Postgres
 * style), not SQLite's `?`.
 */
function query(text, params) {
  return pool.query(text, params);
}

/**
 * Run a callback with a single dedicated client, wrapped in a
 * transaction (BEGIN/COMMIT, ROLLBACK on error). Use this whenever an
 * operation needs more than one statement to succeed or fail together
 * (e.g. clearing old matches and inserting a fresh set of draws).
 */
async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
