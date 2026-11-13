import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { getCharacterReconciliation } from './characterReconciliation.ts';

type EvidenceValue = { sourceId: string; raw: string | number; normalized: string | number };

export function buildCanonicalCharacterProjection(report: ReturnType<typeof getCharacterReconciliation>) {
  const accepted = report.items.filter((item) => item.review && typeof item.review === 'object' && (item.review as Record<string, unknown>).decision === 'accepted' && ['id-match', 'name-match'].includes(String(item.status)));
  const items = accepted.map((candidate) => {
    const evidence = candidate.fieldEvidence as Record<string, EvidenceValue[]>;
    const fieldReviews = new Map(((candidate.conflicts ?? []) as Array<Record<string, unknown>>).map((conflict) => [String(conflict.field), conflict.review as Record<string, unknown> | null]));
    const fields = Object.fromEntries(Object.entries(evidence).map(([field, values]) => {
      const distinct = [...new Set(values.map((value) => value.normalized))];
      const review = fieldReviews.get(field);
      const selected = review?.decision === 'selected-source' ? values.find((value) => value.sourceId === review.selectedSourceId && value.normalized === review.selectedValue) : undefined;
      const state = distinct.length > 1 ? selected ? 'adjudicated' : 'conflict' : values.length > 1 ? 'corroborated' : values.length === 1 ? 'single-source' : 'unknown';
      const selectedValue = state === 'adjudicated' ? selected!.normalized : values[0]?.normalized ?? null;
      return [field, { value: state === 'conflict' || state === 'unknown' ? null : selectedValue, state, evidence: values,
        adjudication: state === 'adjudicated' ? { fingerprint: review?.fingerprint, decision: 'selected-source', selectedSourceId: review?.selectedSourceId, selectedValue: review?.selectedValue } : null }];
    }));
    const conflicts = Object.entries(fields).filter(([, value]) => (value as { state: string }).state === 'conflict').map(([field]) => field);
    const nameEvidence = evidence.name ?? [];
    const nameField = fields.name as { state: string; adjudication?: { selectedSourceId?: string } | null } | undefined;
    const canonicalName = conflicts.includes('name') || !nameEvidence.length ? null : nameField?.state === 'adjudicated'
      ? nameEvidence.find((value) => value.sourceId === nameField.adjudication?.selectedSourceId)?.raw ?? null
      : nameEvidence[0]!.raw;
    return {
      canonicalId: `reviewed:${String(candidate.reviewFingerprint)}`,
      displayName: candidate.displayName,
      canonicalName,
      identityDecision: (candidate.review as Record<string, unknown>).decision,
      matchedBy: candidate.matchedBy,
      reviewFingerprint: candidate.reviewFingerprint,
      fields,
      conflicts,
      sources: candidate.sources,
      guideReferences: candidate.guideReferences,
      verificationState: 'candidate',
      calculationEligible: false,
      limitations: ['This projection includes only manually accepted identity links.', 'Selected field values are review decisions, not claims of source authority; unresolved conflicts remain null.', 'This candidate catalog is not an authoritative calculation input.'],
    };
  });
  const projectionInput = {
    algorithm: 'accepted-character-projection-v2',
    sourceDatasets: report.sourceDatasets,
    acceptedFingerprints: items.map((item) => item.reviewFingerprint).sort(),
    items,
  };
  const digest = createHash('sha256').update(JSON.stringify(projectionInput)).digest('hex');
  return {
    dataset: { version: `sha256-${digest}`, sourceDatasets: report.sourceDatasets, generatedAt: new Date().toISOString(), state: 'computed-review-projection' },
    total: items.length,
    summary: {
      acceptedIdentityLinks: items.length,
      corroboratedFields: items.reduce((total, item) => total + Object.values(item.fields).filter((field) => field.state === 'corroborated').length, 0),
      unresolvedFieldConflicts: items.reduce((total, item) => total + item.conflicts.length, 0),
      adjudicatedFields: items.reduce((total, item) => total + Object.values(item.fields).filter((field) => field.state === 'adjudicated').length, 0),
      singleSourceFields: items.reduce((total, item) => total + Object.values(item.fields).filter((field) => field.state === 'single-source').length, 0),
    },
    items,
    policy: 'Computed only from currently approved source snapshots and accepted version-bound identity decisions. Field adjudications record a reviewer-selected source value, not source authority. It is not persisted as an approved canonical game-data dataset and is not eligible for authoritative calculations.',
  };
}

export function getCanonicalCharacterProjection(db: DatabaseSync) {
  return buildCanonicalCharacterProjection(getCharacterReconciliation(db));
}

