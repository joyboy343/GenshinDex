import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

const SOURCE_URL = 'https://github.com/EnkaNetwork/API-docs/blob/master/store/gi/locs.json';
const DATASET_KEY = 'enka-localization-catalog';
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_RECORDS = 100_000;
const languageAliases: Record<string, string> = {
  en: 'en', 'en-us': 'en', english: 'en', ru: 'ru', 'ru-ru': 'ru', vi: 'vi', 'vi-vn': 'vi', th: 'th', 'th-th': 'th',
  pt: 'pt', 'pt-pt': 'pt', kr: 'kr', ko: 'kr', 'ko-kr': 'kr', jp: 'jp', ja: 'jp', 'ja-jp': 'jp', zh: 'zh', chs: 'chs', 'zh-cn': 'chs', cht: 'cht', 'zh-tw': 'cht',
  id: 'id', 'id-id': 'id', fr: 'fr', 'fr-fr': 'fr', es: 'es', 'es-es': 'es', de: 'de', 'de-de': 'de', it: 'it', 'it-it': 'it', tr: 'tr', 'tr-tr': 'tr',
};

type LocalizationRecord = { key: string; language: string; text: string };
type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeEnkaLanguage(value: string): string | null {
  return languageAliases[value.trim().toLowerCase()] ?? null;
}

export function normalizeEnkaLocalizations(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_BYTES) throw new Error('Enka localization input exceeds the 8 MB limit.');
  let input: unknown;
  try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('Enka localization data is not valid UTF-8 JSON.'); }
  if (!isRecord(input)) throw new Error('Enka localization data must be a JSON object.');
  const records = new Map<string, LocalizationRecord>();
  const add = (key: string, language: string, text: unknown) => {
    const normalizedLanguage = normalizeEnkaLanguage(language);
    if (!normalizedLanguage || typeof text !== 'string') return;
    const label = text.trim();
    if (!key || key.length > 100 || !label || label.length > 4000) return;
    const compound = `${normalizedLanguage}:${key}`;
    const previous = records.get(compound);
    if (previous && previous.text !== label) throw new Error(`Conflicting Enka localization values for ${normalizedLanguage}:${key}.`);
    records.set(compound, { key, language: normalizedLanguage, text: label });
  };

  for (const [outerKey, value] of Object.entries(input)) {
    const outerLanguage = normalizeEnkaLanguage(outerKey);
    if (outerLanguage && isRecord(value)) {
      for (const [key, text] of Object.entries(value)) add(key, outerLanguage, text);
      continue;
    }
    if (isRecord(value)) {
      for (const [language, text] of Object.entries(value)) add(outerKey, language, text);
    }
  }
  if (records.size < 20) throw new Error(`Expected at least 20 recognizable localized strings; found ${records.size}. Check the Enka locs.json format.`);
  if (records.size > MAX_RECORDS) throw new Error(`Enka localization contains an unsupported number of entries (${records.size}).`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  return { records: [...records.values()].sort((a, b) => a.language.localeCompare(b.language) || a.key.localeCompare(b.key)), hash, version: `sha256-${hash}`, sourceRevision: `sha256-${hash}` };
}

export function createEnkaLocalizationDraft(db: DatabaseSync, snapshot: ReturnType<typeof normalizeEnkaLocalizations>) {
  const active = db.prepare("SELECT id FROM game_datasets WHERE dataset_key=? AND state='approved' ORDER BY approved_at DESC LIMIT 1").get(DATASET_KEY) as { id: string } | undefined;
  const priorRows = active ? db.prepare("SELECT entity_key,canonical_json FROM game_entities WHERE dataset_id=? AND entity_type='enka-localization'").all(active.id) as Array<{ entity_key: string; canonical_json: string }> : [];
  const prior = new Map(priorRows.map((row) => [row.entity_key, row.canonical_json]));
  const counts = { added: 0, modified: 0, unchanged: 0 };
  const languages = new Set<string>();
  for (const record of snapshot.records) {
    languages.add(record.language);
    const key = `${record.language}:${record.key}`;
    const current = prior.get(key);
    const next = JSON.stringify(record);
    if (current === undefined) counts.added += 1;
    else if (current === next) counts.unchanged += 1;
    else counts.modified += 1;
  }
  const known = db.prepare('SELECT id,state FROM game_datasets WHERE dataset_key=? AND version=?').get(DATASET_KEY, snapshot.version) as { id: string; state: string } | undefined;
  if (known) return { datasetId: known.id, datasetState: known.state, version: snapshot.version, recordCount: snapshot.records.length, languages: [...languages].sort(), counts };
  const id = randomUUID();
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO game_datasets(id,dataset_key,version,state,provenance_json,created_at) VALUES (?,?,?,\'draft\',?,?)').run(id, DATASET_KEY, snapshot.version, JSON.stringify({ source: 'enka-api-docs-localizations', sourceUrl: SOURCE_URL, sourceRevision: snapshot.sourceRevision, sha256: snapshot.hash, languages: [...languages].sort(), licenseReview: 'pending; local source candidate' }), now);
    const insert = db.prepare('INSERT INTO game_entities(id,dataset_id,entity_type,entity_key,canonical_json,source_url,source_revision,completeness) VALUES (?,?,?,?,?,?,?,?)');
    for (const record of snapshot.records) insert.run(randomUUID(), id, 'enka-localization', `${record.language}:${record.key}`, JSON.stringify(record), SOURCE_URL, snapshot.sourceRevision, 'partial');
    db.prepare('INSERT INTO knowledge_revisions(id,dataset_id,revision_type,occurred_at,details_json) VALUES (?,?,?,?,?)').run(randomUUID(), id, 'import-preview', now, JSON.stringify({ counts, recordCount: snapshot.records.length, languages: [...languages].sort(), sourceHash: snapshot.hash }));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { datasetId: id, datasetState: 'draft', version: snapshot.version, recordCount: snapshot.records.length, languages: [...languages].sort(), counts };
}

