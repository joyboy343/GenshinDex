import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import type { DatabaseSync } from 'node:sqlite';

const MAX_COMPRESSED_BYTES = 12 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_COMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_EXPANDED_BYTES = 256 * 1024 * 1024;
const DATASET_KEY = 'genshin-db-character-snapshot';
const SOURCE_URL = 'https://github.com/theBowja/genshin-db-dist';
export const GENSHIN_DB_BROWSE_CATEGORIES = ['weapons', 'artifacts', 'materials', 'enemies', 'domains', 'crafts', 'geographies', 'achievements'] as const;

type JsonRecord = Record<string, unknown>;
type CharacterRecord = { id: string; name: string; raw: JsonRecord; talents: unknown; constellations: unknown; _retainedCategories?: Record<string, string> };
type SourceCategory = 'characters' | 'talents' | 'constellations' | 'weapons' | 'artifacts' | 'materials' | 'enemies' | 'domains' | 'crafts' | 'geographies' | 'achievements';
type CategoryRecord = { key: string; name: string; raw: JsonRecord };
const SOURCE_CATEGORIES = new Set<SourceCategory>(['characters', 'talents', 'constellations', 'weapons', 'artifacts', 'materials', 'enemies', 'domains', 'crafts', 'geographies', 'achievements']);

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizedName(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function isCharacterRecord(value: unknown): value is JsonRecord & { id: string | number; name: string } {
  if (!isRecord(value)) return false;
  const idValid = (typeof value.id === 'string' && value.id.trim().length > 0) || (typeof value.id === 'number' && Number.isFinite(value.id));
  const rarity = Number(value.rarity);
  return idValid && typeof value.name === 'string' && value.name.trim().length > 0 &&
    typeof value.weaponType === 'string' && value.weaponType.length > 0 && typeof value.elementType === 'string' && value.elementType.length > 0 &&
    Number.isInteger(rarity) && rarity >= 4 && rarity <= 5;
}

function findCharacterRecords(input: unknown): JsonRecord[] {
  const found = new Map<string, JsonRecord>();
  const visited = new Set<unknown>();
  const walk = (value: unknown, depth: number) => {
    if (depth > 12 || !value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isCharacterRecord(item)) {
          const id = String(item.id);
          const previous = found.get(id);
          if (previous && JSON.stringify(previous) !== JSON.stringify(item)) throw new Error(`Duplicate character source ID ${id} has conflicting records.`);
          found.set(id, item);
        }
        else walk(item, depth + 1);
      }
      return;
    }
    const record = value as JsonRecord;
    for (const item of Object.values(record)) {
      if (isCharacterRecord(item)) {
        const id = String(item.id);
        const previous = found.get(id);
        if (previous && JSON.stringify(previous) !== JSON.stringify(item)) throw new Error(`Duplicate character source ID ${id} has conflicting records.`);
        found.set(id, item);
      }
      else walk(item, depth + 1);
    }
  };
  walk(input, 0);
  if (found.size < 20) throw new Error(`Expected at least 20 character records in the Genshin-DB character file; found ${found.size}.`);
  if (found.size > 500) throw new Error(`Unsupported character record count (${found.size}); review the source format before importing.`);
  return [...found.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function findCharacterAttachment(input: unknown, characterName: string): unknown {
  const target = normalizedName(characterName);
  const visited = new Set<unknown>();
  const matches: Array<{ depth: number; value: unknown }> = [];
  const walk = (value: unknown, depth: number) => {
    if (depth > 12 || !value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    const record = value as JsonRecord;
    for (const [key, item] of Object.entries(record)) {
      if (normalizedName(key) === target && item && typeof item === 'object') matches.push({ depth: depth + 1, value: item });
      else if (isRecord(item) && typeof item.name === 'string' && normalizedName(item.name) === target) matches.push({ depth: depth + 1, value: item });
      walk(item, depth + 1);
    }
  };
  walk(input, 0);
  return matches.sort((a, b) => a.depth - b.depth)[0]?.value ?? null;
}

function findCategoryRecords(input: unknown, category: SourceCategory): CategoryRecord[] {
  const visited = new Set<unknown>();
  let result: CategoryRecord[] | null = null;
  const walk = (value: unknown, depth: number) => {
    if (result || depth > 10 || !value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      const records = value.filter(isRecord);
      if (records.length >= 5) {
        result = records.map((raw, index) => {
          const name = typeof raw.name === 'string' ? raw.name.trim() : `${category}-${index + 1}`;
          const key = raw.id !== undefined && raw.id !== null ? String(raw.id) : normalizedName(name);
          return { key, name, raw };
        });
        return;
      }
      for (const item of value) walk(item, depth + 1);
      return;
    }
    const entries = Object.entries(value as JsonRecord);
    const recordEntries = entries.filter(([, child]) => isRecord(child) && Object.values(child).some((field) => field === null || ['string', 'number', 'boolean'].includes(typeof field)));
    if (recordEntries.length >= 5) {
      result = recordEntries.map(([entryName, child]) => {
        const raw = child as JsonRecord;
        const name = typeof raw.name === 'string' ? raw.name.trim() : entryName;
        const key = raw.id !== undefined && raw.id !== null ? String(raw.id) : entryName;
        return { key, name, raw };
      });
      return;
    }
    for (const child of Object.values(value as JsonRecord)) walk(child, depth + 1);
  };
  walk(input, 0);
  if (!result?.length) throw new Error(`Could not identify a ${category} record collection in the Genshin-DB file.`);
  if (result.length > 25000) throw new Error(`The ${category} source contains an unsupported number of records (${result.length}).`);
  const keys = new Set<string>();
  for (const record of result) {
    if (!record.key.trim() || !record.name || record.name.length > 240) throw new Error(`A ${category} record has an invalid key or name.`);
    if (keys.has(record.key)) throw new Error(`The ${category} source contains duplicate record key ${record.key}.`);
    keys.add(record.key);
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export function normalizeGenshinDbSnapshot(files: Record<string, Uint8Array>, versionText: string | null = null): { records: CharacterRecord[]; categories: Partial<Record<SourceCategory, CategoryRecord[]>>; version: string; hash: string; sourceRevision: string } {
  const characterFile = Object.keys(files).find((name) => /^english-characters(?:\.min)?\.json(?:\.gzip|\.gz)$/.test(name));
  if (!characterFile) throw new Error('Missing english-characters.min.json.gzip in the staged source folder.');
  const parsedFiles = new Map<string, unknown>();
  const fileHashes: Array<{ name: string; hash: string }> = [];
  let totalCompressedBytes = 0;
  let totalExpandedBytes = 0;
  for (const [name, bytes] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^[a-z0-9][a-z0-9.-]{0,100}$/i.test(name)) throw new Error('Invalid source filename.');
    if (bytes.byteLength > MAX_COMPRESSED_BYTES) throw new Error(`${name} exceeds the 12 MB compressed input limit.`);
    totalCompressedBytes += bytes.byteLength;
    if (totalCompressedBytes > MAX_TOTAL_COMPRESSED_BYTES) throw new Error('Combined compressed input exceeds the 64 MB import limit.');
    let content: Uint8Array;
    if (name.endsWith('.gzip') || name.endsWith('.gz')) {
      try { content = gunzipSync(bytes, { maxOutputLength: MAX_EXPANDED_BYTES }); }
      catch { throw new Error(`${name} is not a supported gzip JSON file or expands beyond 64 MB.`); }
    } else content = bytes;
    if (content.byteLength > MAX_EXPANDED_BYTES) throw new Error(`${name} exceeds the 64 MB expanded input limit.`);
    totalExpandedBytes += content.byteLength;
    if (totalExpandedBytes > MAX_TOTAL_EXPANDED_BYTES) throw new Error('Combined expanded input exceeds the 256 MB import limit.');
    let json: unknown;
    try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content)); }
    catch { throw new Error(`${name} does not contain valid UTF-8 JSON.`); }
    parsedFiles.set(name, json);
    fileHashes.push({ name, hash: createHash('sha256').update(bytes).digest('hex') });
  }
  const characters = findCharacterRecords(parsedFiles.get(characterFile));
  const categories: Partial<Record<SourceCategory, CategoryRecord[]>> = {};
  for (const name of Object.keys(files)) {
    const match = name.match(/^english-([a-z]+)(?:\.min)?\.json(?:\.gzip|\.gz)$/);
    const category = match?.[1] as SourceCategory | undefined;
    if (!category || !SOURCE_CATEGORIES.has(category) || ['characters', 'talents', 'constellations'].includes(category)) continue;
    categories[category] = findCategoryRecords(parsedFiles.get(name), category);
  }
  const talentsFile = Object.keys(files).find((name) => /^english-talents(?:\.min)?\.json(?:\.gzip|\.gz)$/.test(name));
  const constellationsFile = Object.keys(files).find((name) => /^english-constellations(?:\.min)?\.json(?:\.gzip|\.gz)$/.test(name));
  const talents = talentsFile ? parsedFiles.get(talentsFile) : null;
  const constellations = constellationsFile ? parsedFiles.get(constellationsFile) : null;
  const records = characters.map((raw) => {
    const name = String(raw.name).trim();
    return { id: String(raw.id), name, raw, talents: talents ? findCharacterAttachment(talents, name) : null, constellations: constellations ? findCharacterAttachment(constellations, name) : null };
  });
  const hash = createHash('sha256').update(JSON.stringify(fileHashes)).digest('hex');
  const sourceRevision = versionText?.trim().slice(0, 200) || `files:${fileHashes.map((file) => file.name).join(',')}`;
  return { records, categories, version: `sha256-${hash}`, hash, sourceRevision };
}

