import { lstat, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../apps/server/src/db.ts';
import { createEnkaLocalizationDraft, normalizeEnkaLocalizations } from '../apps/server/src/enkaLocalization.ts';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourceDir = resolve(root, 'storage/imports/enka');
const inputPath = join(sourceDir, 'locs.json');
const metadata = await lstat(inputPath).catch(() => null);
if (!metadata) {
  process.stderr.write(`No Enka localization file found at ${inputPath}\n`);
  process.stderr.write('Stage store/gi/locs.json there, then rerun npm run enka-l10n:preview.\n');
  process.exit(2);
}
if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error('locs.json must be a regular file, not a link or directory.');
if (metadata.size > 8 * 1024 * 1024) throw new Error('locs.json exceeds the 8 MB import limit.');
const snapshot = normalizeEnkaLocalizations(new Uint8Array(await readFile(inputPath)));
const db = await openDatabase();
try {
  const preview = createEnkaLocalizationDraft(db, snapshot);
  process.stdout.write(`${JSON.stringify({ ...preview, instruction: 'Review this localization draft in GenshinDex before approval.' }, null, 2)}\n`);
} finally { db.close(); }
