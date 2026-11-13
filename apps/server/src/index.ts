import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.ts';
import { cancelJob, createSampleJob, getJob, subscribeJob, stopWorkers } from './jobs.ts';
import { parseCreateAccountInput } from '../../../packages/contracts/src/index.ts';
import { approveDataset, ensureBundledKnowledge, getKnowledgeEntry, listDatasets, listKnowledgeRevisions, previewDataset, searchKnowledge } from './knowledge.ts';
import { GAME_DATA_SOURCES } from '../../../packages/game-data/src/sources.ts';
import { approveGameCatalog, listCharacterCatalog, previewEnkaAvatarCatalog } from './gameCatalog.ts';
import { approveKqmGuides, listKqmCharacterGuides, listKqmGuideDrafts, previewKqmCharacterGuides } from './guideCatalog.ts';
import { listSourceCoverage } from './sourceCoverage.ts';
import { approveGenshinDbDraft, GENSHIN_DB_BROWSE_CATEGORIES, listGenshinDbCategory, listGenshinDbCharacters, listGenshinDbDrafts } from './genshinDbSnapshot.ts';
import { approveEnkaLocalizationDraft, getEnkaLocalizationStatus, getEnkaLocalizations, listEnkaLocalizationDrafts, normalizeEnkaLanguage } from './enkaLocalization.ts';
import { getCharacterReconciliation, listCharacterFieldReviewHistory, listCharacterLinkReviewHistory, saveCharacterFieldReview, saveCharacterLinkReview } from './characterReconciliation.ts';
import { compareCanonicalCharacterSnapshots, getCanonicalCharacterProjection, getCanonicalCharacterSnapshot, listCanonicalCharacterSnapshots, saveCanonicalCharacterSnapshot } from './canonicalCharacters.ts';
import { compareCharacterReconciliationSnapshots, getCharacterReconciliationSnapshot, getStoredCharacterReconciliationSnapshot, listCharacterReconciliationSnapshots, saveCharacterReconciliationSnapshot } from './reconciliationSnapshots.ts';
import { approveKqmEvidenceDraft, listKqmEvidence, listKqmEvidenceDrafts } from './kqmEvidence.ts';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT ?? 3101);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('PORT must be a valid TCP port');
const db = await openDatabase();
await ensureBundledKnowledge(db);
const allowedHost = new Set([`${HOST}:${PORT}`, HOST, `localhost:${PORT}`]);
const allowedOrigin = new Set([`http://${HOST}:${PORT}`, `http://localhost:${PORT}`]);
const webDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/public');
const staticFiles: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.css': { file: 'app.css', type: 'text/css; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}

async function bodyJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > 64 * 1024) throw Object.assign(new Error('Request body exceeds 64 KB'), { statusCode: 413 });
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Request body must be valid JSON'), { statusCode: 400 }); }
}