export function createGenshinDbDraft(db: DatabaseSync, snapshot: ReturnType<typeof normalizeGenshinDbSnapshot>) {
  const active = db.prepare("SELECT id FROM game_datasets WHERE dataset_key=? AND state='approved' ORDER BY approved_at DESC LIMIT 1").get(DATASET_KEY) as { id: string } | undefined;
  const priorRows = active ? db.prepare('SELECT entity_type,entity_key,canonical_json,source_revision FROM game_entities WHERE dataset_id=?').all(active.id) as Array<{ entity_type: string; entity_key: string; canonical_json: string; source_revision: string | null }> : [];
  const prior = new Map(priorRows.map((row) => [`${row.entity_type}:${row.entity_key}`, row]));
  const counts = { added: 0, modified: 0, unchanged: 0 };
  const categoryCounts: Record<string, number> = {};
  const categoryDiffs: Record<string, { added: number; modified: number; unchanged: number }> = {};
  const suppliedKeys = new Set(snapshot.records.map((record) => `genshin-db-character:${record.id}`));
  const characterRecords = snapshot.records.map((character): CharacterRecord => {
    const previousRow = prior.get(`genshin-db-character:${character.id}`);
    if (!previousRow) return character;
    const previous = JSON.parse(previousRow.canonical_json) as CharacterRecord;
    const retainedCategories = { ...(previous._retainedCategories ?? {}) };
    const next = { ...character };
    for (const category of ['talents', 'constellations'] as const) {
      if (next[category] === null && previous[category] !== null) {
        next[category] = previous[category];
        retainedCategories[category] = previous._retainedCategories?.[category] ?? previousRow.source_revision ?? 'source revision unavailable';
      } else delete retainedCategories[category];
    }
    if (Object.keys(retainedCategories).length) next._retainedCategories = retainedCategories;
    else delete next._retainedCategories;
    return next;
  });
  const withoutRetentionMetadata = (value: CharacterRecord) => {
    const { _retainedCategories: _ignored, ...comparable } = value;
    return JSON.stringify(comparable);
  };
  for (const character of characterRecords) {
    const id = character.id;
    const current = prior.get(`genshin-db-character:${id}`);
    if (current === undefined) counts.added += 1;
    else if (withoutRetentionMetadata(JSON.parse(current.canonical_json) as CharacterRecord) === withoutRetentionMetadata(character)) counts.unchanged += 1;
    else counts.modified += 1;
  }
  for (const [category, records] of Object.entries(snapshot.categories)) {
    categoryCounts[category] = records?.length ?? 0;
    for (const record of records ?? []) suppliedKeys.add(`genshin-db-${category}:${record.key}`);
    const diff = categoryDiffs[category] = { added: 0, modified: 0, unchanged: 0 };
    for (const record of records ?? []) {
      const current = prior.get(`genshin-db-${category}:${record.key}`);
      if (current === undefined) diff.added += 1;
      else if (current.canonical_json === JSON.stringify(record)) diff.unchanged += 1;
      else diff.modified += 1;
    }
  }
  const carryForwardCounts: Record<string, number> = {};
  for (const row of priorRows) {
    const key = `${row.entity_type}:${row.entity_key}`;
    if (suppliedKeys.has(key)) continue;
    const category = row.entity_type === 'genshin-db-character' ? 'characters' : row.entity_type.replace(/^genshin-db-/, '');
    carryForwardCounts[category] = (carryForwardCounts[category] ?? 0) + 1;
  }
  const existing = db.prepare('SELECT id,state FROM game_datasets WHERE dataset_key=? AND version=?').get(DATASET_KEY, snapshot.version) as { id: string; state: string } | undefined;
  if (existing) return { datasetId: existing.id, datasetState: existing.state, version: snapshot.version, counts, recordCount: snapshot.records.length, categoryCounts, categoryDiffs, carryForwardCounts };
  const id = randomUUID();
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    const importedCategories = ['characters', ...(snapshot.records.some((record) => record.talents) ? ['talents'] : []), ...(snapshot.records.some((record) => record.constellations) ? ['constellations'] : []), ...Object.keys(snapshot.categories)];
    db.prepare('INSERT INTO game_datasets(id,dataset_key,version,state,provenance_json,created_at) VALUES (?,?,?,\'draft\',?,?)').run(id, DATASET_KEY, snapshot.version, JSON.stringify({ source: 'genshin-db', sourceUrl: SOURCE_URL, sourceRevision: snapshot.sourceRevision, sha256: snapshot.hash, language: 'English', categories: importedCategories, licenseReview: 'pending; do not redistribute until underlying data terms are reviewed' }), now);
    const insert = db.prepare('INSERT INTO game_entities(id,dataset_id,entity_type,entity_key,canonical_json,source_url,source_revision,completeness) VALUES (?,?,?,?,?,?,?,?)');
    for (const record of characterRecords) {
      const sourceRevision = record._retainedCategories ? `${snapshot.sourceRevision}; optional fields retained from an earlier source revision` : snapshot.sourceRevision;
      insert.run(randomUUID(), id, 'genshin-db-character', record.id, JSON.stringify(record), SOURCE_URL, sourceRevision, 'partial');
    }
    for (const [category, records] of Object.entries(snapshot.categories)) for (const record of records ?? []) insert.run(randomUUID(), id, `genshin-db-${category}`, record.key, JSON.stringify(record), SOURCE_URL, snapshot.sourceRevision, 'partial');
    db.prepare('INSERT INTO knowledge_revisions(id,dataset_id,revision_type,occurred_at,details_json) VALUES (?,?,?,?,?)').run(randomUUID(), id, 'import-preview', now, JSON.stringify({ counts, recordCount: snapshot.records.length, categoryCounts, categoryDiffs, carryForwardCounts, sourceRevision: snapshot.sourceRevision, sourceHash: snapshot.hash, optionalCategoriesMissing: { talents: snapshot.records.filter((record) => !record.talents).length, constellations: snapshot.records.filter((record) => !record.constellations).length } }));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { datasetId: id, datasetState: 'draft', version: snapshot.version, counts, recordCount: snapshot.records.length, categoryCounts, categoryDiffs, carryForwardCounts };
}

