import type { DatabaseSync } from 'node:sqlite';
import { GAME_DATA_SOURCES } from '../../../packages/game-data/src/sources.ts';
import { getLatestSuccessfulSourceCheck } from './sourceChecks.ts';

const adapters: Record<string, { datasetKey: string; entityType: string; relatedDatasets?: Array<{ datasetKey: string; entityType: string; label: string }> }> = {
  'enka-game-store': { datasetKey: 'enka-avatar-catalog', entityType: 'avatar-definition', relatedDatasets: [{ datasetKey: 'enka-localization-catalog', entityType: 'enka-localization', label: 'localizations' }] },
  'kqm-theorycrafting-library': { datasetKey: 'kqm-character-reference-index', entityType: 'kqm-character-reference', relatedDatasets: [{ datasetKey: 'kqm-character-page-evidence', entityType: 'kqm-character-evidence', label: 'page evidence' }] },
  'genshin-db': { datasetKey: 'genshin-db-character-snapshot', entityType: 'genshin-db-character' },
};

function freshness(db: DatabaseSync, sourceId: string, datasetKey: string, active: { version: string; provenance: string; createdAt: string; approvedAt: string | null } | undefined) {
  const latest = getLatestSuccessfulSourceCheck(db, sourceId, datasetKey);
  const matchingDraft = latest ? db.prepare("SELECT 1 AS found FROM game_datasets WHERE dataset_key=? AND version=? AND state='draft' LIMIT 1").get(datasetKey, latest.datasetVersion) : undefined;
  const importedAt = active?.createdAt ?? null;
  const approvedAt = active?.approvedAt ?? null;
  const provenanceValue = active?.provenance;
  const provenance = typeof provenanceValue === 'string' ? JSON.parse(provenanceValue) as Record<string, unknown> : {};
  const checkedAt = latest?.checkedAt ?? null;
  const checkedVersion = latest?.datasetVersion ?? null;
  const state = !latest ? 'check-unknown' : matchingDraft ? 'checked-version-pending-approval' : !active ? 'check-recorded-awaiting-import' : checkedVersion === active.version ? 'checked-version-active' : 'checked-version-pending-review';
  return {
    status: state,
    sourceCheckedAt: checkedAt,
    daysSinceCheck: checkedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(checkedAt)) / 86_400_000)) : null,
    checkedDatasetVersion: checkedVersion,
    activeVersionMatchesLastCheck: active && latest ? checkedVersion === active.version : null,
    importedAt,
    approvedAt,
    sourceRevision: latest?.sourceRevision ?? (typeof provenance.sourceRevision === 'string' ? provenance.sourceRevision : null),
    contentHash: latest?.contentHash ?? (typeof provenance.sha256 === 'string' ? provenance.sha256 : null),
    checkHistoryCount: Number((db.prepare("SELECT COUNT(*) AS count FROM source_check_events WHERE source_id=? AND dataset_key=? AND result='success'").get(sourceId, datasetKey) as { count: number }).count),
  };
}

export function listSourceCoverage(db: DatabaseSync) {
  return GAME_DATA_SOURCES.map((source) => {
    const adapter = adapters[source.id];
    if (!adapter) return { sourceId: source.id, name: source.name, adapterStatus: source.status === 'candidate-only' ? 'candidate-only' : 'not-implemented', datasetState: 'none', datasetVersion: null, approvedRecords: 0, draftCount: 0, freshness: { status: 'check-unknown', sourceCheckedAt: null, daysSinceCheck: null, checkedDatasetVersion: null, activeVersionMatchesLastCheck: null, importedAt: null, approvedAt: null, sourceRevision: null, contentHash: null, checkHistoryCount: 0 }, relatedDatasets: [] };
    const active = db.prepare("SELECT id,version,provenance_json AS provenance,created_at AS createdAt,approved_at AS approvedAt FROM game_datasets WHERE dataset_key=? AND state='approved' ORDER BY approved_at DESC LIMIT 1").get(adapter.datasetKey) as { id: string; version: string; provenance: string; createdAt: string; approvedAt: string | null } | undefined;
    const approvedRecords = active ? Number((db.prepare('SELECT COUNT(*) AS count FROM game_entities WHERE dataset_id=? AND entity_type=?').get(active.id, adapter.entityType) as { count: number }).count) : 0;
    const draftCount = Number((db.prepare("SELECT COUNT(*) AS count FROM game_datasets WHERE dataset_key=? AND state='draft'").get(adapter.datasetKey) as { count: number }).count);
    const relatedDatasets = (adapter.relatedDatasets ?? []).map((related) => {
      const relatedActive = db.prepare("SELECT id,version,provenance_json AS provenance,created_at AS createdAt,approved_at AS approvedAt FROM game_datasets WHERE dataset_key=? AND state='approved' ORDER BY approved_at DESC LIMIT 1").get(related.datasetKey) as { id: string; version: string; provenance: string; createdAt: string; approvedAt: string | null } | undefined;
      const relatedRecords = relatedActive ? Number((db.prepare('SELECT COUNT(*) AS count FROM game_entities WHERE dataset_id=? AND entity_type=?').get(relatedActive.id, related.entityType) as { count: number }).count) : 0;
      const relatedDrafts = Number((db.prepare("SELECT COUNT(*) AS count FROM game_datasets WHERE dataset_key=? AND state='draft'").get(related.datasetKey) as { count: number }).count);
      return { label: related.label, datasetState: relatedActive ? 'approved' : relatedDrafts ? 'draft-available' : 'not-imported', datasetVersion: relatedActive?.version ?? null, approvedRecords: relatedRecords, draftCount: relatedDrafts, freshness: freshness(db, source.id, related.datasetKey, relatedActive) };
    });
    return { sourceId: source.id, name: source.name, adapterStatus: 'implemented', datasetState: active ? 'approved' : draftCount ? 'draft-available' : 'not-imported', datasetVersion: active?.version ?? null, approvedRecords, draftCount, freshness: freshness(db, source.id, adapter.datasetKey, active), relatedDatasets };
  });
}
