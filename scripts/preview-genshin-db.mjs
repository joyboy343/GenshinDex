import { lstat, readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../apps/server/src/db.ts';
import { createGenshinDbDraft, normalizeGenshinDbSnapshot } from '../apps/server/src/genshinDbSnapshot.ts';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourceDir = resolve(root, 'storage/imports/genshin-db');
const allow = new Set([
  'english-characters.min.json.gzip', 'english-characters.json.gzip',
  'english-talents.min.json.gzip', 'english-talents.json.gzip',
  'english-constellations.min.json.gzip', 'english-constellations.json.gzip',
  'english-weapons.min.json.gzip', 'english-weapons.json.gzip',
  'english-artifacts.min.json.gzip', 'english-artifacts.json.gzip',
  'english-materials.min.json.gzip', 'english-materials.json.gzip',
  'english-enemies.min.json.gzip', 'english-enemies.json.gzip',
  'english-domains.min.json.gzip', 'english-domains.json.gzip',
  'english-crafts.min.json.gzip', 'english-crafts.json.gzip',
  'english-geographies.min.json.gzip', 'english-geographies.json.gzip',
  'english-achievements.min.json.gzip', 'english-achievements.json.gzip',
]);
const names = await readdir(sourceDir).catch(() => []);
const files = {};
for (const name of names) if (allow.has(name)) {
  const path = join(sourceDir, name);
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(`Import entry ${name} must be a regular file, not a link or directory.`);
  if (metadata.size > 12 * 1024 * 1024) throw new Error(`${name} exceeds the 12 MB compressed input limit.`);
  files[name] = new Uint8Array(await readFile(path));
}
if (!Object.keys(files).some((name) => name.includes('characters'))) {
  process.stderr.write(`No supported Genshin-DB character gzip found in ${sourceDir}\n`);
  process.stderr.write('Stage english-characters.min.json.gzip there. Talents and constellations gzip files are optional.\n');
  process.exit(2);
}
const versionPath = join(sourceDir, 'genshin-db.version');
const versionText = await readFile(versionPath, 'utf8').catch(() => null);
const snapshot = normalizeGenshinDbSnapshot(files, versionText);
const db = await openDatabase();
try {
  const preview = createGenshinDbDraft(db, snapshot);
  process.stdout.write(`${JSON.stringify({ ...preview, sourceRevision: snapshot.sourceRevision, instruction: 'Review this draft in GenshinDex before approval.' }, null, 2)}\n`);
} finally { db.close(); }