export function listGenshinDbDrafts(db: DatabaseSync) {
  return db.prepare("SELECT d.id,d.version,d.state,d.created_at AS createdAt,d.provenance_json AS provenance,COUNT(e.id) AS recordCount,(SELECT details_json FROM knowledge_revisions WHERE dataset_id=d.id AND revision_type='import-preview' ORDER BY occurred_at DESC LIMIT 1) AS preview FROM game_datasets d LEFT JOIN game_entities e ON e.dataset_id=d.id AND e.entity_type='genshin-db-character' WHERE d.dataset_key=? AND d.state='draft' GROUP BY d.id ORDER BY d.created_at DESC").all(DATASET_KEY).map((item) => {
    const row = item as Record<string, unknown>;
    return { ...row, provenance: JSON.parse(String(row.provenance)), preview: row.preview ? JSON.parse(String(row.preview)) : null };
  });
}

export function listGenshinDbCharacters(db: DatabaseSync) {
  const dataset = db.prepare("SELECT id,version,approved_at AS approvedAt,provenance_json AS provenance FROM game_datasets WHERE dataset_key=? AND state='approved' ORDER BY approved_at DESC LIMIT 1").get(DATASET_KEY) as Record<string, unknown> | undefined;
  if (!dataset) return { dataset: null, total: 0, items: [] };
  const rows = db.prepare("SELECT canonical_json FROM game_entities WHERE dataset_id=? AND entity_type='genshin-db-character' ORDER BY entity_key").all(dataset.id) as Array<{ canonical_json: string }>;
  return { dataset: { ...dataset, provenance: JSON.parse(String(dataset.provenance)) }, total: rows.length, items: rows.map((row) => JSON.parse(row.canonical_json)) };
}

