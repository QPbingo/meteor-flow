#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

// Isolated benchmark CLI: fixed-rate ANSI envelopes, no herdr/model calls.
const trigger = process.env.METEOR_PERFORMANCE_START_FILE;
if (!trigger) throw new Error('Performance start file is required');
const target = process.argv[7];
let started = false;
function frame(text) {
  return JSON.stringify({type:'terminal.frame',encoding:'ansi',bytes:Buffer.from(text).toString('base64')})+'\n';
}
async function run() {
  if (started || !fs.existsSync(trigger)) return;
  started = true;
  watcher.close();
  const {startAt,durationMs,bytesPerSecond} = JSON.parse(fs.readFileSync(trigger,'utf8'));
  if (![30_000,90_000].includes(durationMs) || bytesPerSecond !== 1024*1024 || !Number.isFinite(startAt)) throw new Error('Unexpected benchmark parameters');
  await delay(Math.max(0,startAt-Date.now()));
  const start = performance.now();
  const chunkBytes = 64*1024;
  const total = bytesPerSecond*durationMs/1000;
  const payload = frame('x'.repeat(chunkBytes));
  let sent = 0;
  while (sent < total) {
    const due = start + (sent+chunkBytes)/bytesPerSecond*1000;
    await delay(Math.max(0,due-performance.now()));
    if (!process.stdout.write(payload)) await once(process.stdout,'drain');
    sent += chunkBytes;
  }
  process.stdout.write(frame(`PERF_DONE:${JSON.stringify({target,bytes:sent,durationMs:performance.now()-start})}`));
  // Stay alive until TerminalBridge shutdown proves all CLI processes closed.
}
const watcher = fs.watch(path.dirname(trigger),() => { void run().catch(error => { console.error(error);process.exit(1); }); });
process.stdout.write(frame(`PERF_READY:${target}`));
void run().catch(error => { console.error(error);process.exit(1); });
setInterval(()=>{},1000);
