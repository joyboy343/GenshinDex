import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export function recordSuccessfulSourceCheck(db: DatabaseSync, input: { sourceId: string; datasetKey: string; datasetVersion: string; sourceRevision: string | null; contentHash: string; checkedAt?: string }) {
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  db.prepare(`INSERT INTO source_check_events(id,source_id,dataset_key,dataset_version,checked_at,source_revision,content_hash,result,error_code)
    VALUES (?,?,?,?,?,?,?,'success',NULL)`).run(randomUUID(), input.sourceId, input.datasetKey, input.datasetVersion, checkedAt, input.sourceRevision, input.contentHash);
  return { sourceId: input.sourceId, datasetKey: input.datasetKey, datasetVersion: input.datasetVersion, checkedAt, sourceRevision: input.sourceRevision, contentHash: input.contentHash, result: 'success' };
}

export function getLatestSuccessfulSourceCheck(db: DatabaseSync, sourceId: string, datasetKey: string) {
  return db.prepare(`SELECT dataset_version AS datasetVersion,checked_at AS checkedAt,source_revision AS sourceRevision,
    content_hash AS contentHash FROM source_check_events WHERE source_id=? AND dataset_key=? AND result='success'
    ORDER BY checked_at DESC,rowid DESC LIMIT 1`).get(sourceId, datasetKey) as { datasetVersion: string; checkedAt: string; sourceRevision: string | null; contentHash: string } | undefined;
}
