import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { recordSuccessfulSourceCheck } from './sourceChecks.ts';

const SOURCE_URL = 'https://library.keqingmains.com/characters';
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_PAGES = 500;
type GuidePage = { slug: string; displayName: string; pageUrl: string; classification: 'character-reference-page'; sourcePublisher: 'KeqingMains Theorycrafting Library' };

function decodeHtml(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, number: string) => String.fromCodePoint(Number(number))).replace(/&#x([0-9a-f]+);/gi, (_, number: string) => String.fromCodePoint(parseInt(number, 16)));
}

export function parseKqmCharacterIndex(html: string): GuidePage[] {
  const pages = new Map<string, GuidePage>();
  const anchors = html.matchAll(/<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi);
  for (const match of anchors) {
    const href = decodeHtml(match[2] ?? '');
    let parsed: URL;
    try { parsed = new URL(href, SOURCE_URL); } catch { continue; }
    if (parsed.origin !== 'https://library.keqingmains.com' || !parsed.pathname.startsWith('/characters/')) continue;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 3) continue;
    const slug = parts.at(-1)!.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const inner = match[4] ?? '';
    const heading = inner.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] ?? inner.match(/class=["'][^"']*card__title[^"']*["'][^>]*>([\s\S]*?)<\//i)?.[1];
    if (!heading) continue;
    const name = decodeHtml(heading.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).replace(/^[^\p{L}\p{N}]*/u, '').trim();
    if (!slug || !name || name.length > 120 || pages.has(slug)) continue;
    pages.set(slug, { slug, displayName: name, pageUrl: parsed.href, classification: 'character-reference-page', sourcePublisher: 'KeqingMains Theorycrafting Library' });
  }
  if (pages.size === 0) throw new Error('The KQM index format was not recognized; no guide records were imported.');
  if (pages.size > MAX_PAGES) throw new Error(`The KQM index contains an unsupported number of pages (${pages.size}).`);
  return [...pages.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

async function boundedText(response: Response): Promise<Uint8Array> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_BYTES) throw new Error('The KQM index exceeds the 4 MB import limit.');
  if (!response.body) throw new Error('KQM returned an empty response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error('The KQM index exceeds the 4 MB import limit.'); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function previewKqmCharacterGuides(db: DatabaseSync, fetchImpl: typeof fetch = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try { response = await fetchImpl(SOURCE_URL, { headers: { 'user-agent': 'GenshinDex-local/0.1 (source coverage index)', accept: 'text/html' }, redirect: 'error', signal: controller.signal }); }
  catch (error) { throw new Error(error instanceof Error && error.name === 'AbortError' ? 'KQM index request timed out.' : 'Could not reach KeqingMains. Check network access and try again.'); }
  finally { clearTimeout(timeout); }
  if (!response.ok) throw new Error(`KQM index request failed with HTTP ${response.status}.`);
  const bytes = await boundedText(response);
  const sourceRevision = response.headers.get('etag') ?? response.headers.get('last-modified');
  const preview = createKqmCharacterGuidesDraft(db, bytes, sourceRevision);
  recordSuccessfulSourceCheck(db, { sourceId: 'kqm-theorycrafting-library', datasetKey: 'kqm-character-reference-index', datasetVersion: preview.version, sourceRevision, contentHash: preview.version.slice('sha256-'.length) });
  return preview;
}

export function createKqmCharacterGuidesDraft(db: DatabaseSync, bytes: Uint8Array, sourceRevision: string | null = null) {
  if (bytes.byteLength > MAX_BYTES) throw new Error('The KQM index exceeds the 4 MB import limit.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const pages = parseKqmCharacterIndex(text);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const key = 'kqm-character-reference-index';
  const version = `sha256-${hash}`;
  const known = db.prepare('SELECT id,state FROM game_datasets WHERE dataset_key=? AND version=?').get(key, version) as { id: string; state: string } | undefined;
  const currentDataset = db.prepare("SELECT id FROM game_datasets WHERE dataset_key=? AND state='approved' ORDER BY approved_at DESC LIMIT 1").get(key) as { id: string } | undefined;
  const currentRows = currentDataset ? db.prepare("SELECT entity_key,canonical_json FROM game_entities WHERE dataset_id=? AND entity_type='kqm-character-reference'").all(currentDataset.id) as Array<{ entity_key: string; canonical_json: string }> : [];
  const current = new Map(currentRows.map((row) => [row.entity_key, row.canonical_json]));
  const counts = { added: 0, modified: 0, unchanged: 0 };
  for (const page of pages) {
    const before = current.get(page.slug);
    if (before === undefined) counts.added += 1;
    else if (before === JSON.stringify(page)) counts.unchanged += 1;
    else counts.modified += 1;
  }
  if (known) return { datasetId: known.id, datasetState: known.state, version, sourceRevision, pageCount: pages.length, counts };
  const datasetId = randomUUID();
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO game_datasets(id,dataset_key,version,state,provenance_json,created_at) VALUES (?,?,?,\'draft\',?,?)').run(datasetId, key, version, JSON.stringify({ source: SOURCE_URL, sourceRevision, sha256: hash, pageCount: pages.length, recordMeaning: 'KQM character-reference page index; not a verified playable roster or build guide set' }), now);
    const insert = db.prepare('INSERT INTO game_entities(id,dataset_id,entity_type,entity_key,canonical_json,source_url,source_revision,completeness) VALUES (?,?,?,?,?,?,?,?)');
    for (const page of pages) insert.run(randomUUID(), datasetId, 'kqm-character-reference', page.slug, JSON.stringify(page), page.pageUrl, sourceRevision, 'partial');
    db.prepare('INSERT INTO knowledge_revisions(id,dataset_id,revision_type,occurred_at,details_json) VALUES (?,?,?,?,?)').run(randomUUID(), datasetId, 'import-preview', now, JSON.stringify({ counts, pageCount: pages.length, sourceRevision, sha256: hash }));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { datasetId, datasetState: 'draft', version, sourceRevision, pageCount: pages.length, counts };
}

export function listKqmCharacterGuides(db: DatabaseSync) {
  const dataset = db.prepare("SELECT id,version,approved_at AS approvedAt,provenance_json AS provenance FROM game_datasets WHERE dataset_key='kqm-character-reference-index' AND state='approved' ORDER BY approved_at DESC LIMIT 1").get() as Record<string, unknown> | undefined;
  if (!dataset) return { dataset: null, total: 0, items: [] };
  const rows = db.prepare("SELECT canonical_json FROM game_entities WHERE dataset_id=? AND entity_type='kqm-character-reference' ORDER BY entity_key").all(dataset.id) as Array<{ canonical_json: string }>;
  return { dataset: { ...dataset, provenance: JSON.parse(String(dataset.provenance)) }, total: rows.length, items: rows.map((row) => JSON.parse(row.canonical_json)) };
}

export function listKqmGuideDrafts(db: DatabaseSync) {
  const rows = db.prepare("SELECT id,version,state,provenance_json AS provenance,created_at AS createdAt FROM game_datasets WHERE dataset_key='kqm-character-reference-index' AND state='draft' ORDER BY created_at DESC").all() as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const provenance = JSON.parse(String(row.provenance)) as Record<string, unknown>;
    const pageCount = Number((db.prepare("SELECT COUNT(*) AS count FROM game_entities WHERE dataset_id=? AND entity_type='kqm-character-reference'").get(row.id) as { count: number }).count);
    return { id: row.id, version: row.version, state: row.state, provenance, pageCount, createdAt: row.createdAt };
  });
}

