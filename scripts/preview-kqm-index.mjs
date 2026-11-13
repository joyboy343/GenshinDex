import { lstat, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../apps/server/src/db.ts';
import { createKqmCharacterGuidesDraft } from '../apps/server/src/guideCatalog.ts';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const indexPath = resolve(root, 'storage/imports/kqm-tcl/index.html');
const metadata = await lstat(indexPath).catch(() => null);
if (!metadata?.isFile() || metadata.isSymbolicLink()) {
  process.stderr.write(`No regular KQM index HTML file found at ${indexPath}\n`);
  process.stderr.write('Stage the downloaded characters index as index.html, then run npm run kqm-index:preview.\n');
  process.exit(2);
}
if (metadata.size > 4 * 1024 * 1024) throw new Error('KQM index HTML exceeds the 4 MB import limit.');
const bytes = new Uint8Array(await readFile(indexPath));
const db = await openDatabase();
try {
  const preview = createKqmCharacterGuidesDraft(db, bytes, 'user-staged-offline-html');
  process.stdout.write(`${JSON.stringify({ ...preview, instruction: 'Review and approve this page index in GenshinDex before importing character pages.' }, null, 2)}\n`);
} finally { db.close(); }
