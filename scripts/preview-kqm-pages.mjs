import { lstat, readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../apps/server/src/db.ts';
import { createKqmEvidenceDraft } from '../apps/server/src/kqmEvidence.ts';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const pagesDir = resolve(root, 'storage/imports/kqm-tcl/pages');
const names = await readdir(pagesDir).catch(() => []);
const pages = [];
for (const name of names) {
  if (!name.toLocaleLowerCase().endsWith('.html')) continue;
  const slug = name.slice(0, -5).toLocaleLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(`Invalid KQM page filename: ${name}. Use the approved slug with an .html extension.`);
  const path = join(pagesDir, name);
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(`KQM import entry ${name} must be a regular file.`);
  if (metadata.size > 4 * 1024 * 1024) throw new Error(`${name} exceeds the 4 MB import limit.`);
  pages.push({ slug, html: await readFile(path, 'utf8') });
}
if (!pages.length) {
  process.stderr.write(`No character page HTML files found in ${pagesDir}\n`);
  process.stderr.write('Name each downloaded page with its approved KQM slug, for example albedo.html.\n');
  process.exit(2);
}
const db = await openDatabase();
try {
  const preview = createKqmEvidenceDraft(db, pages);
  process.stdout.write(`${JSON.stringify({ ...preview, instruction: 'Review extracted evidence in GenshinDex before approval. All entries remain experimental and calculation-ineligible.' }, null, 2)}\n`);
} finally { db.close(); }
