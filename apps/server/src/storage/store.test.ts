import { mkdtemp, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Project, Task } from '@meteor-flow/contracts';
import { binding, taskInput } from '../../../../tests/fixtures/storage-support.js';
import { Repository } from './database.js';
import { Store } from './store.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
async function setup(workerURL = new URL('../../dist/storage/worker.js', import.meta.url), deadlineMs = 3000) {
  const directory = await mkdtemp('/tmp/mf-store-');
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'state.sqlite');
  const store = new Store(file, 'meteor-flow-test-state', { workerURL, deadlineMs });
  cleanup.push(() => store.close()); await store.open();
  return { store, file };
}

describe('dedicated real database writer', () => {
  it('publishes exactly the committed database state across updates, replays, rejected writes and reopening',async()=>{
    const {store,file}=await setup();
    const project=(await store.command<Project>({type:'project.create',data:{name:'patch state',root:'/tmp/patch-state'}})).result;
    await store.command({type:'binding.create',data:binding(project.id)});
    const task=(await store.command<Task>({type:'task.create',data:taskInput(project.id)})).result;
    const before=structuredClone(store.state);
    const oldSnapshot=store.state;
    const cancel={type:'task.action' as const,id:task.id,action:{operation_id:'cancel-patch',action:'cancel' as const}};
    await store.command(cancel,{id:'cancel-patch',digest:'cancel-patch'});
    await store.command({type:'settings',paused:true,concurrency:4});
    await store.command(cancel,{id:'cancel-patch',digest:'cancel-patch'});
    const accepted=structuredClone(store.state);
    await expect(store.command(cancel,{id:'cancel-patch',digest:'changed'})).rejects.toMatchObject({code:'OPERATION_CONFLICT'});
    expect(store.state).toEqual(accepted);expect(oldSnapshot).toEqual(before);
    expect(store.state.tasks[0]).toMatchObject({id:task.id,phase:'cancelled'});
    expect(store.state.events.map(row=>row.seq)).toEqual([1,2,3,4,5]);
    expect(store.state.operations).toHaveLength(1);
    await store.close();
    const database=await Repository.open(file,'meteor-flow-test-state');
    try{expect(database.read()).toEqual(accepted);}finally{database.close();}
    const reopened=new Store(file,'meteor-flow-test-state',{workerURL:new URL('../../dist/storage/worker.js',import.meta.url)});
    cleanup.push(()=>reopened.close());await reopened.open();expect(reopened.state).toEqual(accepted);
    await reopened.command({type:'note',message:'new writer after full snapshot'});
    expect(reopened.state.events.at(-1)).toMatchObject({seq:6,message:'new writer after full snapshot'});
    expect(reopened.state.tasks).toEqual(accepted.tasks);
  });
  it('does not create a writer when close wins the asynchronous opening boundary',async()=>{
    const directory=await mkdtemp('/tmp/mf-store-close-');cleanup.push(()=>rm(directory,{recursive:true,force:true}));
    const store=new Store(join(directory,'state.sqlite'),'isolated',{workerURL:new URL('../../dist/storage/worker.js',import.meta.url)});
    cleanup.push(()=>store.close());
    const opening=store.open();const rejected=expect(opening).rejects.toThrow(/已关闭/);
    await store.close();await rejected;expect(store.healthy).toBe(false);
  });
  it('serializes concurrent identical operations to one persisted project (V03)', async () => {
    const { store } = await setup();
    const command = { type: 'project.create' as const, data: { name: '同一项目', root: '/tmp/project' } };
    const replies = await Promise.all(Array.from({ length: 5 }, () => store.command<Project>(command, { id: 'same-op', digest: 'same-request' })));
    expect(new Set(replies.map(r => r.result.id)).size).toBe(1);
    expect(replies.filter(r => !r.replayed)).toHaveLength(1);
    expect(store.state.projects).toHaveLength(1);
    expect(store.healthy).toBe(true);
  });

  it('keeps the writer healthy after a domain conflict', async () => {
    const { store } = await setup();
    const command = { type: 'project.create' as const, data: { name: '项目', root: '/tmp/project' } };
    await store.command(command, { id: 'same-op', digest: 'first' });
    await expect(store.command(command, { id: 'same-op', digest: 'conflict' })).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    expect(store.healthy).toBe(true);
    await store.command({ type: 'note', message: 'still available' });
    expect(store.state.events.at(-1)?.message).toBe('still available');
  });

  it('recovers a committed-but-unacknowledged transaction without creating a second writer or replaying work (V04/V24)', async () => {
    const { store, file } = await setup(new URL('../../../../tests/fixtures/storage-drop-reply.mjs', import.meta.url), 500);
    const oldGeneration = store.generation;
    let refusedWhileAlive: Promise<unknown> | undefined;
    store.once('fault', () => { refusedWhileAlive = expect(store.open()).rejects.toThrow(/旧 writer/); });
    const command = store.command({ type: 'project.create', data: { name: '已提交响应丢失', root: '/tmp/project' } }, { id: 'drop-reply', digest: 'one-commit' });
    const failure = expect(command).rejects.toMatchObject({ code: 'STORAGE' });
    await expect.poll(async () => { try { await access(`${file}.committed`); return true; } catch { return false; } }).toBe(true);
    await failure; await refusedWhileAlive;
    expect(store.healthy).toBe(false);
    expect(store.generation).not.toBe(oldGeneration);
    await store.recover();
    expect(store.healthy).toBe(true);
    expect(store.state.projects).toHaveLength(1);
    expect(store.state.operations.filter(o => o.id === 'drop-reply')).toHaveLength(1);
    expect(store.state.events.filter(e => e.type === 'project.create')).toHaveLength(1);
    expect(store.state.events.at(-1)?.type).toBe('recover');
  });
});

it('fails closed on a real SQLITE_FULL commit failure without publishing or recording the operation (V25)',async()=>{
  const {store,file}=await setup(new URL('../../../../tests/fixtures/storage-full.mjs',import.meta.url));
  const generation=store.generation;
  await expect(store.command({type:'note',message:'x'.repeat(1024*1024)},{id:'full-transaction',digest:'full'})).rejects.toMatchObject({code:'STORAGE',message:'SQLITE_FULL'});
  expect(store.healthy).toBe(false);expect(store.generation).not.toBe(generation);
  await expect(store.command({type:'note',message:'must not write'})).rejects.toMatchObject({code:'STORAGE'});
  await store.close();
  const recovered=new Store(file,'meteor-flow-test-state',{workerURL:new URL('../../dist/storage/worker.js',import.meta.url)});cleanup.push(()=>recovered.close());await recovered.open();
  expect(recovered.state.operations).toEqual([]);expect(recovered.state.events).toEqual([]);
});
