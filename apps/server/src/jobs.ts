import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';

type Job = { id: string; kind: string; status: string; progress: number; message: string; input: unknown; result: unknown; createdAt: string; updatedAt: string };
const workerUrl = new URL('./worker.ts', import.meta.url);
const active = new Map<string, Worker>();
const events = new EventEmitter();
events.setMaxListeners(0);

function mapRow(row: Record<string, unknown>): Job {
  return { id: String(row.id), kind: String(row.kind), status: String(row.status), progress: Number(row.progress), message: String(row.message), input: JSON.parse(String(row.input_json)), result: row.result_json ? JSON.parse(String(row.result_json)) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

export function getJob(db: DatabaseSync, id: string): Job | undefined {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : undefined;
}

function update(db: DatabaseSync, id: string, values: { status?: string; progress?: number; message?: string; result?: unknown; errorCode?: string }): Job {
  const current = getJob(db, id);
  if (!current) throw new Error('Job disappeared');
  const status = values.status ?? current.status;
  const progress = values.progress ?? current.progress;
  const message = values.message ?? current.message;
  db.prepare(`UPDATE jobs SET status = ?, progress = ?, message = ?, result_json = ?, error_code = ?, updated_at = ? WHERE id = ?`).run(status, progress, message, values.result === undefined ? (current.result === null ? null : JSON.stringify(current.result)) : JSON.stringify(values.result), values.errorCode ?? null, new Date().toISOString(), id);
  const job = getJob(db, id)!;
  events.emit(id, job);
  return job;
}

export function createSampleJob(db: DatabaseSync, input: { steps: number; delayMs: number }): Job {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO jobs(id, kind, status, progress, message, input_json, created_at, updated_at) VALUES (?, 'infrastructure.sample', 'queued', 0, 'Queued', ?, ?, ?)`)
    .run(id, JSON.stringify(input), now, now);
  update(db, id, { status: 'running', message: 'Worker started' });
  const worker = new Worker(workerUrl, { workerData: input, execArgv: ['--disable-warning=ExperimentalWarning'] });
  active.set(id, worker);
  worker.on('message', (message: { type: string; progress?: number; message?: string; result?: unknown }) => {
    if (message.type === 'progress') update(db, id, { progress: message.progress, message: message.message });
    if (message.type === 'completed') update(db, id, { status: 'completed', progress: 1, message: 'Completed', result: message.result });
    if (message.type === 'cancelled') update(db, id, { status: 'cancelled', message: 'Cancelled' });
  });
  worker.on('error', () => update(db, id, { status: 'failed', message: 'Worker failed', errorCode: 'WORKER_FAILED' }));
  worker.on('exit', (code) => {
    active.delete(id);
    const job = getJob(db, id);
    if (code !== 0 && job?.status === 'running') update(db, id, { status: 'failed', message: 'Worker exited unexpectedly', errorCode: 'WORKER_EXIT' });
  });
  return getJob(db, id)!;
}

export function cancelJob(db: DatabaseSync, id: string): Job | undefined {
  const job = getJob(db, id);
  if (!job) return undefined;
  if (job.status === 'queued') return update(db, id, { status: 'cancelled', message: 'Cancelled' });
  if (job.status !== 'running') return job;
  active.get(id)?.postMessage({ type: 'cancel' });
  return job;
}

export function subscribeJob(id: string, listener: (job: Job) => void): () => void {
  events.on(id, listener);
  return () => events.off(id, listener);
}

export async function stopWorkers(): Promise<void> {
  await Promise.all([...active.values()].map((worker) => worker.terminate()));
  active.clear();
}
