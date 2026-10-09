import { appendFile, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
await appendFile(process.env.METEOR_DEV_FIXTURE_LOG, JSON.stringify({ kind: 'build', pid: process.pid }) + '\n');
if (process.env.METEOR_DEV_FIXTURE_BUILD_DESCENDANT === '1') {
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); process.send('ready'); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  await once(child, 'message');
  await appendFile(process.env.METEOR_DEV_FIXTURE_LOG, JSON.stringify({ kind: 'build-descendant-ready', pid: child.pid }) + '\n');
  if (process.env.METEOR_DEV_FIXTURE_BUILD_FAIL === '1') process.exit(2);
  await new Promise(() => {}); // The test interrupts only after the ready gate above.
}
if (process.env.METEOR_DEV_FIXTURE_BUILD_FAIL === '1') process.exit(2);
for (const directory of ['apps/server/dist/cli', 'packages/contracts/dist', 'packages/posix-fs/dist']) await mkdir(directory, { recursive: true });
await copyFile('fixture-server.mjs', 'apps/server/dist/cli/main.js');
await writeFile('apps/server/dist/worker.txt', 'initial');
for (const directory of ['packages/contracts', 'packages/posix-fs']) await writeFile(join(directory, 'dist/index.js'), 'export {};\n');
