// SPR school backend — storage adapter.
// Production: node-postgres (`pg`) via SPR_DB_URL. Tests/dev: PGlite (the
// repo's existing devDependency) — same schema.sql, same parameterised SQL,
// so the suite exercises the real dialect, not a mock.
export async function openStore(opts = {}) {
  const dbUrl = opts.dbUrl || process.env.SPR_DB_URL || '';
  if (dbUrl) {
    let pg = null;
    try { pg = await import('pg'); }
    catch (e) {
      throw new Error('SPR_DB_URL is set but the `pg` driver is not installed. On the server run: npm install pg');
    }
    const pool = new pg.Pool({ connectionString: dbUrl, max: 10 });
    return {
      kind: 'pg',
      async query(sql, params) {
        const r = await pool.query(sql, params || []);
        return r.rows;
      },
      async close() { await pool.end(); }
    };
  }
  let PGlite = null;
  try { ({ PGlite } = await import('@electric-sql/pglite')); }
  catch (e) {
    throw new Error('No SPR_DB_URL and PGlite is not installed (devDependency @electric-sql/pglite)');
  }
  const db = opts.persistPath ? new PGlite(opts.persistPath) : new PGlite();
  return {
    kind: 'pglite',
    async query(sql, params) {
      const r = await db.query(sql, params || []);
      return r.rows || [];
    },
    async close() { await db.close(); }
  };
}
