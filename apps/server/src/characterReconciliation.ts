import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { getEnkaLocalizations } from './enkaLocalization.ts';

type Source = { sourceId: string; key: string; name: string | null; url: string; revision: string | null; version: string };
type CatalogCharacter = { id?: unknown; name?: unknown; raw?: Record<string, unknown>; talents?: unknown; constellations?: unknown };
type EnkaCharacter = { id?: unknown; nameTextMapHash?: unknown; element?: unknown; weaponType?: unknown; rarity?: unknown; displayName?: unknown };
type GuidePage = { slug?: unknown; displayName?: unknown; pageUrl?: unknown };
type FieldValue = { sourceId: string; raw: string | number; normalized: string | number };
const MATCHER_VERSION = 'character-match-v1';

function normalizedName(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function normalizeElement(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const input = value.trim().toUpperCase().replace(/^ELEMENT_/, '');
  const normalized = ({ WIND: 'ANEMO', ICE: 'CRYO', ELECTRIC: 'ELECTRO', ROCK: 'GEO', GRASS: 'DENDRO' } as Record<string, string>)[input] ?? input;
  return ['ANEMO', 'CRYO', 'DENDRO', 'ELECTRO', 'GEO', 'HYDRO', 'PYRO'].includes(normalized) ? normalized[0]! + normalized.slice(1).toLowerCase() : null;
}

function normalizeWeapon(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const input = value.trim().toUpperCase().replace(/^WEAPON_/, '');
  const normalized = ({ SWORD_ONE_HAND: 'Sword', POLE: 'Polearm', POLEARM: 'Polearm' } as Record<string, string>)[input] ?? input;
  const title = normalized[0] + normalized.slice(1).toLowerCase();
  return ['Bow', 'Catalyst', 'Claymore', 'Polearm', 'Sword'].includes(title) ? title : null;
}

function rarity(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : null;
}

function sourceField(sourceId: string, raw: unknown, normalized: string | number | null): FieldValue | null {
  return normalized === null ? null : { sourceId, raw: typeof raw === 'string' || typeof raw === 'number' ? raw : String(raw), normalized };
}

function entityDataset(db: DatabaseSync, key: string, entityType: string) {
  const dataset = db.prepare("SELECT id,version,provenance_json AS provenance FROM game_datasets WHERE dataset_key=? AND state='approved' ORDER BY approved_at DESC LIMIT 1").get(key) as { id: string; version: string; provenance: string } | undefined;
  if (!dataset) return { dataset: null, items: [] as Array<{ value: Record<string, unknown>; source: Source }> };
  const provenance = JSON.parse(dataset.provenance) as Record<string, unknown>;
  const rows = db.prepare('SELECT entity_key,canonical_json,source_url,source_revision FROM game_entities WHERE dataset_id=? AND entity_type=? ORDER BY entity_key').all(dataset.id, entityType) as Array<{ entity_key: string; canonical_json: string; source_url: string; source_revision: string | null }>;
  return {
    dataset: { version: dataset.version, sourceRevision: typeof provenance.sourceRevision === 'string' ? provenance.sourceRevision : null, recordCount: rows.length },
    items: rows.map((row) => ({ value: JSON.parse(row.canonical_json) as Record<string, unknown>, source: { sourceId: key.startsWith('genshin-db') ? 'genshin-db' : key.startsWith('enka') ? 'enka-game-store' : 'kqm-theorycrafting-library', key: row.entity_key, name: null, url: row.source_url, revision: row.source_revision, version: dataset.version } })),
  };
}

export function buildCharacterReconciliation(input: {
  genshinDb: { dataset: { version: string; sourceRevision: string | null; recordCount: number } | null; items: Array<{ value: CatalogCharacter; source: Source }> };
  enka: { dataset: { version: string; sourceRevision: string | null; recordCount: number } | null; items: Array<{ value: EnkaCharacter; source: Source }> };
  guides: { dataset: { version: string; sourceRevision: string | null; recordCount: number } | null; items: Array<{ value: GuidePage; source: Source }> };
  localizations: Record<string, string>;
  localizationsDataset?: { version: string; sourceRevision: string | null; recordCount: number } | null;
}) {
  const enkaById = new Map<string, Array<{ value: EnkaCharacter; source: Source; displayName: string | null }>>();
  const enkaByName = new Map<string, Array<{ value: EnkaCharacter; source: Source; displayName: string | null }>>();
  const enkaRows = input.enka.items.map((item) => {
    const hash = item.value.nameTextMapHash == null ? null : String(item.value.nameTextMapHash);
    const displayName = hash ? input.localizations[hash] ?? null : null;
    const enriched = { ...item, displayName };
    const id = item.value.id == null ? '' : String(item.value.id);
    if (id) enkaById.set(id, [...(enkaById.get(id) ?? []), enriched]);
    if (displayName) {
      const key = normalizedName(displayName);
      if (key) enkaByName.set(key, [...(enkaByName.get(key) ?? []), enriched]);
    }
    return enriched;
  });
  const guideByName = new Map<string, Array<{ value: GuidePage; source: Source }>>();
  const linkedGuideKeys = new Set<string>();
  for (const item of input.guides.items) {
    if (typeof item.value.displayName !== 'string') continue;
    const key = normalizedName(item.value.displayName);
    if (key) guideByName.set(key, [...(guideByName.get(key) ?? []), item]);
  }

  const usedEnkaKeys = new Set<string>();
  const candidates: Array<Record<string, unknown>> = [];
  const makeCandidate = (gdb: { value: CatalogCharacter; source: Source } | null, enka: typeof enkaRows[number] | null, possibleEnka: typeof enkaRows, status: string) => {
    const gdbRaw = gdb?.value.raw ?? {};
    const gdbName = typeof gdb?.value.name === 'string' ? gdb.value.name : null;
    const enkaName = enka?.displayName ?? null;
    const displayName = gdbName ?? enkaName ?? (typeof enka?.source.name === 'string' ? enka.source.name : null) ?? String(gdb?.value.id ?? enka?.value.id ?? 'Unknown character');
    const nameMatch = gdbName && enkaName && normalizedName(gdbName) === normalizedName(enkaName);
    const sourceRecords: Source[] = [];
    if (gdb) sourceRecords.push({ ...gdb.source, name: gdbName });
    if (enka) sourceRecords.push({ ...enka.source, name: enkaName });
    const guideCandidates = new Map<string, { value: GuidePage; source: Source }>();
    for (const name of [gdbName, enkaName]) {
      if (!name) continue;
      for (const guide of guideByName.get(normalizedName(name)) ?? []) { guideCandidates.set(guide.source.key, guide); linkedGuideKeys.add(guide.source.key); }
    }
    const guidePages = [...guideCandidates.values()].map((guide) => ({ slug: guide.value.slug, displayName: guide.value.displayName, pageUrl: guide.value.pageUrl, sourceVersion: guide.source.version }));

    const fieldEvidence: Record<string, FieldValue[]> = {};
    const addEvidence = (field: string, value: FieldValue | null) => {
      if (value) fieldEvidence[field] = [...(fieldEvidence[field] ?? []), value];
    };
    addEvidence('name', sourceField('genshin-db', gdbName, gdbName ? normalizedName(gdbName) : null));
    addEvidence('name', sourceField('enka-game-store', enkaName, enkaName ? normalizedName(enkaName) : null));
    addEvidence('element', gdb ? sourceField('genshin-db', gdbRaw.elementType, normalizeElement(gdbRaw.elementType)) : null);
    addEvidence('element', enka ? sourceField('enka-game-store', enka.value.element, normalizeElement(enka.value.element)) : null);
    addEvidence('weaponType', gdb ? sourceField('genshin-db', gdbRaw.weaponType, normalizeWeapon(gdbRaw.weaponType)) : null);
    addEvidence('weaponType', enka ? sourceField('enka-game-store', enka.value.weaponType, normalizeWeapon(enka.value.weaponType)) : null);
    addEvidence('rarity', gdb ? sourceField('genshin-db', gdbRaw.rarity, rarity(gdbRaw.rarity)) : null);
    addEvidence('rarity', enka ? sourceField('enka-game-store', enka.value.rarity, rarity(enka.value.rarity)) : null);
    const fields = Object.fromEntries(Object.entries(fieldEvidence).filter(([, values]) => values.length >= 2));
    const rawConflicts = Object.entries(fields).filter(([, values]) => new Set(values.map((value) => value.normalized)).size > 1);
    if (enka) usedEnkaKeys.add(enka.source.key);
    const sourceRefs = sourceRecords.map((source) => ({ sourceId: source.sourceId, key: source.key, version: source.version })).sort((a, b) => `${a.sourceId}:${a.key}`.localeCompare(`${b.sourceId}:${b.key}`));
    const reviewFingerprint = gdb && enka && ['id-match', 'name-match'].includes(status) ? createHash('sha256').update(JSON.stringify({ algorithm: MATCHER_VERSION, sourceRefs, localizationVersion: input.localizationsDataset?.version ?? null, method: status })).digest('hex') : null;
    const conflicts = rawConflicts.map(([field, values]) => ({
      field,
      fingerprint: reviewFingerprint ? createHash('sha256').update(JSON.stringify({ algorithm: 'character-field-review-v1', characterFingerprint: reviewFingerprint, field, sourceRefs, values })).digest('hex') : null,
      values,
      review: null as Record<string, unknown> | null,
    }));
    return {
      candidateId: gdb ? `genshin-db:${gdb.source.key}` : `enka:${enka?.source.key ?? possibleEnka.map((item) => item.source.key).join(',')}`,
      displayName,
      status,
      matchedBy: status === 'id-match' ? 'exact numeric source ID' : status === 'name-match' ? 'unique normalized English name' : null,
      possibleMatches: possibleEnka.map((item) => ({ sourceKey: item.source.key, displayName: item.displayName, sourceId: String(item.value.id ?? '') })),
      sources: sourceRecords,
      fieldEvidence,
      reviewFingerprint,
      review: null,
      fields,
      conflicts,
      guideReferences: guidePages,
      guideReferenceMeaning: 'A matching KQM TCL page is reference coverage only; it does not confirm playable-roster membership or endorse a build.',
    };
  };

  for (const gdb of input.genshinDb.items) {
    const id = gdb.value.id == null ? '' : String(gdb.value.id);
    const exactIdMatches = /^\d+$/.test(id) ? enkaById.get(id) ?? [] : [];
    let matched: typeof enkaRows[number] | null = exactIdMatches.length === 1 ? exactIdMatches[0]! : null;
    let status = matched ? 'id-match' : 'gdb-only';
    let possibleEnka = exactIdMatches;
    if (!matched && exactIdMatches.length > 1) status = 'ambiguous-id';
    if (!matched && !exactIdMatches.length && typeof gdb.value.name === 'string') {
      possibleEnka = enkaByName.get(normalizedName(gdb.value.name)) ?? [];
      if (possibleEnka.length === 1) { matched = possibleEnka[0]!; status = 'name-match'; }
      else if (possibleEnka.length > 1) status = 'ambiguous-name';
    }
    candidates.push(makeCandidate(gdb, matched, possibleEnka, status));
  }
  for (const enka of enkaRows) if (!usedEnkaKeys.has(enka.source.key)) candidates.push(makeCandidate(null, enka, [enka], 'enka-only'));
  const unmatchedGuideReferences = input.guides.items.filter((item) => !linkedGuideKeys.has(item.source.key)).map(({ value, source }) => ({ slug: value.slug, displayName: value.displayName, pageUrl: value.pageUrl, sourceVersion: source.version }));
  candidates.sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
  const summary: Record<string, unknown> = {
    genshinDbCharacters: input.genshinDb.dataset?.recordCount ?? 0,
    enkaAvatarDefinitions: input.enka.dataset?.recordCount ?? 0,
    guideReferencePages: input.guides.dataset?.recordCount ?? 0,
    matchedById: candidates.filter((candidate) => candidate.status === 'id-match').length,
    matchedByName: candidates.filter((candidate) => candidate.status === 'name-match').length,
    ambiguous: candidates.filter((candidate) => String(candidate.status).startsWith('ambiguous')).length,
    conflicts: candidates.filter((candidate) => (candidate.conflicts as unknown[]).length > 0).length,
    unmatchedEnka: candidates.filter((candidate) => candidate.status === 'enka-only').length,
    unmatchedGuideReferencePages: unmatchedGuideReferences.length,
  };
  return {
    sourceDatasets: { genshinDb: input.genshinDb.dataset, enka: input.enka.dataset, enkaLocalizations: input.localizationsDataset ?? null, kqmTcl: input.guides.dataset },
    summary,
    items: candidates,
    unmatchedGuideReferences,
    policy: 'Computed candidate links only. No records are merged, promoted, or mutated. Hash IDs take precedence; unique normalized names are weaker suggestions. Missing source data is unknown, not zero coverage.',
  };
}

export function getCharacterReconciliation(db: DatabaseSync) {
  const genshinDb = entityDataset(db, 'genshin-db-character-snapshot', 'genshin-db-character');
  const enka = entityDataset(db, 'enka-avatar-catalog', 'avatar-definition');
  const guides = entityDataset(db, 'kqm-character-reference-index', 'kqm-character-reference');
  const localizations = getEnkaLocalizations(db, 'en');
  const localizationDataset = localizations.dataset as { version?: unknown; provenance?: unknown } | null;
  const localizationProvenance = localizationDataset?.provenance && typeof localizationDataset.provenance === 'object' ? localizationDataset.provenance as Record<string, unknown> : {};
  const report = buildCharacterReconciliation({
    genshinDb: { dataset: genshinDb.dataset, items: genshinDb.items.map((item) => ({ value: item.value as CatalogCharacter, source: item.source })) },
    enka: { dataset: enka.dataset, items: enka.items.map((item) => ({ value: item.value as EnkaCharacter, source: item.source })) },
    guides: { dataset: guides.dataset, items: guides.items.map((item) => ({ value: item.value as GuidePage, source: item.source })) },
    localizations: localizations.texts,
    localizationsDataset: typeof localizationDataset?.version === 'string' ? { version: localizationDataset.version, sourceRevision: typeof localizationProvenance.sourceRevision === 'string' ? localizationProvenance.sourceRevision : null, recordCount: Object.keys(localizations.texts).length } : null,
  });
  const fingerprints = report.items.map((item) => item.reviewFingerprint).filter((value): value is string => typeof value === 'string');
  const decisions = fingerprints.length ? db.prepare(`SELECT fingerprint,decision,note,reviewed_at AS reviewedAt,updated_at AS updatedAt FROM character_link_reviews WHERE fingerprint IN (${fingerprints.map(() => '?').join(',')})`).all(...fingerprints) as Array<Record<string, unknown>> : [];
  const byFingerprint = new Map(decisions.map((review) => [String(review.fingerprint), review]));
  const reviewCounts = { accepted: 0, rejected: 0, deferred: 0, unreviewed: 0 };
  for (const item of report.items) {
    if (typeof item.reviewFingerprint !== 'string') continue;
    const review = byFingerprint.get(item.reviewFingerprint);
    if (review) {
      item.review = review;
      const decision = String(review.decision);
      if (decision === 'accepted' || decision === 'rejected' || decision === 'deferred') reviewCounts[decision] += 1;
    } else reviewCounts.unreviewed += 1;
  }
  const fieldFingerprints = report.items.flatMap((item) => (item.conflicts as Array<Record<string, unknown>>).map((conflict) => conflict.fingerprint).filter((value): value is string => typeof value === 'string'));
  const fieldDecisions = fieldFingerprints.length ? db.prepare(`SELECT fingerprint,decision,selected_source_id AS selectedSourceId,selected_value_json AS selectedValue,note,updated_at AS updatedAt FROM character_field_reviews WHERE fingerprint IN (${fieldFingerprints.map(() => '?').join(',')})`).all(...fieldFingerprints) as Array<Record<string, unknown>> : [];
  const fieldByFingerprint = new Map(fieldDecisions.map((review) => [String(review.fingerprint), { ...review, selectedValue: review.selectedValue == null ? null : JSON.parse(String(review.selectedValue)) }]));
  const fieldReviewCounts = { selectedSource: 0, deferred: 0, unreviewed: 0 };
  for (const item of report.items) for (const conflict of item.conflicts as Array<Record<string, unknown>>) {
    if (typeof conflict.fingerprint !== 'string') continue;
    const review = fieldByFingerprint.get(conflict.fingerprint);
    if (review) {
      conflict.review = review;
      if (review.decision === 'selected-source') fieldReviewCounts.selectedSource += 1;
      else if (review.decision === 'deferred') fieldReviewCounts.deferred += 1;
    } else fieldReviewCounts.unreviewed += 1;
  }
  return { ...report, summary: { ...report.summary, reviewableLinks: fingerprints.length, reviews: reviewCounts, fieldReviews: fieldReviewCounts } };
}

export function saveCharacterLinkReview(db: DatabaseSync, input: { fingerprint: string; decision: 'accepted' | 'rejected' | 'deferred'; note: string; evidence: Record<string, unknown> }) {
  const now = new Date().toISOString();
  const evidenceJson = JSON.stringify(input.evidence);
  db.exec('BEGIN IMMEDIATE');
  try {
    const previous = db.prepare('SELECT decision,note FROM character_link_reviews WHERE fingerprint=?').get(input.fingerprint) as { decision: string; note: string | null } | undefined;
    db.prepare('INSERT INTO character_link_reviews(fingerprint,decision,note,evidence_json,reviewed_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(fingerprint) DO UPDATE SET decision=excluded.decision,note=excluded.note,evidence_json=excluded.evidence_json,reviewed_at=excluded.reviewed_at,updated_at=excluded.updated_at').run(input.fingerprint, input.decision, input.note || null, evidenceJson, now, now);
    db.prepare('INSERT INTO character_link_review_history(id,fingerprint,previous_decision,decision,note,evidence_json,changed_at) VALUES (?,?,?,?,?,?,?)').run(randomUUID(), input.fingerprint, previous?.decision ?? null, input.decision, input.note || null, evidenceJson, now);
    db.prepare('INSERT INTO activity_events(id,event_type,occurred_at,details_json) VALUES (?,?,?,?)').run(randomUUID(), 'reconciliation.link-reviewed', now, JSON.stringify({ fingerprint: input.fingerprint, decision: input.decision }));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { fingerprint: input.fingerprint, decision: input.decision, note: input.note || null, reviewedAt: now, updatedAt: now };
}

export function listCharacterLinkReviewHistory(db: DatabaseSync, fingerprint: string) {
  // Timestamps can share millisecond precision when decisions are saved quickly;
  // rowid preserves the append order and keeps the newest decision first.
  return db.prepare('SELECT id,fingerprint,previous_decision AS previousDecision,decision,note,evidence_json AS evidence,changed_at AS changedAt FROM character_link_review_history WHERE fingerprint=? ORDER BY rowid DESC').all(fingerprint).map((value) => {
    const row = value as Record<string, unknown>;
    return { ...row, evidence: JSON.parse(String(row.evidence)) };
  });
}

export function saveCharacterFieldReview(db: DatabaseSync, input: { fingerprint: string; characterFingerprint: string; field: string; decision: 'selected-source' | 'deferred'; selectedSourceId: string | null; selectedValue: string | number | null; note: string; evidence: Record<string, unknown> }) {
  const now = new Date().toISOString();
  const evidenceJson = JSON.stringify(input.evidence);
  const selectedValueJson = input.selectedValue === null ? null : JSON.stringify(input.selectedValue);
  db.exec('BEGIN IMMEDIATE');
  try {
    const previous = db.prepare('SELECT decision FROM character_field_reviews WHERE fingerprint=?').get(input.fingerprint) as { decision: string } | undefined;
    db.prepare(`INSERT INTO character_field_reviews(fingerprint,character_fingerprint,field_name,decision,selected_source_id,selected_value_json,note,evidence_json,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(fingerprint) DO UPDATE SET decision=excluded.decision,selected_source_id=excluded.selected_source_id,
      selected_value_json=excluded.selected_value_json,note=excluded.note,evidence_json=excluded.evidence_json,updated_at=excluded.updated_at`)
      .run(input.fingerprint, input.characterFingerprint, input.field, input.decision, input.selectedSourceId, selectedValueJson, input.note || null, evidenceJson, now);
    db.prepare(`INSERT INTO character_field_review_history(id,fingerprint,character_fingerprint,field_name,previous_decision,decision,selected_source_id,selected_value_json,note,evidence_json,changed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(randomUUID(), input.fingerprint, input.characterFingerprint, input.field, previous?.decision ?? null, input.decision, input.selectedSourceId, selectedValueJson, input.note || null, evidenceJson, now);
    db.prepare('INSERT INTO activity_events(id,event_type,occurred_at,details_json) VALUES (?,?,?,?)')
      .run(randomUUID(), 'reconciliation.field-reviewed', now, JSON.stringify({ fingerprint: input.fingerprint, characterFingerprint: input.characterFingerprint, field: input.field, decision: input.decision }));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { fingerprint: input.fingerprint, characterFingerprint: input.characterFingerprint, field: input.field, decision: input.decision, selectedSourceId: input.selectedSourceId, selectedValue: input.selectedValue, note: input.note || null, updatedAt: now };
}

export function listCharacterFieldReviewHistory(db: DatabaseSync, fingerprint: string) {
  return db.prepare(`SELECT id,fingerprint,character_fingerprint AS characterFingerprint,field_name AS field,previous_decision AS previousDecision,decision,
    selected_source_id AS selectedSourceId,selected_value_json AS selectedValue,note,evidence_json AS evidence,changed_at AS changedAt
    FROM character_field_review_history WHERE fingerprint=? ORDER BY rowid DESC`).all(fingerprint).map((value) => {
    const row = value as Record<string, unknown>;
    return { ...row, selectedValue: row.selectedValue == null ? null : JSON.parse(String(row.selectedValue)), evidence: JSON.parse(String(row.evidence)) };
  });
}
