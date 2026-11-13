import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

async function collect(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await collect(path));
    else if (path.endsWith('.ts') || path.endsWith('.js')) result.push(path);
  }
  return result;
}

const files = (await Promise.all(['apps', 'packages'].map(collect))).flat();
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`Syntax checked ${files.length} source files using Node.js ${process.versions.node}.`);
console.log('Full strict TypeScript checking requires the TypeScript package, which is declared but not installed.');