export function listGenshinDbCategory(db: DatabaseSync, category: typeof GENSHIN_DB_BROWSE_CATEGORIES[number], options: { q?: string; limit?: number; offset?: number } = {}) {
  const entityType = `genshin-db-${category}`;
  const limit = Math.max(1, Math.min(100, Math.trunc(options.limit ?? 50)));
  const offset = Math.max(0, Math.min(50000, Math.trunc(options.offset ?? 0)));
  const query = options.q?.trim().slice(0, 100) ?? '';
  const dataset = db.prepare("SELECT id,version,approved_at AS approvedAt,provenance_json AS provenance FROM game_datasets WHERE dataset_key=? AND state='approved' ORDER BY approved_at DESC LIMIT 1").get(DATASET_KEY) as Record<string, unknown> | undefined;
  if (!dataset) return { dataset: null, category, total: 0, limit, offset, items: [] };
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const where = query ? ' AND (entity_key LIKE ? ESCAPE \'\\\' OR canonical_json LIKE ? ESCAPE \'\\\')' : '';
  const params = query ? [dataset.id, entityType, pattern, pattern] : [dataset.id, entityType];
  const total = Number((db.prepare(`SELECT COUNT(*) AS count FROM game_entities WHERE dataset_id=? AND entity_type=?${where}`).get(...params) as { count: number }).count);
  const rows = db.prepare(`SELECT entity_key AS key,canonical_json AS record FROM game_entities WHERE dataset_id=? AND entity_type=?${where} ORDER BY entity_key LIMIT ? OFFSET ?`).all(...params, limit, offset) as Array<{ key: string; record: string }>;
  return { dataset: { ...dataset, provenance: JSON.parse(String(dataset.provenance)) }, category, total, limit, offset, items: rows.map((row) => ({ key: row.key, ...JSON.parse(row.record) })) };
}

