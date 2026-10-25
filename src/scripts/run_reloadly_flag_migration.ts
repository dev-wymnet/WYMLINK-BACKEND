import fs from 'fs';
import path from 'path';
import { pool } from '../core/db/pool.js';

async function main() {
  const sqlPath = path.resolve(process.cwd(), 'drizzle', '0005_reloadly_flag.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Applied 0005_reloadly_flag.sql successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
