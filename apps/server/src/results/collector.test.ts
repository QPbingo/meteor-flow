import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { processIdentity } from '@meteor-flow/posix-fs';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Attempt, Project, Task } from '@meteor-flow/contracts';
import { Store } from '../storage/store.js';
import { Collector } from './collector.js';
import { binding, frozen, observation, result, taskInput } from '../../../../tests/fixtures/storage-support.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { vi.restoreAllMocks();for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
async function setup(options: { childURL?: URL; timeoutMs?: number; maxJobs?: number } = {}) {
  const directory = await realpath(await mkdtemp('/tmp/mf-collector-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const dataDir = join(directory, 'data'); const cwd = join(directory, 'work');
  await mkdir(dataDir); await mkdir(cwd);
  const store = new Store(join(dataDir, 'state.sqlite'), 'meteor-flow-test-state', { workerURL: new URL('../../dist/storage/worker.js', import.meta.url) });
  cleanup.push(() => store.close()); await store.open();
  const project = (await store.command<Project>({ type: 'project.create', data: { name: '采集测试', root: cwd } })).result;
  await store.command({ type: 'binding.create', data: binding(project.id, cwd) });
  const task = (await store.command<Task>({ type: 'task.create', data: taskInput(project.id) })).result;
  const collector = new Collector(store, dataDir, 'test-generation', { childURL: new URL('../../dist/results/child.js', import.meta.url), timeoutMs: 5000, ...options });
  cleanup.push(() => collector.close()); await collector.init();
  return { directory, dataDir, cwd, store, task, collector, project };
}
async function dispatched(context: Awaited<ReturnType<typeof setup>>, input = frozen(context.cwd)) {
  const prepared = await context.collector.prepare(context.task, context.cwd, input, '11111111-1111-4111-8111-111111111111');
  const attempt = (await context.store.command<Attempt>({ type: 'dispatch', taskId: context.task.id, id: '11111111-1111-4111-8111-111111111111', input: prepared })).result;
  await context.store.command({ type: 'dispatch.result', id: attempt.id, status: 'submitted', reason: 'test-submitted' });
  await context.store.command({ type: 'observe', observations: [observation({ cwd: context.cwd, status: 'working', sequence: 11 })] });
  return context.store.state.attempts[0]!;
}
async function submitFile(context: Awaited<ReturnType<typeof setup>>, declaration: ReturnType<typeof result>) {
  const directory = join(context.cwd, '.meteor-flow/runs/11111111-1111-4111-8111-111111111111');
  await writeFile(join(directory, 'result.tmp'), JSON.stringify(declaration));
  await rename(join(directory, 'result.tmp'), join(directory, 'result.json'));
}

describe('real process result collection and immutable archives', () => {
  it.each(['cancel','close','storage'])('quarantines a candidate if %s changes while atomic rename is pending',async kind=>{
    const context=await setup();const attempt=await dispatched(context);
    await submitFile(context,result(context.task.id,attempt.id));
    const original=fs.rename;
    vi.spyOn(fs,'rename').mockImplementation(async(source,target)=>{
      await original(source,target);
      if(String(target).startsWith(context.collector.archiveRoot)){
        if(kind==='cancel')await context.store.command({type:'task.action',id:context.task.id,action:{operation_id:'cancel-rename',action:'cancel'}});
        if(kind==='close')await context.collector.close();
        if(kind==='storage')await context.store.close();
      }
    });
    await expect(context.collector.collect(attempt,context.cwd)).rejects.toThrow(/已变化/);
    expect(await readdir(context.collector.archiveRoot)).toEqual([]);
    expect((await readdir(join(context.dataDir,'staging'))).some(name=>name.endsWith('.invalidated'))).toBe(true);
    expect(context.store.state.attempts[0]!.archiveId).toBeNull();
    if(context.store.healthy&&kind==='cancel'){await context.collector.reconcile();expect(context.store.state.attempts[0]!.archiveId).toBeNull();}
  });
  it.each(['cancel','close','storage'])('does not publish if %s changes at the post-verification boundary', async kind=>{
    const context=await setup();const attempt=await dispatched(context);
    await submitFile(context,result(context.task.id,attempt.id));
    const verify=context.collector.verify.bind(context.collector);
    vi.spyOn(context.collector,'verify').mockImplementation(async(...args)=>{
      const manifest=await verify(...args);
      if(kind==='cancel')await context.store.command({type:'task.action',id:context.task.id,action:{operation_id:'cancel-boundary',action:'cancel'}});
      if(kind==='close')await context.collector.close();
      if(kind==='storage')await context.store.close();
      return manifest;
    });
    await expect(context.collector.collect(attempt,context.cwd)).rejects.toThrow(/已变化/);
    expect(await readdir(context.collector.archiveRoot)).toEqual([]);
    expect(context.store.state.attempts[0]!.archiveId).toBeNull();
  });
  it('reclaims a previously orphaned slot only after observing the real child exit',async()=>{
    const context=await setup({maxJobs:1});
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    await once(child,'spawn');const start=processIdentity(child.pid!);expect(start).toBeTruthy();
    await context.store.command({type:'job',job:{id:'reaped-job',taskId:context.task.id,attemptId:'orphan-attempt',kind:'collect',generation:'old',staging:join(context.dataDir,'quarantine'),pid:child.pid!,processStart:start,status:'orphaned',reason:'still alive at startup'}});
    const close=once(child,'close');child.kill('SIGTERM');await close;
    await context.collector.reapOrphans();expect(context.store.state.jobs[0]!.status).toBe('failed');
    await expect(context.collector.prepare(context.task,context.cwd,frozen(context.cwd),'11111111-1111-4111-8111-111111111111')).resolves.toEqual(frozen(context.cwd));
  });
  it('archives complete artifacts, preserves source ownership and freezes independent downstream copies (V09/V17)', async () => {
    const context = await setup();
    const attempt = await dispatched(context, frozen(context.cwd, { requiredArtifacts: ['报告'] }));
    await writeFile(join(context.cwd, 'report.txt'), 'original artifact');
    await submitFile(context, result(context.task.id, attempt.id, { artifacts: [{ root_id: 'workdir', path: 'report.txt', label: '报告' }] }));
    await context.collector.collect(attempt, context.cwd);
    const saved = context.store.state.attempts[0]!;
    expect(saved).toMatchObject({ phase: 'collecting', occupies: true, result: { outcome: 'succeeded' } });
    expect(context.store.state.jobs.every(job => job.status === 'finished')).toBe(true);
    const artifact = context.store.state.artifacts[0]!;
    expect(artifact).toMatchObject({ attemptId: attempt.id, taskId: context.task.id, sourcePath: 'report.txt', rootId: 'workdir', label: '报告' });
    const archived = join(context.collector.archiveRoot, artifact.archiveId, artifact.file);
    expect(await readFile(archived, 'utf8')).toBe('original artifact');
    await writeFile(join(context.cwd, 'report.txt'), 'changed after publication');
    expect(await readFile(archived, 'utf8')).toBe('original artifact');
    await context.store.command({ type: 'observe', observations: [observation({ cwd: context.cwd, status: 'idle', sequence: 12 })] });
    const next = (await context.store.command<Task>({ type: 'task.create', data: taskInput(context.project.id, { dependencies: [{ taskId: context.task.id, artifacts: [artifact.id] }] }) })).result;
    const input = frozen(context.cwd, { dependencies: [{ taskId: context.task.id, attemptId: attempt.id, summary: '已完成', artifacts: [{ id: artifact.id, file: `${artifact.archiveId}/${artifact.file}`, sha256: artifact.sha256 }] }] });
    const prepared = await context.collector.prepare(next, context.cwd, input, '22222222-2222-4222-8222-222222222222');
    const copy = prepared.dependencies[0]!.artifacts[0]!;
    expect(copy.file).toBe(join(context.cwd, '.meteor-flow/runs/22222222-2222-4222-8222-222222222222/inputs', `${artifact.id}.bin`));
    expect(await readFile(copy.file, 'utf8')).toBe('original artifact');
    expect(input.dependencies[0]!.artifacts[0]!.file).toBe(`${artifact.archiveId}/${artifact.file}`);
    expect(context.store.state.attempts[0]!.phase).toBe('succeeded');
  });

  it.each(['traversal', 'symlink', 'fifo', 'oversized', 'missing-required', 'old-attempt'])('rejects %s without publishing a partial archive (V09/V13/V22)', async kind => {
    const context = await setup();
    const attempt = await dispatched(context, frozen(context.cwd, { requiredArtifacts: kind === 'missing-required' ? ['missing.txt'] : [] }));
    let path = 'report.txt';
    if (kind === 'traversal') { path = '../outside.txt'; await writeFile(join(context.directory, 'outside.txt'), 'private outside'); }
    else if (kind === 'symlink') { await writeFile(join(context.directory, 'outside.txt'), 'private outside'); await symlink(join(context.directory, 'outside.txt'), join(context.cwd, path)); }
    else if (kind === 'fifo') execFileSync('/usr/bin/mkfifo', [join(context.cwd, path)]);
    else { await writeFile(join(context.cwd, path), 'artifact'); if (kind === 'oversized') await truncate(join(context.cwd, path), 50 * 1024 * 1024 + 1); }
    await submitFile(context, result(context.task.id, kind === 'old-attempt' ? 'old-attempt' : attempt.id, { artifacts: kind === 'missing-required' ? [] : [{ root_id: 'workdir', path, label: '报告' }] }));
    await expect(context.collector.collect(attempt, context.cwd)).rejects.toThrow();
    expect(await readdir(context.collector.archiveRoot)).toEqual([]);
    expect(context.store.state.artifacts).toEqual([]);
    expect(context.store.state.attempts[0]).toMatchObject({ occupies: true, result: null, archiveId: null });
    expect(context.store.state.jobs.at(-1)!.status).toBe('failed');
  });

  it('waits for process exit and channel closure after a successful candidate message', async () => {
    const context = await setup({ childURL: new URL('../../../../tests/fixtures/collector-exit-gate.mjs', import.meta.url) });
    let finished = false;
    const preparing = context.collector.prepare(context.task, context.cwd, frozen(context.cwd), '11111111-1111-4111-8111-111111111111').then(value => { finished = true; return value; });
    await expect.poll(async () => {
      const job = context.store.state.jobs[0];
      if (!job) return false;
      try { await access(join(job.staging, 'candidate-sent')); return true; } catch { return false; }
    }).toBe(true);
    expect(finished).toBe(false);
    expect(context.store.state.jobs[0]!.status).toBe('running');
    await writeFile(join(context.store.state.jobs[0]!.staging, 'release'), 'exit-now');
    expect(await preparing).toEqual(frozen(context.cwd));
    expect(finished).toBe(true);
    expect(context.store.state.jobs[0]!.status).toBe('finished');
  });

  it('kills and reaps a timed-out writer even after it sent a success candidate', async () => {
    const context = await setup({ childURL: new URL('../../../../tests/fixtures/collector-exit-gate.mjs', import.meta.url), timeoutMs: 1500 });
    const preparing = context.collector.prepare(context.task, context.cwd, frozen(context.cwd), '11111111-1111-4111-8111-111111111111');
    const failure = expect(preparing).rejects.toThrow(/超时/);
    await expect.poll(async () => {
      const job = context.store.state.jobs[0];
      if (!job) return false;
      try { await access(join(job.staging, 'candidate-sent')); return true; } catch { return false; }
    }).toBe(true);
    await failure;
    expect(context.store.state.jobs[0]!.status).toBe('failed');
    expect(await readdir(context.collector.archiveRoot)).toEqual([]);
  });

  it('reserves capacity for an unidentified orphan instead of spawning another writer', async () => {
    const context = await setup({ maxJobs: 1 });
    await context.store.command({ type: 'job', job: { id: 'unknown-job', taskId: context.task.id, attemptId: 'old-attempt', kind: 'collect', generation: 'old', staging: join(context.dataDir, 'old-staging'), pid: null, processStart: null, status: 'orphaned', reason: 'missing identity' } });
    await context.collector.reconcile();
    await expect(context.collector.prepare(context.task, context.cwd, frozen(context.cwd), '11111111-1111-4111-8111-111111111111')).rejects.toThrow(/容量已满/);
    expect(context.store.state.jobs).toHaveLength(1);
    expect(context.store.state.jobs[0]!.status).toBe('orphaned');
  });

  it('reserves capacity atomically when two preparations arrive together', async () => {
    const context = await setup({ maxJobs: 1, childURL: new URL('../../../../tests/fixtures/collector-exit-gate.mjs', import.meta.url) });
    let rejections = 0;
    const run = (id: string) => context.collector.prepare(context.task, context.cwd, frozen(context.cwd), id).catch(error => { rejections++; return error as Error; });
    const first = run('11111111-1111-4111-8111-111111111111');
    const second = run('22222222-2222-4222-8222-222222222222');
    try {
      await expect.poll(() => rejections > 0 || context.store.state.jobs.length > 1).toBe(true);
      await expect.poll(() => context.store.state.jobs.length).toBeGreaterThan(0);
      expect(context.store.state.jobs.filter(job => ['intent', 'running', 'orphaned'].includes(job.status))).toHaveLength(1);
      expect(rejections).toBe(1);
    } finally {
      await context.collector.close();
      await Promise.all([first, second]);
    }
  });
});