export function approveGenshinDbDraft(db: DatabaseSync, id: string) {
  const dataset = db.prepare("SELECT id,dataset_key,version,state FROM game_datasets WHERE id=? AND dataset_key=?").get(id, DATASET_KEY) as Record<string, unknown> | undefined;
  if (!dataset) return { status: 404, error: { code: 'NOT_FOUND', message: 'Local data import draft not found.' } };
  if (dataset.state === 'approved') return { status: 200, data: dataset };
  if (dataset.state !== 'draft') return { status: 409, error: { code: 'DATASET_NOT_APPROVABLE', message: 'Only a draft local data snapshot can be approved.' } };
  const prior = db.prepare("SELECT id FROM game_datasets WHERE dataset_key=? AND state='approved'").get(DATASET_KEY) as { id: string } | undefined;
  const retained = new Set((db.prepare('SELECT entity_type,entity_key FROM game_entities WHERE dataset_id=?').all(id) as Array<{ entity_type: string; entity_key: string }>).map((row) => `${row.entity_type}:${row.entity_key}`));
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    let carriedForward = 0;
    if (prior) {
      const oldRows = db.prepare('SELECT * FROM game_entities WHERE dataset_id=?').all(prior.id) as Array<Record<string, unknown>>;
      const insert = db.prepare('INSERT INTO game_entities(id,dataset_id,entity_type,entity_key,canonical_json,source_url,source_revision,completeness) VALUES (?,?,?,?,?,?,?,?)');
      for (const row of oldRows) if (!retained.has(`${row.entity_type}:${row.entity_key}`)) { insert.run(randomUUID(), id, row.entity_type, row.entity_key, row.canonical_json, row.source_url, row.source_revision, row.completeness); carriedForward += 1; }
      db.prepare("UPDATE game_datasets SET state='superseded' WHERE id=?").run(prior.id);
    }
    db.prepare("UPDATE game_datasets SET state='approved',approved_at=? WHERE id=?").run(now, id);
    db.prepare('INSERT INTO knowledge_revisions(id,dataset_id,revision_type,occurred_at,details_json) VALUES (?,?,?,?,?)').run(randomUUID(), id, 'approval', now, JSON.stringify({ priorDatasetSuperseded: Boolean(prior), carriedForward }));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { status: 200, data: { id, key: dataset.dataset_key, version: dataset.version, state: 'approved', approvedAt: now } };
}