export function approveKqmGuides(db: DatabaseSync, id: string) {
  const dataset = db.prepare("SELECT id,dataset_key,version,state FROM game_datasets WHERE id=? AND dataset_key='kqm-character-reference-index'").get(id) as Record<string, unknown> | undefined;
  if (!dataset) return { status: 404, error: { code: 'NOT_FOUND', message: 'KQM coverage preview not found.' } };
  if (dataset.state === 'approved') return { status: 200, data: dataset };
  if (dataset.state !== 'draft') return { status: 409, error: { code: 'DATASET_NOT_APPROVABLE', message: 'Only a draft KQM coverage index can be approved.' } };
  const prior = db.prepare("SELECT id FROM game_datasets WHERE dataset_key='kqm-character-reference-index' AND state='approved'").get() as { id: string } | undefined;
  const ids = new Set((db.prepare("SELECT entity_key FROM game_entities WHERE dataset_id=? AND entity_type='kqm-character-reference'").all(id) as Array<{ entity_key: string }>).map((row) => row.entity_key));
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    let carriedForward = 0;
    if (prior) {
      const previous = db.prepare("SELECT * FROM game_entities WHERE dataset_id=? AND entity_type='kqm-character-reference'").all(prior.id) as Array<Record<string, unknown>>;
      const insert = db.prepare('INSERT INTO game_entities(id,dataset_id,entity_type,entity_key,canonical_json,source_url,source_revision,completeness) VALUES (?,?,?,?,?,?,?,?)');
      for (const row of previous) if (!ids.has(String(row.entity_key))) { insert.run(randomUUID(), id, row.entity_type, row.entity_key, row.canonical_json, row.source_url, row.source_revision, row.completeness); carriedForward += 1; }
      db.prepare("UPDATE game_datasets SET state='superseded' WHERE id=?").run(prior.id);
    }
    db.prepare("UPDATE game_datasets SET state='approved',approved_at=? WHERE id=?").run(now, id);
    db.prepare('INSERT INTO knowledge_revisions(id,dataset_id,revision_type,occurred_at,details_json) VALUES (?,?,?,?,?)').run(randomUUID(), id, 'approval', now, JSON.stringify({ priorDatasetSuperseded: Boolean(prior), carriedForward }));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { status: 200, data: { id, key: dataset.dataset_key, version: dataset.version, state: 'approved', approvedAt: now } };
}
