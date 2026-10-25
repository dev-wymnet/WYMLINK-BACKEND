import { pool } from './pool.js';

export async function checkPostgresConnection(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('select 1');
  } finally {
    client.release();
  }
}
