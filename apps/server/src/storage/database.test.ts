import Database from 'better-sqlite3';
import { mkdtemp, rm, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Attempt, Project, Task } from '@meteor-flow/contracts';
import { Repository } from './database.js';
import { binding, frozen, result, taskInput } from '../../../../tests/fixtures/storage-support.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
async function fixture() {
  const directory = await mkdtemp('/tmp/mf-db-');
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'state.sqlite');
  const repository = await Repository.open(file, 'meteor-flow-test-state');
  cleanup.push(async () => repository.close());
  return { repository, file, directory };
}
function seed(repository: Repository) {
  const project = repository.execute({ type: 'project.create', data: { name: '测试项目', root: '/tmp/project' } }).result as Project;
  repository.execute({ type: 'binding.create', data: binding(project.id) });
  const task = repository.execute({ type: 'task.create', data: taskInput(project.id) }).result as Task;
  return { project, task };
}

describe('real SQLite transactional repository', () => {
  it('persists one operation and one task for duplicate browser submissions (V03)', async () => {
    const { repository, file } = await fixture();
    const { project } = seed(repository);
    const command = { type: 'task.create' as const, data: taskInput(project.id, { operation_id: 'same-browser-action' }) };
    const operation = { id: 'same-browser-action', digest: 'same-request' };
    const first = repository.execute(command, operation);
    const replay = repository.execute(command, operation);
    expect(replay).toMatchObject({ replayed: true, result: first.result });
    expect(repository.read().tasks).toHaveLength(2);
    expect(repository.read().operations).toHaveLength(1);
    expect(() => repository.execute(command, { ...operation, digest: 'different-request' })).toThrow(/不同请求/);
    const raw = new Database(file, { readonly: true });
    try {
      expect(raw.prepare('SELECT count(*) AS n FROM operations').get()).toEqual({ n: 1 });
      expect(raw.pragma('user_version', { simple: true })).toBe(1);
      expect(raw.pragma('journal_mode', { simple: true })).toBe('wal');
    } finally { raw.close(); }
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('rolls back state, events and operation record when any FK write fails', async () => {
    const { repository } = await fixture();
    const { task } = seed(repository);
    repository.execute({ type: 'dispatch', taskId: task.id, id: 'attempt-1', input: frozen() });
    const before = repository.read();
    expect(() => repository.execute({ type: 'result', id: 'attempt-1', result: result(task.id, 'attempt-1'), hash: 'hash', archiveId: 'archive-1', artifacts: [{ id: 'artifact-1', taskId: 'missing-task', attemptId: 'attempt-1', label: 'report', rootId: 'workdir', sourcePath: 'a.txt', archiveId: 'archive-1', file: 'a.bin', sha256: 'hash', size: 1 }] }, { id: 'bad-result', digest: 'bad-result' })).toThrow();
    expect(repository.read()).toEqual(before);
    expect(repository.read().attempts[0]!.result).toBeNull();
  });

  it('rejects a cycle without mutating task revision, dependencies or timeline (V16)', async () => {
    const { repository } = await fixture();
    const { project, task } = seed(repository);
    const dependent = repository.execute({ type: 'task.create', data: taskInput(project.id, { dependencies: [{ taskId: task.id, artifacts: [] }] }) }).result as Task;
    const before = repository.read();
    expect(() => repository.execute({ type: 'task.update', id: task.id, revision: task.revision, data: taskInput(project.id, { dependencies: [{ taskId: dependent.id, artifacts: [] }] }) })).toThrow(/循环/);
    expect(repository.read()).toEqual(before);
  });

  it('stores a dispatch intent once and denies another active attempt on the binding', async () => {
    const { repository } = await fixture(); const { project, task } = seed(repository);
    const next = repository.execute({ type: 'task.create', data: taskInput(project.id) }).result as Task;
    const operation = { id: 'dispatch-once', digest: 'dispatch-intent' };
    const command = { type: 'dispatch' as const, taskId: task.id, id: 'attempt-1', input: frozen() };
    repository.execute(command, operation);
    expect(repository.execute(command, operation).replayed).toBe(true);
    expect(() => repository.execute({ ...command, taskId: next.id, id: 'attempt-2' })).toThrow(/当前执行/);
    expect(repository.read().attempts).toHaveLength(1);
    expect((repository.read().attempts[0] as Attempt).occupies).toBe(true);
  });

  it('backs up an existing v0 database before migration and refuses a future version', async () => {
    const directory = await mkdtemp('/tmp/mf-migrate-');
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const file = join(directory, 'state.sqlite');
    const initial = new Database(file); initial.exec('CREATE TABLE legacy_note(value TEXT)'); initial.close();
    const migrated = await Repository.open(file, 'meteor-flow-test-migration'); migrated.close();
    const backups = (await readdir(directory)).filter(name => name.endsWith('.bak'));
    expect(backups).toHaveLength(1);
    expect((await stat(join(directory,backups[0]!))).mode&0o777).toBe(0o600);
    const backup = new Database(join(directory, backups[0]!), { readonly: true });
    try { expect(backup.pragma('user_version', { simple: true })).toBe(0); expect(backup.prepare("SELECT name FROM sqlite_master WHERE name='legacy_note'").get()).toEqual({ name: 'legacy_note' }); } finally { backup.close(); }
    const future = new Database(file); future.pragma('user_version = 2'); future.close();
    await expect(Repository.open(file, 'meteor-flow-test-migration')).rejects.toThrow(/拒绝自动降级/);
  });
});
