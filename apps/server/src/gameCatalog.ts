import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { getEnkaLocalizations } from './enkaLocalization.ts';
import { recordSuccessfulSourceCheck } from './sourceChecks.ts';

const SOURCE_URL = 'https://raw.githubusercontent.com/EnkaNetwork/API-docs/master/store/gi/avatars.json';
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_RECORDS = 2000;
const elementNames: Record<string, string> = { Ice: 'Cryo', Fire: 'Pyro', Electric: 'Electro', Water: 'Hydro', Wind: 'Anemo', Rock: 'Geo', Grass: 'Dendro' };
type CanonicalAvatar = {
  id: string;
  nameTextMapHash: string | null;
  element: string | null;
  weaponType: string | null;
  rarity: number | null;
  sideIconName: string | null;
  skillIds: string[];
  sourceFields: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeAvatarCatalog(input: unknown): CanonicalAvatar[] {
  if (!isRecord(input)) throw new Error('The Enka avatar catalog must be a JSON object keyed by avatar ID.');
  const entries = Object.entries(input);
  if (entries.length < 1 || entries.length > MAX_RECORDS) throw new Error(`The catalog has an unsupported record count (${entries.length}).`);
  const result: CanonicalAvatar[] = [];
  for (const [key, value] of entries) {
    if (!/^\d{4,12}$/.test(key) || !isRecord(value)) continue;
    const element = typeof value.Element === 'string' ? (elementNames[value.Element] ?? value.Element) : null;
    const skills = Array.isArray(value.SkillOrder) ? value.SkillOrder.filter((skill): skill is string | number => typeof skill === 'string' || typeof skill === 'number').map(String) : [];
    const quality = typeof value.QualityType === 'string' ? value.QualityType : '';
    const rarityMatch = quality.match(/(?:^|_)([345])(?:_|$)/);
    const rarityValue = rarityMatch ? Number(rarityMatch[1]) : quality.includes('ORANGE') ? 5 : quality.includes('PURPLE') ? 4 : null;
    result.push({
      id: key,
      nameTextMapHash: value.NameTextMapHash === undefined || value.NameTextMapHash === null ? null : String(value.NameTextMapHash),
      element,
      weaponType: typeof value.WeaponType === 'string' ? value.WeaponType : null,
      rarity: rarityValue !== null && Number.isFinite(rarityValue) ? rarityValue : null,
      sideIconName: typeof value.SideIconName === 'string' ? value.SideIconName : null,
      skillIds: skills,
      sourceFields: value,
    });
  }
  if (result.length < 1) throw new Error('The source did not contain any recognizable avatar definitions.');
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

async function readLimited(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error('The Enka catalog exceeds the 16 MB import limit.');
  if (!response.body) throw new Error('The source returned an empty response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error('The Enka catalog exceeds the 16 MB import limit.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function previewEnkaAvatarCatalog(db: DatabaseSync, fetchImpl: typeof fetch = fetch): Promise<{ datasetId: string; version: string; sourceRevision: string | null; datasetState: string; counts: { added: number; modified: number; unchanged: number }; candidateCharacterCount: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    response = await fetchImpl(SOURCE_URL, { headers: { 'user-agent': 'GenshinDex-local/0.1 (game-data catalog import)', accept: 'application/json' }, redirect: 'error', signal: controller.signal });
  } catch (error) {
    throw new Error(error instanceof Error && error.name === 'AbortError' ? 'Enka catalog request timed out.' : 'Could not reach Enka. Check network access and try again.');
  } finally { clearTimeout(timeout); }
  if (!response.ok) throw new Error(`Enka catalog request failed with HTTP ${response.status}.`);
  const bytes = await readLimited(response);
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Enka returned invalid JSON; no data was imported.'); }
  const records = normalizeAvatarCatalog(parsed);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const version = `sha256-${digest}`;
  const datasetKey = 'enka-avatar-catalog';
  const sourceRevision = response.headers.get('etag') ?? response.headers.get('last-modified');
  recordSuccessfulSourceCheck(db, { sourceId: 'enka-game-store', datasetKey, datasetVersion: version, sourceRevision, contentHash: digest });
  const knownDataset = db.prepare('SELECT id,state FROM game_datasets WHERE dataset_key=? AND version=?').get(datasetKey, version) as { id: string; state: string } | undefined;
  const currentDataset = db.prepare("SELECT id FROM game_datasets WHERE dataset_key=? AND state='approved' ORDER BY approved_at DESC LIMIT 1").get(datasetKey) as { id: string } | undefined;
  const currentRows = currentDataset ? db.prepare("SELECT entity_key,canonical_json FROM game_entities WHERE dataset_id=? AND entity_type='avatar-definition'").all(currentDataset.id) as Array<{ entity_key: string; canonical_json: string }> : [];
  const current = new Map(currentRows.map((row) => [row.entity_key, row.canonical_json]));
  const counts = { added: 0, modified: 0, unchanged: 0 };
  for (const record of records) {
    const before = current.get(record.id);
    const after = JSON.stringify(record);
    if (before === undefined) counts.added += 1;
    else if (before === after) counts.unchanged += 1;
    else counts.modified += 1;
  }
  const datasetId = randomUUID();
  if (knownDataset) return { datasetId: knownDataset.id, version, sourceRevision, datasetState: knownDataset.state, counts, candidateCharacterCount: records.filter((record) => record.element && record.weaponType).length };
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO game_datasets(id,dataset_key,version,state,provenance_json,created_at) VALUES (?,?,?,\'draft\',?,?)')
      .run(datasetId, datasetKey, version, JSON.stringify({ source: SOURCE_URL, sourceRevision, sha256: digest, recordCount: records.length }), now);
    const insert = db.prepare('INSERT INTO game_entities(id,dataset_id,entity_type,entity_key,canonical_json,source_url,source_revision,completeness) VALUES (?,?,?,?,?,?,?,?)');
    for (const record of records) insert.run(randomUUID(), datasetId, 'avatar-definition', record.id, JSON.stringify(record), SOURCE_URL, sourceRevision, 'partial');
    db.prepare('INSERT INTO knowledge_revisions(id,dataset_id,revision_type,occurred_at,details_json) VALUES (?,?,?,?,?)')
      .run(randomUUID(), datasetId, 'import-preview', now, JSON.stringify({ counts, recordCount: records.length, sourceRevision, sha256: digest }));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { datasetId, version, sourceRevision, datasetState: 'draft', counts, candidateCharacterCount: records.filter((record) => record.element && record.weaponType).length };
}

export function listCharacterCatalog(db: DatabaseSync, language = 'en'): { dataset: unknown | null; total: number; items: Array<CanonicalAvatar & { displayName: string | null }>; localization: { dataset: unknown | null; language: string } } {
  const localization = getEnkaLocalizations(db, language);
  const dataset = db.prepare("SELECT id,version,approved_at AS approvedAt,provenance_json AS provenance FROM game_datasets WHERE dataset_key='enka-avatar-catalog' AND state='approved' ORDER BY approved_at DESC LIMIT 1").get() as Record<string, unknown> | undefined;
  if (!dataset) return { dataset: null, total: 0, items: [], localization: { dataset: localization.dataset, language: localization.language } };
  const rows = db.prepare("SELECT canonical_json FROM game_entities WHERE dataset_id=? AND entity_type='avatar-definition' ORDER BY CAST(entity_key AS INTEGER)").all(dataset.id) as Array<{ canonical_json: string }>;
  return { dataset: { ...dataset, provenance: JSON.parse(String(dataset.provenance)) }, total: rows.length, items: rows.map((row) => {
    const avatar = JSON.parse(row.canonical_json) as CanonicalAvatar;
    return { ...avatar, displayName: avatar.nameTextMapHash ? localization.texts[avatar.nameTextMapHash] ?? null : null };
  }), localization: { dataset: localization.dataset, language: localization.language } };
}

export function approveGameCatalog(db: DatabaseSync, id: string): { status: number; error?: { code: string; message: string }; data?: unknown } {
  const dataset = db.prepare("SELECT id,dataset_key,version,state,created_at FROM game_datasets WHERE id=? AND dataset_key='enka-avatar-catalog'").get(id) as Record<string, unknown> | undefined;
  if (!dataset) return { status: 404, error: { code: 'NOT_FOUND', message: 'Catalog preview not found.' } };
  if (dataset.state === 'approved') return { status: 200, data: dataset };
  if (dataset.state !== 'draft') return { status: 409, error: { code: 'DATASET_NOT_APPROVABLE', message: 'Only a draft catalog can be approved.' } };
  const prior = db.prepare("SELECT id FROM game_datasets WHERE dataset_key='enka-avatar-catalog' AND state='approved'").get() as { id: string } | undefined;
  const incoming = new Set((db.prepare("SELECT entity_key FROM game_entities WHERE dataset_id=? AND entity_type='avatar-definition'").all(id) as Array<{ entity_key: string }>).map((row) => row.entity_key));
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    let carriedForward = 0;
    if (prior) {
      const previous = db.prepare("SELECT * FROM game_entities WHERE dataset_id=? AND entity_type='avatar-definition'").all(prior.id) as Array<Record<string, unknown>>;
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
