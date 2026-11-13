import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { getCharacterReconciliation } from './characterReconciliation.ts';

export function buildCharacterReconciliationSnapshot(report: ReturnType<typeof getCharacterReconciliation>) {
  const stableItems = report.items.map((item) => {
    const row = item as Record<string, any>;
    return {
      candidateId: row.candidateId,
      status: row.status,
      matchedBy: row.matchedBy,
      reviewFingerprint: row.reviewFingerprint,
      identityDecision: row.review?.decision ?? null,
      sources: row.sources,
      possibleMatches: row.possibleMatches,
      fieldEvidence: row.fieldEvidence,
      conflicts: row.conflicts.map((conflict: Record<string, any>) => ({
        field: conflict.field,
        fingerprint: conflict.fingerprint,
        values: conflict.values,
        decision: conflict.review?.decision ?? null,
        selectedSourceId: conflict.review?.selectedSourceId ?? null,
        selectedValue: conflict.review?.selectedValue ?? null,
      })),
      guideReferences: row.guideReferences,
    };
  });
  const digestInput = {
    algorithm: 'character-reconciliation-snapshot-v1',
    sourceDatasets: report.sourceDatasets,
    summary: report.summary,
    items: stableItems,
    unmatchedGuideReferences: report.unmatchedGuideReferences,
  };
  const digest = createHash('sha256').update(JSON.stringify(digestInput)).digest('hex');
  return {
    dataset: { version: `sha256-${digest}`, sourceDatasets: report.sourceDatasets, state: 'review-snapshot' },
    summary: report.summary,
    items: report.items,
    unmatchedGuideReferences: report.unmatchedGuideReferences,
    policy: 'Immutable snapshot of a source reconciliation report. It includes unmatched records and reference pages, is not a canonical dataset, and is not eligible for authoritative calculations.',
  };
}

export function getCharacterReconciliationSnapshot(db: DatabaseSync) {
  return buildCharacterReconciliationSnapshot(getCharacterReconciliation(db));
}