export function saveCanonicalCharacterSnapshot(db: DatabaseSync, projection: ReturnType<typeof buildCanonicalCharacterProjection>) {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.exec('BEGIN IMMEDIATE');
  try {
    const insert = db.prepare(`INSERT OR IGNORE INTO canonical_character_snapshots
      (id,dataset_version,source_datasets_json,summary_json,snapshot_json,created_at) VALUES (?,?,?,?,?,?)`)
      .run(id, projection.dataset.version, JSON.stringify(projection.dataset.sourceDatasets), JSON.stringify(projection.summary), JSON.stringify(projection), now);
    const row = db.prepare('SELECT id,dataset_version AS datasetVersion,source_datasets_json AS sourceDatasets,summary_json AS summary,snapshot_json AS snapshot,created_at AS createdAt FROM canonical_character_snapshots WHERE dataset_version=?').get(projection.dataset.version) as Record<string, unknown>;
    db.exec('COMMIT');
    return { ...parseSnapshotRow(row), created: Number(insert.changes) > 0 };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function listCanonicalCharacterSnapshots(db: DatabaseSync, options: { limit?: number; offset?: number } = {}) {
  const limit = Math.max(1, Math.min(100, Math.trunc(options.limit ?? 25)));
  const offset = Math.max(0, Math.min(10000, Math.trunc(options.offset ?? 0)));
  const total = Number((db.prepare('SELECT COUNT(*) AS total FROM canonical_character_snapshots').get() as { total: number }).total);
  const rows = db.prepare(`SELECT id,dataset_version AS datasetVersion,source_datasets_json AS sourceDatasets,
    summary_json AS summary,created_at AS createdAt FROM canonical_character_snapshots
    ORDER BY rowid DESC LIMIT ? OFFSET ?`).all(limit, offset) as Array<Record<string, unknown>>;
  return { total, limit, offset, items: rows.map((row) => ({
    id: row.id,
    datasetVersion: row.datasetVersion,
    sourceDatasets: JSON.parse(String(row.sourceDatasets)),
    summary: JSON.parse(String(row.summary)),
    createdAt: row.createdAt,
  })) };
}

export function getCanonicalCharacterSnapshot(db: DatabaseSync, id: string) {
  const row = db.prepare(`SELECT id,dataset_version AS datasetVersion,source_datasets_json AS sourceDatasets,
    summary_json AS summary,snapshot_json AS snapshot,created_at AS createdAt
    FROM canonical_character_snapshots WHERE id=?`).get(id) as Record<string, unknown> | undefined;
  return row ? parseSnapshotRow(row) : null;
}

export function compareCanonicalCharacterSnapshots(from: Record<string, any>, to: Record<string, any>) {
  const before = (from.snapshot ?? from) as Record<string, any>;
  const after = (to.snapshot ?? to) as Record<string, any>;
  const characterKey = (character: Record<string, any>) => JSON.stringify((character.sources ?? []).map((source: Record<string, unknown>) => `${source.sourceId}:${source.key}`).sort());
  const beforeByKey = new Map<string, Record<string, any>>(before.items.map((item: Record<string, any>) => [characterKey(item), item]));
  const afterByKey = new Map<string, Record<string, any>>(after.items.map((item: Record<string, any>) => [characterKey(item), item]));
  const addedCharacters = [...afterByKey.entries()].filter(([key]) => !beforeByKey.has(key)).map(([, item]) => ({ key: characterKey(item), displayName: item.displayName }));
  const removedCharacters = [...beforeByKey.entries()].filter(([key]) => !afterByKey.has(key)).map(([, item]) => ({ key: characterKey(item), displayName: item.displayName }));
  const fieldChanges: Array<Record<string, unknown>> = [];
  for (const [key, previous] of beforeByKey) {
    const current = afterByKey.get(key);
    if (!current) continue;
    for (const field of new Set([...Object.keys(previous.fields), ...Object.keys(current.fields)])) {
      const beforeField = previous.fields[field] ?? null;
      const afterField = current.fields[field] ?? null;
      const changedProperties = ['value', 'state', 'evidence'].filter((property) => JSON.stringify(beforeField?.[property] ?? null) !== JSON.stringify(afterField?.[property] ?? null));
      if (changedProperties.length) fieldChanges.push({ key, displayName: current.displayName, field, changedProperties, before: beforeField, after: afterField });
    }
  }
  return {
    fromVersion: before.dataset.version,
    toVersion: after.dataset.version,
    sourceDatasetsChanged: JSON.stringify(before.dataset.sourceDatasets) !== JSON.stringify(after.dataset.sourceDatasets),
    addedCharacters,
    removedCharacters,
    fieldChanges,
    summary: { addedCharacters: addedCharacters.length, removedCharacters: removedCharacters.length, changedFields: fieldChanges.length },
  };
}

function parseSnapshotRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    datasetVersion: row.datasetVersion,
    sourceDatasets: JSON.parse(String(row.sourceDatasets)),
    summary: JSON.parse(String(row.summary)),
    snapshot: row.snapshot === undefined ? undefined : JSON.parse(String(row.snapshot)),
    createdAt: row.createdAt,
  };
}