export function listEnkaLocalizationDrafts(db: DatabaseSync) {
  return db.prepare("SELECT d.id,d.version,d.state,d.created_at AS createdAt,d.provenance_json AS provenance,(SELECT details_json FROM knowledge_revisions WHERE dataset_id=d.id AND revision_type='import-preview' ORDER BY occurred_at DESC LIMIT 1) AS preview FROM game_datasets d WHERE d.dataset_key=? AND d.state='draft' ORDER BY d.created_at DESC").all(DATASET_KEY).map((value) => {
    const row = value as Record<string, unknown>;
    return { ...row, provenance: JSON.parse(String(row.provenance)), preview: row.preview ? JSON.parse(String(row.preview)) : null };
  });
}

export function approveEnkaLocalizationDraft(db: DatabaseSync, id: string) {
  const dataset = db.prepare('SELECT id,dataset_key,version,state FROM game_datasets WHERE id=? AND dataset_key=?').get(id, DATASET_KEY) as Record<string, unknown> | undefined;
  if (!dataset) return { status: 404, error: { code: 'NOT_FOUND', message: 'Enka localization draft not found.' } };
  if (dataset.state === 'approved') return { status: 200, data: dataset };
  if (dataset.state !== 'draft') return { status: 409, error: { code: 'DATASET_NOT_APPROVABLE', message: 'Only a draft Enka localization dataset can be approved.' } };
  const prior = db.prepare("SELECT id FROM game_datasets WHERE dataset_key=? AND state='approved'").get(DATASET_KEY) as { id: string } | undefined;
  const incoming = new Set((db.prepare("SELECT entity_key FROM game_entities WHERE dataset_id=? AND entity_type='enka-localization'").all(id) as Array<{ entity_key: string }>).map((row) => row.entity_key));
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    let carriedForward = 0;
    if (prior) {
      const previous = db.prepare("SELECT * FROM game_entities WHERE dataset_id=? AND entity_type='enka-localization'").all(prior.id) as Array<Record<string, unknown>>;
      const insert = db.prepare('INSERT INTO game_entities(id,dataset_id,entity_type,entity_key,canonical_json,source_url,source_revision,completeness) VALUES (?,?,?,?,?,?,?,?)');
      for (const row of previous) if (!incoming.has(String(row.entity_key))) {
        insert.run(randomUUID(), id, row.entity_type, row.entity_key, row.canonical_json, row.source_url, row.source_revision, row.completeness);
        carriedForward += 1;
      }
      db.prepare("UPDATE game_datasets SET state='superseded' WHERE id=?").run(prior.id);
    }
    db.prepare("UPDATE game_datasets SET state='approved',approved_at=? WHERE id=?").run(now, id);
    db.prepare('INSERT INTO knowledge_revisions(id,dataset_id,revision_type,occurred_at,details_json) VALUES (?,?,?,?,?)').run(randomUUID(), id, 'approval', now, JSON.stringify({ priorDatasetSuperseded: Boolean(prior), carriedForward }));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { status: 200, data: { id, key: dataset.dataset_key, version: dataset.version, state: 'approved', approvedAt: now } };
}

export function getEnkaLocalizations(db: DatabaseSync, language = 'en'): { dataset: unknown | null; language: string; texts: Record<string, string> } {
  const normalized = normalizeEnkaLanguage(language);
  if (!normalized) return { dataset: null, language, texts: {} };
  const dataset = db.prepare("SELECT id,version,approved_at AS approvedAt,provenance_json AS provenance FROM game_datasets WHERE dataset_key=? AND state='approved' ORDER BY approved_at DESC LIMIT 1").get(DATASET_KEY) as Record<string, unknown> | undefined;
  if (!dataset) return { dataset: null, language: normalized, texts: {} };
  const prefix = `${normalized}:%`;
  const rows = db.prepare("SELECT entity_key,canonical_json FROM game_entities WHERE dataset_id=? AND entity_type='enka-localization' AND entity_key LIKE ?").all(dataset.id, prefix) as Array<{ entity_key: string; canonical_json: string }>;
  const texts: Record<string, string> = {};
  for (const row of rows) {
    const record = JSON.parse(row.canonical_json) as LocalizationRecord;
    texts[record.key] = record.text;
  }
  return { dataset: { ...dataset, provenance: JSON.parse(String(dataset.provenance)) }, language: normalized, texts };
}

export function getEnkaLocalizationStatus(db: DatabaseSync, language = 'en') {
  const normalized = normalizeEnkaLanguage(language);
  if (!normalized) return { dataset: null, language, total: 0 };
  const dataset = db.prepare("SELECT id,version,approved_at AS approvedAt FROM game_datasets WHERE dataset_key=? AND state='approved' ORDER BY approved_at DESC LIMIT 1").get(DATASET_KEY) as Record<string, unknown> | undefined;
  if (!dataset) return { dataset: null, language: normalized, total: 0 };
  const count = Number((db.prepare("SELECT COUNT(*) AS count FROM game_entities WHERE dataset_id=? AND entity_type='enka-localization' AND entity_key LIKE ?").get(dataset.id, `${normalized}:%`) as { count: number }).count);
  return { dataset, language: normalized, total: count };
}