export function saveCharacterReconciliationSnapshot(db: DatabaseSync, snapshot: ReturnType<typeof buildCharacterReconciliationSnapshot>) {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.exec('BEGIN IMMEDIATE');
  try {
    const inserted = db.prepare(`INSERT OR IGNORE INTO character_reconciliation_snapshots
      (id,snapshot_version,source_datasets_json,summary_json,snapshot_json,created_at) VALUES (?,?,?,?,?,?)`)
      .run(id, snapshot.dataset.version, JSON.stringify(snapshot.dataset.sourceDatasets), JSON.stringify(snapshot.summary), JSON.stringify(snapshot), now);
    const row = db.prepare(`SELECT id,snapshot_version AS snapshotVersion,source_datasets_json AS sourceDatasets,
      summary_json AS summary,snapshot_json AS snapshot,created_at AS createdAt
      FROM character_reconciliation_snapshots WHERE snapshot_version=?`).get(snapshot.dataset.version) as Record<string, unknown>;
    if (Number(inserted.changes) > 0) db.prepare('INSERT INTO activity_events(id,event_type,occurred_at,details_json) VALUES (?,?,?,?)')
      .run(randomUUID(), 'reconciliation.report-snapshot-saved', now, JSON.stringify({ id, snapshotVersion: snapshot.dataset.version }));
    db.exec('COMMIT');
    return { ...parseRow(row), created: Number(inserted.changes) > 0 };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function listCharacterReconciliationSnapshots(db: DatabaseSync, options: { limit?: number; offset?: number } = {}) {
  const limit = Math.max(1, Math.min(100, Math.trunc(options.limit ?? 25)));
  const offset = Math.max(0, Math.min(10000, Math.trunc(options.offset ?? 0)));
  const total = Number((db.prepare('SELECT COUNT(*) AS total FROM character_reconciliation_snapshots').get() as { total: number }).total);
  const rows = db.prepare(`SELECT id,snapshot_version AS snapshotVersion,source_datasets_json AS sourceDatasets,
    summary_json AS summary,created_at AS createdAt FROM character_reconciliation_snapshots ORDER BY rowid DESC LIMIT ? OFFSET ?`).all(limit, offset) as Array<Record<string, unknown>>;
  return { total, limit, offset, items: rows.map((row) => ({ id: row.id, snapshotVersion: row.snapshotVersion, sourceDatasets: JSON.parse(String(row.sourceDatasets)), summary: JSON.parse(String(row.summary)), createdAt: row.createdAt })) };
}

export function getStoredCharacterReconciliationSnapshot(db: DatabaseSync, id: string) {
  const row = db.prepare(`SELECT id,snapshot_version AS snapshotVersion,source_datasets_json AS sourceDatasets,
    summary_json AS summary,snapshot_json AS snapshot,created_at AS createdAt FROM character_reconciliation_snapshots WHERE id=?`).get(id) as Record<string, unknown> | undefined;
  return row ? parseRow(row) : null;
}

function parseRow(row: Record<string, unknown>) {
  return { id: row.id, snapshotVersion: row.snapshotVersion, sourceDatasets: JSON.parse(String(row.sourceDatasets)), summary: JSON.parse(String(row.summary)), snapshot: JSON.parse(String(row.snapshot)), createdAt: row.createdAt };
}

export function compareCharacterReconciliationSnapshots(from: Record<string, any>, to: Record<string, any>) {
  const before = (from.snapshot ?? from) as Record<string, any>;
  const after = (to.snapshot ?? to) as Record<string, any>;
  const candidateKey = (candidate: Record<string, any>) => String(candidate.candidateId ?? JSON.stringify(candidate.sources ?? []));
  const beforeByKey = new Map<string, Record<string, any>>(before.items.map((candidate: Record<string, any>) => [candidateKey(candidate), candidate]));
  const afterByKey = new Map<string, Record<string, any>>(after.items.map((candidate: Record<string, any>) => [candidateKey(candidate), candidate]));
  const addedCandidates = [...afterByKey.entries()].filter(([key]) => !beforeByKey.has(key)).map(([, item]) => ({ candidateId: candidateKey(item), displayName: item.displayName, status: item.status }));
  const removedCandidates = [...beforeByKey.entries()].filter(([key]) => !afterByKey.has(key)).map(([, item]) => ({ candidateId: candidateKey(item), displayName: item.displayName, status: item.status }));
  const candidateChanges: Array<Record<string, unknown>> = [];
  const fieldChanges: Array<Record<string, unknown>> = [];
  const conflictReviewChanges: Array<Record<string, unknown>> = [];
  for (const [key, previous] of beforeByKey) {
    const current = afterByKey.get(key);
    if (!current) continue;
    const changedProperties = ['status', 'matchedBy', 'identityDecision', 'possibleMatches', 'sources', 'guideReferences', 'conflicts']
      .filter((property) => JSON.stringify(property === 'identityDecision' ? previous.review?.decision ?? null : previous[property] ?? null) !== JSON.stringify(property === 'identityDecision' ? current.review?.decision ?? null : current[property] ?? null));
    if (changedProperties.length) candidateChanges.push({ candidateId: key, displayName: current.displayName, changedProperties, beforeStatus: previous.status, afterStatus: current.status });
    const beforeFields = previous.fieldEvidence ?? {};
    const afterFields = current.fieldEvidence ?? {};
    for (const field of new Set([...Object.keys(beforeFields), ...Object.keys(afterFields)])) {
      const oldValues = beforeFields[field] ?? [];
      const newValues = afterFields[field] ?? [];
      if (JSON.stringify(oldValues) !== JSON.stringify(newValues)) {
        const oldConflict = (previous.conflicts ?? []).some((conflict: Record<string, unknown>) => conflict.field === field);
        const newConflict = (current.conflicts ?? []).some((conflict: Record<string, unknown>) => conflict.field === field);
        fieldChanges.push({ candidateId: key, displayName: current.displayName, field, before: oldValues, after: newValues, beforeConflict: oldConflict, afterConflict: newConflict });
      }
    }
    const beforeConflicts = new Map<string, Record<string, any>>((previous.conflicts ?? []).map((conflict: Record<string, any>) => [String(conflict.field), conflict]));
    const afterConflicts = new Map<string, Record<string, any>>((current.conflicts ?? []).map((conflict: Record<string, any>) => [String(conflict.field), conflict]));
    for (const field of new Set([...beforeConflicts.keys(), ...afterConflicts.keys()])) {
      const beforeConflict = beforeConflicts.get(field) ?? null;
      const afterConflict = afterConflicts.get(field) ?? null;
      const reviewState = (conflict: Record<string, any> | null) => conflict ? { decision: conflict.review?.decision ?? null, selectedSourceId: conflict.review?.selectedSourceId ?? null, selectedValue: conflict.review?.selectedValue ?? null } : null;
      if (JSON.stringify(reviewState(beforeConflict)) !== JSON.stringify(reviewState(afterConflict))) conflictReviewChanges.push({ candidateId: key, displayName: current.displayName, field, before: reviewState(beforeConflict), after: reviewState(afterConflict) });
    }
  }
  const guideKey = (guide: Record<string, unknown>) => String(guide.slug ?? guide.pageUrl ?? guide.displayName);
  const beforeGuides = new Map<string, Record<string, unknown>>((before.unmatchedGuideReferences ?? []).map((guide: Record<string, unknown>) => [guideKey(guide), guide]));
  const afterGuides = new Map<string, Record<string, unknown>>((after.unmatchedGuideReferences ?? []).map((guide: Record<string, unknown>) => [guideKey(guide), guide]));
  const addedUnmatchedGuideReferences = [...afterGuides.entries()].filter(([key]) => !beforeGuides.has(key)).map(([, guide]) => guide);
  const removedUnmatchedGuideReferences = [...beforeGuides.entries()].filter(([key]) => !afterGuides.has(key)).map(([, guide]) => guide);
  return {
    fromVersion: before.dataset.version,
    toVersion: after.dataset.version,
    sourceDatasetsChanged: JSON.stringify(before.dataset.sourceDatasets) !== JSON.stringify(after.dataset.sourceDatasets),
    addedCandidates,
    removedCandidates,
    candidateChanges,
    fieldChanges,
    conflictReviewChanges,
    addedUnmatchedGuideReferences,
    removedUnmatchedGuideReferences,
    summary: { addedCandidates: addedCandidates.length, removedCandidates: removedCandidates.length, changedCandidates: candidateChanges.length, changedFields: fieldChanges.length, conflictReviewChanges: conflictReviewChanges.length, addedUnmatchedGuideReferences: addedUnmatchedGuideReferences.length, removedUnmatchedGuideReferences: removedUnmatchedGuideReferences.length },
  };
}
