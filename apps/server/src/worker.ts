import { parentPort, workerData } from 'node:worker_threads';

if (!parentPort) throw new Error('Worker must run in a worker thread');
const { steps, delayMs } = workerData as { steps: number; delayMs: number };
let cancelled = false;
parentPort.on('message', (message: { type: string }) => {
  if (message.type === 'cancel') cancelled = true;
});

for (let step = 1; step <= steps; step += 1) {
  if (cancelled) {
    parentPort.postMessage({ type: 'cancelled' });
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  parentPort.postMessage({ type: 'progress', progress: step / steps, message: `Infrastructure job ${step} of ${steps}` });
}
parentPort.postMessage({ type: 'completed', result: { note: 'Worker infrastructure demonstration only; no game calculation was performed.' } });
