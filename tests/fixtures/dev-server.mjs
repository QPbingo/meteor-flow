import { spawn } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
// Deliberately resistant descendant: the supervisor must reap the group after its leader exits.
const worker = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' });
await appendFile(process.env.METEOR_DEV_FIXTURE_LOG, JSON.stringify({ kind: 'server', pid: process.pid, workerPid: worker.pid, args: process.argv.slice(2), workerVersion: await readFile(new URL('../worker.txt', import.meta.url), 'utf8') }) + '\n');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { worker.kill('SIGTERM'); process.exit(0); });
setInterval(() => {}, 1000);
