import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const bundledSeedPath = resolve(root, 'packages/game-data/datasets/knowledge-v0.1.0.json');
const verificationStates = ['verified', 'community-confirmed', 'experimental', 'conflicting', 'deprecated'] as const;
type VerificationState = (typeof verificationStates)[number];

type SourceInput = { title: string; publisher: string; url: string; checkedAt: string; sourceVersion: string | null; notes: string };
type EntryInput = { slug: string; category: string; title: string; summary: string; content: string; keywords: string[]; verificationState: VerificationState; confidence: number | null; limitations: string[]; gameVersion: string | null; sources: SourceInput[] };
type DatasetInput = { key: string; version: string; provenance: string; entries: EntryInput[] };
type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringField(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function stringArray(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return Array.isArray(value) && value.length <= maxItems && value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= maxLength);
}

function parseDataset(input: unknown): ParseResult<DatasetInput> {
  if (!isRecord(input) || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(String(input.key ?? '')) || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(String(input.version ?? ''))) {
    return { ok: false, message: 'Dataset must include a lowercase key and semantic version.' };
  }
  if (!stringField(input.provenance, 1000) || !Array.isArray(input.entries) || input.entries.length < 1 || input.entries.length > 250) {
    return { ok: false, message: 'Dataset needs provenance and 1–250 entries.' };
  }

  const entries: EntryInput[] = [];
  const slugs = new Set<string>();
  for (const [index, item] of input.entries.entries()) {
    if (!isRecord(item)) return { ok: false, message: `Entry ${index + 1} must be an object.` };
    const slug = item.slug;
    if (!stringField(slug, 100) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slugs.has(slug)) return { ok: false, message: `Entry ${index + 1} has an invalid or duplicate slug.` };
    if (!stringField(item.category, 64) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.category) || !stringField(item.title, 160) || !stringField(item.summary, 500) || !stringField(item.content, 10000)) return { ok: false, message: `Entry ${slug} has invalid category or text fields.` };
    if (!stringArray(item.keywords, 40, 80) || !stringArray(item.limitations, 30, 500)) return { ok: false, message: `Entry ${slug} has invalid keywords or limitations.` };
    if (typeof item.verificationState !== 'string' || !verificationStates.includes(item.verificationState as VerificationState)) return { ok: false, message: `Entry ${slug} has an unsupported verification state.` };
    if (item.confidence !== null && (typeof item.confidence !== 'number' || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1)) return { ok: false, message: `Entry ${slug} confidence must be null or from 0 to 1.` };
    if (item.gameVersion !== null && !stringField(item.gameVersion, 40)) return { ok: false, message: `Entry ${slug} gameVersion must be a short string or null.` };
    if (!Array.isArray(item.sources) || item.sources.length < 1 || item.sources.length > 10) return { ok: false, message: `Entry ${slug} needs 1–10 source records.` };

    const sources: SourceInput[] = [];
    for (const [sourceIndex, source] of item.sources.entries()) {
      if (!isRecord(source) || !stringField(source.title, 180) || !stringField(source.publisher, 120) || !stringField(source.url, 2048) || !stringField(source.checkedAt, 10)) return { ok: false, message: `Entry ${slug} source ${sourceIndex + 1} is incomplete.` };
      let parsedUrl: URL;
      try { parsedUrl = new URL(source.url); } catch { return { ok: false, message: `Entry ${slug} source ${sourceIndex + 1} has an invalid URL.` }; }
      const validDate = /^\d{4}-\d{2}-\d{2}$/.test(source.checkedAt) && !Number.isNaN(Date.parse(`${source.checkedAt}T00:00:00Z`)) && new Date(`${source.checkedAt}T00:00:00Z`).toISOString().slice(0, 10) === source.checkedAt;
      if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password || !validDate) return { ok: false, message: `Entry ${slug} source ${sourceIndex + 1} requires credential-free HTTPS and a valid YYYY-MM-DD checkedAt date.` };
      const sourceVersion = source.sourceVersion === null || source.sourceVersion === undefined ? null : source.sourceVersion;
      const notes = source.notes ?? '';
      if ((sourceVersion !== null && !stringField(sourceVersion, 100)) || typeof notes !== 'string' || notes.length > 1000) return { ok: false, message: `Entry ${slug} source ${sourceIndex + 1} has invalid notes or version.` };
      sources.push({ title: source.title, publisher: source.publisher, url: parsedUrl.href, checkedAt: source.checkedAt, sourceVersion: sourceVersion as string | null, notes });
    }
    slugs.add(slug);
    entries.push({ slug, category: item.category, title: item.title, summary: item.summary, content: item.content, keywords: item.keywords, verificationState: item.verificationState as VerificationState, confidence: item.confidence as number | null, limitations: item.limitations, gameVersion: item.gameVersion as string | null, sources });
  }
  return { ok: true, value: { key: input.key, version: input.version as string, provenance: input.provenance, entries } };
}

