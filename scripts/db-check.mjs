import { openDatabase } from '../apps/server/src/db.ts';

const db = await openDatabase();
try {
  const integrity = db.prepare('PRAGMA integrity_check').get();
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
  const migrations = db.prepare('SELECT name, applied_at FROM schema_migrations ORDER BY name').all();
  console.log(JSON.stringify({ integrity: integrity.integrity_check, foreignKeyViolations: foreignKeys.length, migrations }, null, 2));
  if (integrity.integrity_check !== 'ok' || foreignKeys.length) process.exitCode = 1;
} finally {
  db.close();
}