const server = createServer(async (req, res) => {
  try {
    if (!allowedHost.has(req.headers.host ?? '')) return json(res, 400, { error: { code: 'INVALID_HOST', message: 'Requests must target the local application host.' } });
    const origin = req.headers.origin;
    if (origin && !allowedOrigin.has(origin)) return json(res, 403, { error: { code: 'INVALID_ORIGIN', message: 'Cross-origin requests are not allowed.' } });
    const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
    const method = req.method ?? 'GET';
    if ((method === 'GET' || method === 'HEAD') && staticFiles[url.pathname]) {
      const asset = staticFiles[url.pathname];
      const content = await readFile(resolve(webDirectory, asset.file));
      res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'" });
      return res.end(method === 'HEAD' ? undefined : content);
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      if (req.headers['x-genshindex-request'] !== '1' || !req.headers['content-type']?.toLowerCase().startsWith('application/json')) {
        return json(res, 403, { error: { code: 'REQUEST_GUARD', message: 'State changes require JSON and X-GenshinDex-Request: 1.' } });
      }
    }

    if (method === 'GET' && url.pathname === '/health') {
      db.prepare('SELECT 1').get();
      return json(res, 200, { data: { status: 'ok', database: 'ok', version: '0.1.0' } });
    }
    if (method === 'GET' && url.pathname === '/api/v1/accounts') {
      const rows = db.prepare('SELECT id, nickname, uid, server, created_at AS createdAt, updated_at AS updatedAt FROM accounts ORDER BY nickname COLLATE NOCASE').all();
      return json(res, 200, { data: rows });
    }
    if (method === 'POST' && url.pathname === '/api/v1/accounts') {
      const value = await bodyJson(req);
      const parsed = parseCreateAccountInput(value);
      if (!parsed.ok) return json(res, 400, { error: { code: 'VALIDATION_ERROR', message: parsed.message } });
      const input = parsed.value;
      const uid = input.uid ?? null;
      const now = new Date().toISOString();
      const account = { id: randomUUID(), nickname: input.nickname, uid, server: input.server, createdAt: now, updatedAt: now };
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO accounts(id,nickname,uid,server,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(account.id, account.nickname, account.uid, account.server, now, now);
        db.prepare('INSERT INTO activity_events(id,event_type,occurred_at,details_json) VALUES (?,?,?,?)').run(randomUUID(), 'account.created', now, JSON.stringify({ nickname: account.nickname }));
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        if ((error as Error).message.includes('UNIQUE constraint failed')) return json(res, 409, { error: { code: 'ACCOUNT_EXISTS', message: 'An account with this UID and server already exists.' } });
        throw error;
      }
      return json(res, 201, { data: account });
    }
    if (method === 'POST' && url.pathname === '/api/v1/jobs/sample') {
      const value = await bodyJson(req);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return json(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'Expected a JSON object.' } });
      const input = value as Record<string, unknown>;
      const steps = input.steps ?? 10;
      const delayMs = input.delayMs ?? 100;
      if (!Number.isInteger(steps) || (steps as number) < 1 || (steps as number) > 100 || !Number.isInteger(delayMs) || (delayMs as number) < 10 || (delayMs as number) > 1000) return json(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'steps must be 1–100 and delayMs 10–1000.' } });
      return json(res, 202, { data: createSampleJob(db, { steps: steps as number, delayMs: delayMs as number }) });
    }
    const jobMatch = url.pathname.match(/^\/api\/v1\/jobs\/([0-9a-f-]{36})(?:\/(events|cancel))?$/i);
    if (jobMatch && method === 'GET' && !jobMatch[2]) {
      const job = getJob(db, jobMatch[1]!);
      return job ? json(res, 200, { data: job }) : json(res, 404, { error: { code: 'NOT_FOUND', message: 'Job not found.' } });
    }
    if (jobMatch && method === 'POST' && jobMatch[2] === 'cancel') {
      const job = cancelJob(db, jobMatch[1]!);
      return job ? json(res, 202, { data: job }) : json(res, 404, { error: { code: 'NOT_FOUND', message: 'Job not found.' } });
    }
    if (jobMatch && method === 'GET' && jobMatch[2] === 'events') {
      const job = getJob(db, jobMatch[1]!);
      if (!job) return json(res, 404, { error: { code: 'NOT_FOUND', message: 'Job not found.' } });
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(`event: job\ndata: ${JSON.stringify(job)}\n\n`);
      if (['completed','failed','cancelled'].includes(job.status)) return res.end();
      const unsubscribe = subscribeJob(job.id, (next) => {
        res.write(`event: job\ndata: ${JSON.stringify(next)}\n\n`);
        if (['completed','failed','cancelled'].includes(next.status)) { unsubscribe(); res.end(); }
      });
      const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15000);
      req.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
      return;
    }
    if (method === 'GET' && url.pathname === '/api/v1/knowledge/datasets') {
      return json(res, 200, { data: listDatasets(db) });
    }
    if (method === 'GET' && url.pathname === '/api/v1/sources') {
      return json(res, 200, { data: GAME_DATA_SOURCES });
    }
    if (method === 'GET' && url.pathname === '/api/v1/game-data/coverage') {
      return json(res, 200, { data: listSourceCoverage(db) });
    }
    if (method === 'GET' && url.pathname === '/api/v1/game-data/reconciliation/characters') {
      const limit = Number(url.searchParams.get('limit') ?? 100);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      if (!Number.isInteger(limit) || !Number.isInteger(offset)) return json(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'limit and offset must be integers.' } });
      const report = getCharacterReconciliation(db);
      const query = (url.searchParams.get('q') ?? '').trim().toLocaleLowerCase().slice(0, 100);
      const status = url.searchParams.get('status') ?? 'all';
      const supportedStatuses = new Set(['all', 'conflicts', 'id-match', 'name-match', 'ambiguous-id', 'ambiguous-name', 'gdb-only', 'enka-only']);
      if (!supportedStatuses.has(status)) return json(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'Unsupported reconciliation status filter.' } });
      const filtered = report.items.filter((item) => {
        const statusMatches = status === 'all' || (status === 'conflicts' ? (item.conflicts as unknown[]).length > 0 : item.status === status);
        const text = `${item.displayName} ${JSON.stringify(item.sources)} ${JSON.stringify(item.possibleMatches)}`.toLocaleLowerCase();
        return statusMatches && (!query || text.includes(query));
      });
      const safeLimit = Math.max(1, Math.min(100, limit));
      const safeOffset = Math.max(0, Math.min(10000, offset));
      return json(res, 200, { data: { ...report, total: filtered.length, limit: safeLimit, offset: safeOffset, items: filtered.slice(safeOffset, safeOffset + safeLimit) } });
    }
    if (method === 'POST' && url.pathname === '/api/v1/game-data/reconciliation/characters/snapshots') {
      const value = await bodyJson(req);
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length) return json(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'Expected an empty JSON object to snapshot the current reconciliation report.' } });
      const result = saveCharacterReconciliationSnapshot(db, getCharacterReconciliationSnapshot(db));
      return json(res, result.created ? 201 : 200, { data: result });
    }
    if (method === 'GET' && url.pathname === '/api/v1/game-data/reconciliation/characters/snapshots') {
      const limit = Number(url.searchParams.get('limit') ?? 25);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      if (!Number.isInteger(limit) || !Number.isInteger(offset) || limit < 1 || offset < 0) return json(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'limit must be positive and offset must be non-negative integers.' } });
      return json(res, 200, { data: listCharacterReconciliationSnapshots(db, { limit, offset }) });
    }
    if (method === 'GET' && url.pathname === '/api/v1/game-data/reconciliation/characters/snapshots/compare') {
      const fromId = url.searchParams.get('from') ?? '';
      const toId = url.searchParams.get('to') ?? '';
      if (!/^[0-9a-f-]{36}$/i.test(fromId) || !/^[0-9a-f-]{36}$/i.test(toId)) return json(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'from and to must be reconciliation snapshot IDs.' } });
      const from = getStoredCharacterReconciliationSnapshot(db, fromId);
      const to = getStoredCharacterReconciliationSnapshot(db, toId);
      if (!from || !to) return json(res, 404, { error: { code: 'NOT_FOUND', message: 'Both reconciliation snapshots must exist.' } });
      return json(res, 200, { data: compareCharacterReconciliationSnapshots(from, to) });
    }
    const reconciliationSnapshotMatch = url.pathname.match(/^\/api\/v1\/game-data\/reconciliation\/characters\/snapshots\/([0-9a-f-]{36})$/i);
    if (method === 'GET' && reconciliationSnapshotMatch) {
      const snapshot = getStoredCharacterReconciliationSnapshot(db, reconciliationSnapshotMatch[1]!);
      return snapshot ? json(res, 200, { data: snapshot }) : json(res, 404, { error: { code: 'NOT_FOUND', message: 'Reconciliation snapshot not found.' } });
    }
    if (method === 'POST' && url.pathname === '/api/v1/game-data/canonical-characters/snapshots') {
      const value = await bodyJson(req);
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length) return json(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'Expected an empty JSON object to snapshot the current projection.' } });
      const result = saveCanonicalCharacterSnapshot(db, getCanonicalCharacterProjection(db));
      return json(res, result.created ? 201 : 200, { data: result });
    }
    if (method === 'GET' && url.pathname === '/api/v1/game-data/canonical-characters/snapshots') {
      const limit = Number(url.searchParams.get('limit') ?? 25);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      if (!Number.isInteger(limit) || !Number.isInteger(offset) || limit < 1 || offset < 0) return json(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'limit must be positive and offset must be non-negative integers.' } });
      return json(res, 200, { data: listCanonicalCharacterSnapshots(db, { limit, offset }) });
    }
    if (method === 'GET' && url.pathname === '/api/v1/game-data/canonical-characters/snapshots/compare') {
      const fromId = url.searchParams.get('from') ?? '';
      const toId = url.searchParams.get('to') ?? '';
      if (!/^[0-9a-f-]{36}$/i.test(fromId) || !/^[0-9a-f-]{36}$/i.test(toId)) return json(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'from and to must be snapshot IDs.' } });
      const from = getCanonicalCharacterSnapshot(db, fromId);
      const to = getCanonicalCharacterSnapshot(db, toId);
      if (!from || !to) return json(res, 404, { error: { code: 'NOT_FOUND', message: 'Both canonical character snapshots must exist.' } });
      return json(res, 200, { data: compareCanonicalCharacterSnapshots(from, to) });
    }
    const canonicalSnapshotMatch = url.pathname.match(/^\/api\/v1\/game-data\/canonical-characters\/snapshots\/([0-9a-f-]{36})$/i);
    if (method === 'GET' && canonicalSnapshotMatch) {
      const snapshot = getCanonicalCharacterSnapshot(db, canonicalSnapshotMatch[1]!);
      return snapshot ? json(res, 200, { data: snapshot }) : json(res, 404, { error: { code: 'NOT_FOUND', message: 'Canonical character snapshot not found.' } });
    }
    if (method === 'GET' && url.pathname === '/api/v1/game-data/canonical-characters') {
      return json(res, 200, { data: getCanonicalCharacterProjection(db) });
    }
    if (method === 'POST' && url.pathname === '/api/v1/game-data/reconciliation/reviews') {
      const value = await bodyJson(req);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return json(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'Expected a JSON object.' } });
      const input = value as Record<string, unknown>;
      if (typeof input.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(input.fingerprint) || !['accepted', 'rejected', 'deferred'].includes(String(input.decision))) return json(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'fingerprint must be SHA-256 and decision must be accepted, rejected, or deferred.' } });
      if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 1000)) return json(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'note must be a string of at most 1000 characters.' } });
      const report = getCharacterReconciliation(db);
      const candidate = report.items.find((item) => item.reviewFingerprint === input.fingerprint);
      if (!candidate) return json(res, 409, { error: { code: 'REVIEW_EVIDENCE_STALE', message: 'This review fingerprint does not match the current approved source versions. Refresh the reconciliation report.' } });
      if (!['id-match', 'name-match'].includes(String(candidate.status))) return json(res, 409, { error: { code: 'CANDIDATE_NOT_REVIEWABLE', message: 'Only a unique ID or name match can receive an identity-link decision.' } });
      const review = saveCharacterLinkReview(db, { fingerprint: input.fingerprint, decision: input.decision as 'accepted' | 'rejected' | 'deferred', note: typeof input.note === 'string' ? input.note.trim() : '', evidence: candidate });
      return json(res, 200, { data: review });
    }
    if (method === 'POST' && url.pathname === '/api/v1/game-data/reconciliation/field-reviews') {
      const value = await bodyJson(req);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return json(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'Expected a JSON object.' } });
      const input = value as Record<string, unknown>;
      if (typeof input.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(input.fingerprint) || !['selected-source', 'deferred'].includes(String(input.decision))) return json(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'fingerprint must be SHA-256 and decision must be selected-source or deferred.' } });
      if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 1000)) return json(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'note must be a string of at most 1000 characters.' } });
      const report = getCharacterReconciliation(db);
      const candidate = report.items.find((item) => Array.isArray(item.conflicts) && (item.conflicts as Array<Record<string, unknown>>).some((conflict) => conflict.fingerprint === input.fingerprint)) as Record<string, unknown> | undefined;
      const candidateDetails = candidate as (Record<string, any> & { reviewFingerprint?: unknown }) | undefined;
      const conflict = (candidateDetails?.conflicts as Array<Record<string, any>> | undefined)?.find((item) => item.fingerprint === input.fingerprint);
      if (!candidateDetails || !conflict || candidateDetails.review?.decision !== 'accepted' || typeof candidateDetails.reviewFingerprint !== 'string') return json(res, 409, { error: { code: 'FIELD_REVIEW_STALE', message: 'The field conflict must belong to a currently accepted identity link and current source evidence.' } });
      const decision = input.decision as 'selected-source' | 'deferred';
      let selectedSourceId: string | null = null;
      let selectedValue: string | number | null = null;
      if (decision === 'selected-source') {
        if (typeof input.selectedSourceId !== 'string' || (typeof input.selectedValue !== 'string' && typeof input.selectedValue !== 'number')) return json(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'selected-source decisions require selectedSourceId and selectedValue.' } });
        const chosen = conflict.values.find((item) => item.sourceId === input.selectedSourceId && item.normalized === input.selectedValue);
        if (!chosen) return json(res, 409, { error: { code: 'FIELD_VALUE_NOT_IN_EVIDENCE', message: 'Choose one of the current source values shown for this conflict.' } });
        selectedSourceId = chosen.sourceId;
        selectedValue = chosen.normalized;
      }
      const review = saveCharacterFieldReview(db, { fingerprint: input.fingerprint, characterFingerprint: candidateDetails.reviewFingerprint, field: conflict.field, decision, selectedSourceId, selectedValue, note: typeof input.note === 'string' ? input.note.trim() : '', evidence: conflict });
      return json(res, 200, { data: review });
    }
    const reviewHistoryMatch = url.pathname.match(/^\/api\/v1\/game-data\/reconciliation\/reviews\/([a-f0-9]{64})$/i);
    if (method === 'GET' && reviewHistoryMatch) {
      return json(res, 200, { data: listCharacterLinkReviewHistory(db, reviewHistoryMatch[1]!.toLowerCase()) });
    }
    const fieldReviewHistoryMatch = url.pathname.match(/^\/api\/v1\/game-data\/reconciliation\/field-reviews\/([a-f0-9]{64})$/i);
    if (method === 'GET' && fieldReviewHistoryMatch) {
      return json(res, 200, { data: listCharacterFieldReviewHistory(db, fieldReviewHistoryMatch[1]!.toLowerCase()) });
    }
    if (method === 'GET' && url.pathname === '/api/v1/game-data/characters') {
      const language = url.searchParams.get('lang') ?? 'en';
      if (!normalizeEnkaLanguage(language)) return json(res, 400, { error: { code: 'UNSUPPORTED_LANGUAGE', message: 'The requested localization language is not supported.' } });
      return json(res, 200, { data: listCharacterCatalog(db, language) });
    }
    if (method === 'GET' && url.pathname === '/api/v1/game-data/localizations') {
      const language = url.searchParams.get('lang') ?? 'en';
      if (!normalizeEnkaLanguage(language)) return json(res, 400, { error: { code: 'UNSUPPORTED_LANGUAGE', message: 'The requested localization language is not supported.' } });
      const data = getEnkaLocalizations(db, language);
      return json(res, 200, { data });
    }
    if (method === 'GET' && url.pathname === '/api/v1/game-data/localizations/status') {
      const language = url.searchParams.get('lang') ?? 'en';
      if (!normalizeEnkaLanguage(language)) return json(res, 400, { error: { code: 'UNSUPPORTED_LANGUAGE', message: 'The requested localization language is not supported.' } });
      return json(res, 200, { data: getEnkaLocalizationStatus(db, language) });
    }
    if (method === 'GET' && url.pathname === '/api/v1/game-data/character-guides') {
      return json(res, 200, { data: listKqmCharacterGuides(db) });
    }
    if (method === 'GET' && url.pathname === '/api/v1/game-data/character-guides/drafts') {
      return json(res, 200, { data: listKqmGuideDrafts(db) });
    }
    if (method === 'GET' && url.pathname === '/api/v1/game-data/character-guides/evidence/drafts') {
      return json(res, 200, { data: listKqmEvidenceDrafts(db) });
    }
    if (method === 'GET' && url.pathname === '/api/v1/game-data/character-guides/evidence') {
      const limit = Number(url.searchParams.get('limit') ?? 50);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const query = url.searchParams.get('q') ?? '';
      if (query.length > 100 || !Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000) return json(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'Invalid KQM evidence query.' } });
      return json(res, 200, { data: listKqmEvidence(db, { q: query, slug: url.searchParams.get('slug') ?? undefined, limit, offset }) });
    }
    if (method === 'GET' && url.pathname === '/api/v1/game-data/genshin-db/characters') {
      return json(res, 200, { data: listGenshinDbCharacters(db) });
    }
    const genshinDbCategoryMatch = url.pathname.match(/^\/api\/v1\/game-data\/genshin-db\/([a-z]+)$/);
    if (method === 'GET' && genshinDbCategoryMatch && (GENSHIN_DB_BROWSE_CATEGORIES as readonly string[]).includes(genshinDbCategoryMatch[1]!)) {
      const limit = Number(url.searchParams.get('limit') ?? 50);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      if (!Number.isInteger(limit) || !Number.isInteger(offset)) return json(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'limit and offset must be integers.' } });
      return json(res, 200, { data: listGenshinDbCategory(db, genshinDbCategoryMatch[1]! as typeof GENSHIN_DB_BROWSE_CATEGORIES[number], { q: url.searchParams.get('q') ?? '', limit, offset }) });
    }
    if (method === 'GET' && url.pathname === '/api/v1/game-data/imports') {
      return json(res, 200, { data: listGenshinDbDrafts(db) });
    }
    if (method === 'GET' && url.pathname === '/api/v1/game-data/imports/enka-localizations') {
      return json(res, 200, { data: listEnkaLocalizationDrafts(db) });
    }
    const enkaLocalizationImportMatch = url.pathname.match(/^\/api\/v1\/game-data\/imports\/enka-localizations\/([0-9a-f-]{36})\/approve$/i);
    if (method === 'POST' && enkaLocalizationImportMatch) {
      await bodyJson(req);
      const result = approveEnkaLocalizationDraft(db, enkaLocalizationImportMatch[1]!);
      return result.error ? json(res, result.status, { error: result.error }) : json(res, result.status, { data: result.data });
    }
    const localImportMatch = url.pathname.match(/^\/api\/v1\/game-data\/imports\/([0-9a-f-]{36})\/approve$/i);
    if (method === 'POST' && localImportMatch) {
      await bodyJson(req);
      const result = approveGenshinDbDraft(db, localImportMatch[1]!);
      return result.error ? json(res, result.status, { error: result.error }) : json(res, result.status, { data: result.data });
    }
    if (method === 'POST' && url.pathname === '/api/v1/game-data/characters/preview') {
      await bodyJson(req);
      try {
        const preview = await previewEnkaAvatarCatalog(db);
        return json(res, 201, { data: preview });
      } catch (error) {
        return json(res, 502, { error: { code: 'SOURCE_UNAVAILABLE', message: (error as Error).message } });
      }
    }
    if (method === 'POST' && url.pathname === '/api/v1/game-data/character-guides/preview') {
      await bodyJson(req);
      try {
        const preview = await previewKqmCharacterGuides(db);
        return json(res, 201, { data: preview });
      } catch (error) {
        return json(res, 502, { error: { code: 'SOURCE_UNAVAILABLE', message: (error as Error).message } });
      }
    }
    const characterCatalogMatch = url.pathname.match(/^\/api\/v1\/game-data\/characters\/datasets\/([0-9a-f-]{36})\/approve$/i);
    if (method === 'POST' && characterCatalogMatch) {
      await bodyJson(req);
      const result = approveGameCatalog(db, characterCatalogMatch[1]!);
      return result.error ? json(res, result.status, { error: result.error }) : json(res, result.status, { data: result.data });
    }
    const guideCatalogMatch = url.pathname.match(/^\/api\/v1\/game-data\/character-guides\/datasets\/([0-9a-f-]{36})\/approve$/i);
    if (method === 'POST' && guideCatalogMatch) {
      await bodyJson(req);
      const result = approveKqmGuides(db, guideCatalogMatch[1]!);
      return result.error ? json(res, result.status, { error: result.error }) : json(res, result.status, { data: result.data });
    }
    const kqmEvidenceDraftMatch = url.pathname.match(/^\/api\/v1\/game-data\/character-guides\/evidence\/datasets\/([0-9a-f-]{36})\/approve$/i);
    if (method === 'POST' && kqmEvidenceDraftMatch) {
      await bodyJson(req);
      const result = approveKqmEvidenceDraft(db, kqmEvidenceDraftMatch[1]!);
      return result.error ? json(res, result.status, { error: result.error }) : json(res, result.status, { data: result.data });
    }
    const datasetMatch = url.pathname.match(/^\/api\/v1\/knowledge\/datasets\/([^/]+)(?:\/(revisions|approve))?$/);
    if (datasetMatch && method === 'GET' && datasetMatch[2] === 'revisions') {
      const dataset = db.prepare('SELECT 1 FROM game_datasets WHERE id=?').get(decodeURIComponent(datasetMatch[1]!));
      if (!dataset) return json(res, 404, { error: { code: 'NOT_FOUND', message: 'Dataset not found.' } });
      return json(res, 200, { data: listKnowledgeRevisions(db, decodeURIComponent(datasetMatch[1]!)) });
    }
    if (datasetMatch && method === 'GET' && !datasetMatch[2]) {
      const dataset = db.prepare('SELECT id,dataset_key AS key,version,state,provenance_json AS provenance,created_at AS createdAt,approved_at AS approvedAt FROM game_datasets WHERE id=?').get(decodeURIComponent(datasetMatch[1]!)) as Record<string, unknown> | undefined;
      if (!dataset) return json(res, 404, { error: { code: 'NOT_FOUND', message: 'Dataset not found.' } });
      dataset.provenance = JSON.parse(String(dataset.provenance));
      const entries = db.prepare('SELECT id,slug,category,title,summary,content,keywords_json AS keywords,verification_state AS verificationState,confidence,limitations_json AS limitations,game_version AS gameVersion FROM knowledge_entries WHERE dataset_id=? ORDER BY title COLLATE NOCASE').all(dataset.id).map((row) => {
        const entry = row as Record<string, unknown>;
        const sources = db.prepare('SELECT title,publisher,url,checked_at AS checkedAt,source_version AS sourceVersion,notes FROM knowledge_sources WHERE entry_id=? ORDER BY checked_at DESC').all(entry.id);
        return { ...entry, keywords: JSON.parse(String(entry.keywords)), limitations: JSON.parse(String(entry.limitations)), sources };
      });
      return json(res, 200, { data: { ...dataset, entries } });
    }
    if (datasetMatch && method === 'POST' && datasetMatch[2] === 'approve') {
      const result = approveDataset(db, decodeURIComponent(datasetMatch[1]!));
      return result.error ? json(res, result.status, { error: result.error }) : json(res, result.status, { data: result.data });
    }
    if (method === 'POST' && url.pathname === '/api/v1/knowledge/datasets/preview') {
      const result = previewDataset(db, await bodyJson(req));
      return result.ok ? json(res, 201, { data: result }) : json(res, 400, { error: { code: 'VALIDATION_ERROR', message: result.message } });
    }
    if (method === 'GET' && url.pathname === '/api/v1/knowledge') {
      const query = url.searchParams.get('q') ?? '';
      const category = url.searchParams.get('category') ?? undefined;
      const verification = url.searchParams.get('verification') ?? undefined;
      const limit = Number(url.searchParams.get('limit') ?? 20);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      if (query.length > 100 || (category !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category)) || (verification !== undefined && !['verified','community-confirmed','experimental','conflicting','deprecated'].includes(verification)) || !Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(offset) || offset < 0 || offset > 10000) {
        return json(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'Invalid knowledge search query or filters.' } });
      }
      return json(res, 200, { data: searchKnowledge(db, { query, category, verification: verification as 'verified' | 'community-confirmed' | 'experimental' | 'conflicting' | 'deprecated' | undefined, limit, offset }) });
    }
    const knowledgeMatch = url.pathname.match(/^\/api\/v1\/knowledge\/([a-z0-9]+(?:-[a-z0-9]+)*)$/);
    if (knowledgeMatch && method === 'GET') {
      const entry = getKnowledgeEntry(db, knowledgeMatch[1]!);
      return entry ? json(res, 200, { data: entry }) : json(res, 404, { error: { code: 'NOT_FOUND', message: 'Knowledge entry not found.' } });
    }
    return json(res, 404, { error: { code: 'NOT_FOUND', message: 'Route not found.' } });
  } catch (error) {
    const status = Number((error as { statusCode?: number }).statusCode ?? 500);
    json(res, status, { error: { code: status === 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST', message: status === 500 ? 'The request could not be completed.' : (error as Error).message } });
  }
});

server.listen(PORT, HOST, () => process.stdout.write(`GenshinDex API listening at http://${HOST}:${PORT}\n`));
const shutdown = async () => {
  server.close();
  server.closeAllConnections();
  await stopWorkers();
  db.close();
};
process.once('SIGINT', () => void shutdown().then(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown().then(() => process.exit(0)));