function entrySnapshot(entry: EntryInput): string {
  return JSON.stringify({ category: entry.category, title: entry.title, summary: entry.summary, content: entry.content, keywords: entry.keywords, verificationState: entry.verificationState, confidence: entry.confidence, limitations: entry.limitations, gameVersion: entry.gameVersion, sources: entry.sources });
}

function insertDataset(db: DatabaseSync, dataset: DatasetInput, state: 'draft' | 'approved', id = randomUUID()): string {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO game_datasets(id,dataset_key,version,state,provenance_json,created_at,approved_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, dataset.key, dataset.version, state, JSON.stringify({ description: dataset.provenance }), now, state === 'approved' ? now : null);
  const addEntry = db.prepare(`INSERT INTO knowledge_entries(id,dataset_id,slug,category,title,summary,content,keywords_json,verification_state,confidence,limitations_json,game_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const addSource = db.prepare('INSERT INTO knowledge_sources(id,entry_id,title,publisher,url,checked_at,source_version,notes) VALUES (?,?,?,?,?,?,?,?)');
  for (const entry of dataset.entries) {
    const entryId = `${id}:${entry.slug}`;
    addEntry.run(entryId, id, entry.slug, entry.category, entry.title, entry.summary, entry.content, JSON.stringify(entry.keywords), entry.verificationState, entry.confidence, JSON.stringify(entry.limitations), entry.gameVersion);
    for (const source of entry.sources) addSource.run(randomUUID(), entryId, source.title, source.publisher, source.url, source.checkedAt, source.sourceVersion, source.notes);
  }
  return id;
}

export async function ensureBundledKnowledge(db: DatabaseSync): Promise<void> {
  const seed = JSON.parse(await readFile(bundledSeedPath, 'utf8')) as unknown;
  const parsed = parseDataset(seed);
  if (!parsed.ok) throw new Error(`Bundled knowledge dataset is invalid: ${parsed.message}`);
  const existing = db.prepare('SELECT id FROM game_datasets WHERE dataset_key=? AND version=?').get(parsed.value.key, parsed.value.version);
  if (existing) return;
  const hasApprovedVersion = db.prepare(`SELECT 1 FROM game_datasets WHERE dataset_key=? AND state='approved'`).get(parsed.value.key);
  const state = hasApprovedVersion ? 'draft' : 'approved';
  const datasetId = `${parsed.value.key}@${parsed.value.version}`;
  db.exec('BEGIN IMMEDIATE');
  try {
    insertDataset(db, parsed.value, state, datasetId);
    db.prepare('INSERT INTO knowledge_revisions(id,dataset_id,revision_type,occurred_at,details_json) VALUES (?,?,?,?,?)')
      .run(randomUUID(), datasetId, state === 'approved' ? 'approval' : 'import-preview', new Date().toISOString(), JSON.stringify({ source: 'bundled-release', state }));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export type DatasetPreviewResult = { ok: true; datasetId: string; key: string; version: string; counts: { added: number; modified: number; unchanged: number }; entries: Array<{ slug: string; change: 'added' | 'modified' | 'unchanged' }> } | { ok: false; message: string };

export function previewDataset(db: DatabaseSync, input: unknown): DatasetPreviewResult {
  const parsed = parseDataset(input);
  if (!parsed.ok) return parsed;
  const dataset = parsed.value;
  const active = db.prepare(`SELECT id FROM game_datasets WHERE dataset_key=? AND state='approved' ORDER BY approved_at DESC LIMIT 1`).get(dataset.key) as { id: string } | undefined;
  const currentRows = active ? db.prepare('SELECT id,slug,category,title,summary,content,keywords_json,verification_state,confidence,limitations_json,game_version FROM knowledge_entries WHERE dataset_id=?').all(active.id) as Array<Record<string, unknown>> : [];
  const current = new Map(currentRows.map((row) => {
    const sources = db.prepare('SELECT title,publisher,url,checked_at,source_version,notes FROM knowledge_sources WHERE entry_id=? ORDER BY checked_at DESC').all(row.id) as Array<Record<string, unknown>>;
    const snapshot = { category: row.category, title: row.title, summary: row.summary, content: row.content, keywords: JSON.parse(String(row.keywords_json)), verificationState: row.verification_state, confidence: row.confidence, limitations: JSON.parse(String(row.limitations_json)), gameVersion: row.game_version, sources: sources.map((source) => ({ title: source.title, publisher: source.publisher, url: source.url, checkedAt: source.checked_at, sourceVersion: source.source_version, notes: source.notes })) };
    return [String(row.slug), JSON.stringify(snapshot)] as const;
  }));
  const entries = dataset.entries.map((entry) => {
    const before = current.get(entry.slug);
    const change = before === undefined ? 'added' : before === entrySnapshot(entry) ? 'unchanged' : 'modified';
    return { slug: entry.slug, change };
  });
  const diff = { added: entries.filter((entry) => entry.change === 'added').length, modified: entries.filter((entry) => entry.change === 'modified').length, unchanged: entries.filter((entry) => entry.change === 'unchanged').length };
  const datasetId = randomUUID();
  db.exec('BEGIN IMMEDIATE');
  try {
    insertDataset(db, dataset, 'draft', datasetId);
    db.prepare('INSERT INTO knowledge_revisions(id,dataset_id,revision_type,occurred_at,details_json) VALUES (?,?,?,?,?)')
      .run(randomUUID(), datasetId, 'import-preview', new Date().toISOString(), JSON.stringify({ counts: diff }));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    if ((error as Error).message.includes('UNIQUE constraint failed')) return { ok: false, message: 'A dataset with this key and version already exists.' };
    throw error;
  }
  return { ok: true, datasetId, key: dataset.key, version: dataset.version, counts: diff, entries };
}

export function approveDataset(db: DatabaseSync, id: string): { status: number; data?: unknown; error?: { code: string; message: string } } {
  const dataset = db.prepare('SELECT id,dataset_key,version,state,created_at,approved_at FROM game_datasets WHERE id=?').get(id) as Record<string, unknown> | undefined;
  if (!dataset) return { status: 404, error: { code: 'NOT_FOUND', message: 'Dataset not found.' } };
  if (dataset.state === 'approved') return { status: 200, data: dataset };
  if (dataset.state !== 'draft') return { status: 409, error: { code: 'DATASET_NOT_APPROVABLE', message: 'Only draft datasets can be approved.' } };
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare(`SELECT id FROM game_datasets WHERE dataset_key=? AND state='approved'`).get(dataset.dataset_key) as { id: string } | undefined;
    let carriedForward = 0;
    if (current) {
      const retainedSlugs = new Set((db.prepare('SELECT slug FROM knowledge_entries WHERE dataset_id=?').all(id) as Array<{ slug: string }>).map((entry) => entry.slug));
      const previousEntries = db.prepare('SELECT * FROM knowledge_entries WHERE dataset_id=?').all(current.id) as Array<Record<string, unknown>>;
      const insertEntry = db.prepare(`INSERT INTO knowledge_entries(id,dataset_id,slug,category,title,summary,content,keywords_json,verification_state,confidence,limitations_json,game_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
      const previousSources = db.prepare('SELECT title,publisher,url,checked_at,source_version,notes FROM knowledge_sources WHERE entry_id=?');
      const insertSource = db.prepare('INSERT INTO knowledge_sources(id,entry_id,title,publisher,url,checked_at,source_version,notes) VALUES (?,?,?,?,?,?,?,?)');
      for (const entry of previousEntries) {
        if (retainedSlugs.has(String(entry.slug))) continue;
        const entryId = `${id}:${String(entry.slug)}`;
        insertEntry.run(entryId, id, entry.slug, entry.category, entry.title, entry.summary, entry.content, entry.keywords_json, entry.verification_state, entry.confidence, entry.limitations_json, entry.game_version);
        const sources = previousSources.all(entry.id) as Array<Record<string, unknown>>;
        for (const source of sources) insertSource.run(randomUUID(), entryId, source.title, source.publisher, source.url, source.checked_at, source.source_version, source.notes);
        carriedForward += 1;
      }
    }
    db.prepare(`UPDATE game_datasets SET state='superseded' WHERE dataset_key=? AND state='approved'`).run(dataset.dataset_key);
    db.prepare(`UPDATE game_datasets SET state='approved',approved_at=? WHERE id=?`).run(now, id);
    db.prepare('INSERT INTO knowledge_revisions(id,dataset_id,revision_type,occurred_at,details_json) VALUES (?,?,?,?,?)')
      .run(randomUUID(), id, 'approval', now, JSON.stringify({ previousVersionSuperseded: Boolean(current), carriedForward }));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { status: 200, data: db.prepare('SELECT id,dataset_key,version,state,created_at,approved_at FROM game_datasets WHERE id=?').get(id) };
}

export function listDatasets(db: DatabaseSync): unknown[] {
  return db.prepare(`SELECT d.id,d.dataset_key AS key,d.version,d.state,d.created_at AS createdAt,d.approved_at AS approvedAt,COUNT(e.id) AS entryCount FROM game_datasets d LEFT JOIN knowledge_entries e ON e.dataset_id=d.id GROUP BY d.id ORDER BY d.created_at DESC`).all();
}

function mapEntry(db: DatabaseSync, row: Record<string, unknown>): Record<string, unknown> {
  const sources = db.prepare('SELECT title,publisher,url,checked_at AS checkedAt,source_version AS sourceVersion,notes FROM knowledge_sources WHERE entry_id=? ORDER BY checked_at DESC').all(row.id);
  return {
    id: row.id, slug: row.slug, category: row.category, title: row.title, summary: row.summary, content: row.content,
    keywords: JSON.parse(String(row.keywords_json)), verificationState: row.verification_state, confidence: row.confidence,
    limitations: JSON.parse(String(row.limitations_json)), gameVersion: row.game_version,
    dataset: { key: row.dataset_key, version: row.dataset_version }, sources,
  };
}

export function searchKnowledge(db: DatabaseSync, options: { query: string; category?: string | undefined; verification?: VerificationState | undefined; limit: number; offset: number }): { items: Record<string, unknown>[]; total: number } {
  const clauses = ["d.state='approved'"];
  const params: (string | number)[] = [];
  if (options.category) { clauses.push('e.category=?'); params.push(options.category); }
  if (options.verification) { clauses.push('e.verification_state=?'); params.push(options.verification); }
  const rows = db.prepare(`SELECT e.*,d.dataset_key,d.version AS dataset_version FROM knowledge_entries e JOIN game_datasets d ON d.id=e.dataset_id WHERE ${clauses.join(' AND ')} ORDER BY e.title COLLATE NOCASE`).all(...params) as Array<Record<string, unknown>>;
  const terms = options.query.toLocaleLowerCase().trim().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1);
  const ranked = rows.map((row) => {
    const title = String(row.title).toLocaleLowerCase();
    const summary = String(row.summary).toLocaleLowerCase();
    const content = String(row.content).toLocaleLowerCase();
    const keywords = (JSON.parse(String(row.keywords_json)) as string[]).map((item) => item.toLocaleLowerCase());
    const haystack = `${title} ${summary} ${content} ${keywords.join(' ')}`;
    let score = options.query && title.includes(options.query.toLocaleLowerCase()) ? 10 : 0;
    for (const term of terms) {
      if (title.includes(term)) score += 4;
      if (summary.includes(term)) score += 2;
      if (keywords.some((word) => word.includes(term))) score += 3;
      if (content.includes(term)) score += 1;
    }
    return { row, score, matched: !options.query || terms.length === 0 || score > 0 || haystack.includes(options.query.toLocaleLowerCase()) };
  }).filter((item) => item.matched).sort((a, b) => b.score - a.score || String(a.row.title).localeCompare(String(b.row.title)));
  return { items: ranked.slice(options.offset, options.offset + options.limit).map((item) => mapEntry(db, item.row)), total: ranked.length };
}

export function getKnowledgeEntry(db: DatabaseSync, slug: string): Record<string, unknown> | undefined {
  const row = db.prepare(`SELECT e.*,d.dataset_key,d.version AS dataset_version FROM knowledge_entries e JOIN game_datasets d ON d.id=e.dataset_id WHERE d.state='approved' AND e.slug=? ORDER BY d.approved_at DESC LIMIT 1`).get(slug) as Record<string, unknown> | undefined;
  return row ? mapEntry(db, row) : undefined;
}

export function listKnowledgeRevisions(db: DatabaseSync, datasetId: string): unknown[] {
  return db.prepare('SELECT revision_type AS type,occurred_at AS occurredAt,details_json AS details FROM knowledge_revisions WHERE dataset_id=? ORDER BY occurred_at').all(datasetId).map((row) => ({ ...row, details: JSON.parse(String((row as Record<string, unknown>).details)) }));
}
