import { DatabaseSync } from 'node:sqlite';
import { readdir, readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const databasePath = process.env.GENSHINDEX_DB_PATH ?? resolve(root, 'storage/database/genshindex.sqlite');
const migrationsPath = resolve(root, 'apps/server/migrations');

export async function openDatabase(path = databasePath): Promise<DatabaseSync> {
  await mkdir(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const files = (await readdir(migrationsPath)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of files) {
    const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(name);
    if (applied) continue;
    const sql = await readFile(resolve(migrationsPath, name), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations(name, applied_at) VALUES (?, ?)').run(name, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      db.close();
      throw error;
    }
  }
  return db;
}
