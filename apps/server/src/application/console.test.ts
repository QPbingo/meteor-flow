import { mkdtemp, mkdir, realpath, rm, chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { processIdentity } from '@meteor-flow/posix-fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { Binding, Task } from '@meteor-flow/contracts';
import { AgentConsole } from '../../dist/application/console.js';
import { FakeHerdr, gate } from '../../../../tests/fixtures/fake-herdr.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
async function setup(agentCount = 1) {
  const directory = await realpath(await mkdtemp('/tmp/mf-console-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const dataDir = join(directory, 'data'); const projectRoot = join(directory, 'project');
  await mkdir(dataDir); await mkdir(projectRoot);
  const directories = await Promise.all(Array.from({ length: agentCount }, async (_, index) => {
    const cwd = join(projectRoot, `work-${index + 1}`); await mkdir(cwd); return cwd;
  }));
  const fake = new FakeHerdr({ agents: directories.map((cwd, index) => ({ terminalId: `terminal-${index + 1}`, cwd })) });
  const console = new AgentConsole({ dataDir, session: fake.session, executable: '/unused-herdr', portFactory: () => fake, pollMs: 1_000_000, minFreeBytes: 0 });
  cleanup.push(() => console.close()); await console.open();
  const project = await console.createProject({ operation_id: 'create-project', name: '真实核心测试项目', root: projectRoot });
  return { directory, directories, dataDir, projectRoot, fake, console, project };
}
async function attach(context: Awaited<ReturnType<typeof setup>>, terminalId = 'terminal-1') {
  const binding = await context.console.attach({ operation_id: `attach-${terminalId}`, projectId: context.project.id, terminalId, label: terminalId }) as Binding;
  await context.console.bindingAction(binding.id, { operation_id: `confirm-${terminalId}`, action: 'confirm', evidence: '测试独立目录、会话及结果能力已确认' });
  await context.console.bindingAction(binding.id, { operation_id: `auto-${terminalId}`, action: 'automatic' });
  return binding;
}
async function task(context: Awaited<ReturnType<typeof setup>>, bindingId: string, operationId = 'create-task', dependencies: Array<{ taskId: string; artifacts: string[] }> = []) {
  return await context.console.saveTask({ operation_id: operationId, projectId: context.project.id, bindingId, title: operationId, instructions: '测试任务', dependencies, requiredArtifacts: [], outputRoots: [] }) as Task;
}

describe('application orchestration against real DB and collectors', () => {
  it('persists first-session identification with the active attempt and never restores authorization after reopening', async () => {
    const context = await setup(); const agent = context.fake.agents.get('terminal-1')!;
    agent.agentSession = null; agent.instanceFingerprint = 'continuous-instance';
    const b = await attach(context); await task(context, b.id); await context.console.tick();
    agent.agentSession = 'first-session'; agent.fingerprint = 'identified-instance'; context.fake.setStatus('terminal-1', 'working');
    await context.console.refresh(); await context.console.refresh();
    expect(context.console.store.state.bindings[0]).toMatchObject({ confirmed: true, agentSession: 'first-session', fingerprint: 'identified-instance' });
    expect(context.console.store.state.attempts[0]).toMatchObject({ identity: { agentSession: 'first-session' }, fingerprint: 'identified-instance', seenActivity: true });
    expect(context.console.store.state.events.filter(e => e.type === 'agent.session-identified')).toHaveLength(1);
    await context.console.close();
    const reopened = new AgentConsole({ dataDir: context.dataDir, session: context.fake.session, executable: 'unused', portFactory: () => context.fake, pollMs: 1_000_000, minFreeBytes: 0 });
    cleanup.push(() => reopened.close()); await reopened.open();
    expect(reopened.store.state.bindings[0]).toMatchObject({ confirmed: false, mode: 'observe', sessionIdentificationBlocked: true });
    expect(reopened.store.state.attempts[0]).toMatchObject({ identity: { agentSession: 'first-session' }, occupies: true, phase: 'needs_confirmation' });
    expect(context.fake.prompts).toHaveLength(1);
  });
  it('releases an old attempt only after its own process exits even when its terminal now contains a replacement',async()=>{
    const context=await setup();const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});const closed=once(child,'close');
    cleanup.push(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed;}});
    await once(child,'spawn');const original=processIdentity(child.pid!);expect(original).toBeTruthy();
    const agent=context.fake.agents.get('terminal-1')!;agent.pid=child.pid!;agent.processStart=original;
    const b=await attach(context);const created=await task(context,b.id);await context.console.tick();
    agent.pid=process.pid;agent.processStart=processIdentity(process.pid);agent.fingerprint=randomUUID();
    await context.console.refresh();
    const manual={action:'record-conclusion' as const,outcome:'cancelled' as const,stopped:true,reason:'旧执行已核对',evidence:'对照旧PID和启动身份'};
    await context.console.taskAction(created.id,{...manual,operation_id:'old-still-alive'});
    expect(context.console.store.state.attempts[0]!.occupies).toBe(true);
    child.kill('SIGTERM');await closed;
    await context.console.taskAction(created.id,{...manual,operation_id:'old-exited'});
    expect(context.console.store.state.attempts[0]).toMatchObject({phase:'cancelled',occupies:false,source:'manual'});
    expect(context.console.store.state.bindings[0]).toMatchObject({confirmed:false,mode:'observe',paused:true});
    expect(context.fake.interrupts).toEqual([]);
  });

  it('requires fresh observations and explicit manual evidence to resolve an unknown start without any external side effect',async()=>{
    const context=await setup();const pending=gate();context.fake.onStart=async()=>{await pending.promise;throw new Error('lost start acknowledgement');};
    const payload={operation_id:'unknown-for-resolution',projectId:context.project.id,type:'codex' as const,cwd:join(context.projectRoot,'unknown-start'),label:'待核对启动'};
    const intent=await context.console.start(payload);const data={operation_id:'resolve-unknown',evidence:'已在原生herdr核对全部相关窗格与进程，原启动未创建',confirmedStopped:true as const};
    try{await expect(context.console.resolveStart(intent.id,data)).rejects.toThrow(/只有结果未知/);}finally{pending.release();}
    await expect.poll(()=>context.console.store.state.starts[0]?.status).toBe('unknown');
    await expect(context.console.resolveStart(intent.id,{...data,evidence:' '})).rejects.toThrow(/证据/);
    context.fake.addAgent({terminalId:'late-agent',cwd:payload.cwd});
    await expect(context.console.resolveStart(intent.id,data)).rejects.toThrow(/仍有 Agent/);
    context.fake.agents.delete('late-agent');context.fake.onList=async()=>{throw new Error('discovery unavailable');};
    await expect(context.console.resolveStart(intent.id,data)).rejects.toThrow(/discovery unavailable/);
    context.fake.onList=undefined;
    const resolved=await context.console.resolveStart(intent.id,data);
    expect(resolved).toMatchObject({status:'dismissed',resolution:{source:'manual',evidence:data.evidence}});
    context.fake.onList=async()=>{throw new Error('discovery unavailable');};
    expect(await context.console.resolveStart(intent.id,data)).toEqual(resolved);
    await expect(context.console.resolveStart(intent.id,{...data,evidence:'不同声明'})).rejects.toThrow(/同一操作标识/);
    expect(context.fake.starts).toHaveLength(1);expect(context.fake.interrupts).toEqual([]);
    expect(context.console.store.state.events.filter(event=>event.type==='start.resolve')).toHaveLength(1);
    context.fake.onList=undefined;context.fake.onStart=undefined;
    await context.console.switchSession(context.fake.session,'switch-after-resolution');
    await context.console.start({...payload,operation_id:'new-explicit-start'});
    await expect.poll(()=>context.fake.starts.length).toBe(2);
  });

  it('starts on the session accepted by the command queue when a session switch finishes first',async()=>{
    const context=await setup();const nextPort=new FakeHerdr({session:'meteor-next-session'});
    context.console.options.portFactory=()=>nextPort;
    const validating=gate();const release=gate();
    const switching=context.console.switchSession(nextPort.session,'switch-before-start',async()=>{validating.release();await release.promise;});
    await validating.promise;
    const starting=context.console.start({operation_id:'queued-start',projectId:context.project.id,type:'codex',cwd:join(context.projectRoot,'queued-start'),label:'排队启动'});
    release.release();await switching;const intent=await starting;
    await expect.poll(()=>context.console.store.state.starts.find(row=>row.id===intent.id)?.status).toBe('started');
    expect(context.fake.starts).toEqual([]);expect(nextPort.starts).toHaveLength(1);
    expect(context.console.store.state.settings.session).toBe(nextPort.session);
  });

  it('keeps a conflicting result pending across idle observations and restart until an explicit manual conclusion',async()=>{
    const context=await setup();const b=await attach(context);const created=await task(context,b.id);
    await context.console.tick();const attempt=context.console.store.state.attempts[0]!;
    context.fake.setStatus('terminal-1','working');await context.console.refresh();
    const file=join(context.directories[0]!,'.meteor-flow','runs',attempt.id,'result.json');
    const original=JSON.stringify({protocol:'meteor-flow.result/v1',task_id:created.id,attempt_id:attempt.id,outcome:'succeeded',summary:'原始有效声明',artifacts:[]});
    await writeFile(file,original);await context.console.tick();
    await expect.poll(()=>context.console.store.state.attempts[0]?.resultHash).toBeTruthy();
    const acceptedHash=context.console.store.state.attempts[0]!.resultHash;
    await writeFile(file,original.replace('原始有效声明','冲突声明'));await context.console.tick();
    expect(context.console.store.state.attempts[0]!.phase).toBe('needs_confirmation');
    context.fake.setStatus('terminal-1','idle');await context.console.tick();
    expect(context.console.store.state.attempts[0]).toMatchObject({phase:'needs_confirmation',occupies:true,resultHash:acceptedHash});
    await context.console.close();
    const recovered=new AgentConsole({...context.console.options,portFactory:()=>context.fake});cleanup.push(()=>recovered.close());await recovered.open();
    await writeFile(file,original);await recovered.tick();
    expect(recovered.store.state.attempts[0]).toMatchObject({phase:'needs_confirmation',occupies:true,resultHash:acceptedHash});
    expect(recovered.store.state.events.filter(event=>event.type==='result.conflict')).toHaveLength(1);
    await recovered.taskAction(created.id,{operation_id:'resolve-conflict',action:'record-conclusion',outcome:'succeeded',reason:'保留已经核验的原归档',evidence:'已比较声明与归档，确认当前进程空闲',stopped:true});
    expect(recovered.store.state.attempts[0]).toMatchObject({phase:'succeeded',occupies:false,source:'manual',resultHash:acceptedHash});
  });

  it('allows explicitly confirmed existing agents even without managed interactive readiness', async () => {
    const context = await setup();
    context.fake.agents.get('terminal-1')!.interactiveReady = false;
    const b = await attach(context);
    expect(context.console.store.state.bindings.find(row => row.id === b.id)).toMatchObject({ confirmed: true, mode: 'automatic', managed: false });
    const created = await task(context, b.id);
    await context.console.tick();
    expect(context.fake.prompts).toHaveLength(1);
    expect(context.fake.prompts[0]!.text).toContain(created.id);
    expect(context.console.store.state.attempts[0]).toMatchObject({ taskId: created.id, dispatch: 'submitted', occupies: true });
  });

  it('a manual switch after preparation but before final dispatch prevents all prompt input', async () => {
    const context = await setup(); const b = await attach(context); await task(context, b.id);
    const finalRead = gate(); const observedIntent = gate();
    context.fake.onList = async () => {
      if (context.console.store.state.attempts.some(a => a.dispatch === 'intent')) { observedIntent.release(); await finalRead.promise; }
    };
    const ticking = context.console.tick();
    try {
      await observedIntent.promise;
      await context.console.bindingAction(b.id, { operation_id: 'manual-before-send', action: 'manual' });
      finalRead.release(); await ticking;
      expect(context.fake.prompts).toEqual([]);
      expect(context.console.store.state.attempts[0]).toMatchObject({ dispatch: 'not_sent', phase: 'needs_confirmation', occupies: true });
    } finally { finalRead.release(); await ticking; }
  });

  it('accepts cancel while prompt acknowledgement is pending, sends one interrupt and retains occupancy (V03/V11/V12)', async () => {
    const context = await setup(); const b = await attach(context); const created = await task(context, b.id);
    const promptResponse = gate(); const promptSent = gate();
    context.fake.onPrompt = async () => { promptSent.release(); await promptResponse.promise; };
    const ticking = context.console.tick();
    try {
      await promptSent.promise;
      const cancellation = { operation_id: 'cancel-once', action: 'cancel' as const };
      await Promise.all([context.console.taskAction(created.id, cancellation), context.console.taskAction(created.id, cancellation)]);
      await expect.poll(() => context.fake.interrupts.length).toBe(1);
      expect(context.console.store.state.attempts[0]).toMatchObject({ cancelRequested: true, occupies: true, phase: 'cancelling' });
      promptResponse.release(); await ticking;
      expect(context.console.store.state.attempts[0]).toMatchObject({ dispatch: 'submitted', cancelRequested: true, phase: 'cancelling' });
      context.fake.setStatus('terminal-1', 'working'); await context.console.tick();
      context.fake.setStatus('terminal-1', 'idle'); await context.console.tick();
      expect(context.console.store.state.tasks[0]!.phase).toBe('cancelled');
      expect(context.console.store.state.attempts[0]!.occupies).toBe(false);
      expect(context.fake.prompts).toHaveLength(1);
      expect(context.fake.interrupts).toHaveLength(1);
    } finally { promptResponse.release(); await ticking; }
  });

  it('never retries a prompt with a lost acknowledgement, including after service restart (V04/V05/V24)', async () => {
    const context = await setup(); const b = await attach(context); await task(context, b.id);
    context.fake.onPrompt = async () => { throw new Error('injected acknowledgement loss after write'); };
    await context.console.tick(); await context.console.tick();
    expect(context.fake.prompts).toHaveLength(1);
    expect(context.console.store.state.attempts[0]).toMatchObject({ dispatch: 'unknown', occupies: true, phase: 'needs_confirmation' });
    await context.console.close();
    const replacement = new FakeHerdr({ agents: [{ terminalId: 'terminal-1', cwd: context.directories[0]! }] });
    const recovered = new AgentConsole({ dataDir: context.dataDir, session: replacement.session, executable: '/unused-herdr', portFactory: () => replacement, pollMs: 1_000_000, minFreeBytes: 0 });
    cleanup.push(() => recovered.close()); await recovered.open(); await recovered.tick();
    expect(replacement.prompts).toEqual([]);
    expect(recovered.store.state.attempts).toHaveLength(1);
    expect(recovered.store.state.attempts[0]).toMatchObject({ dispatch: 'unknown', occupies: true, phase: 'needs_confirmation' });
    expect(recovered.store.state.bindings[0]).toMatchObject({ confirmed: false, mode: 'observe' });
  });

  it('persists a startup intent once and preserves an unknown startup without repeating it (V03/V06)', async () => {
    const context = await setup(); const startup = gate(); const started = gate();
    context.fake.onStart = async () => { started.release(); await startup.promise; throw new Error('startup response lost'); };
    const data = { operation_id: 'start-once', projectId: context.project.id, type: 'codex' as const, cwd: join(context.projectRoot, 'new-agent'), label: '托管 Agent' };
    const [first, replay] = await Promise.all([context.console.start(data), context.console.start(data)]);
    try {
      await started.promise;
      expect(first.id).toBe(replay.id); expect(context.fake.starts).toHaveLength(1);
      startup.release();
      await expect.poll(() => context.console.store.state.starts[0]?.status).toBe('unknown');
      await context.console.start(data);
      expect(context.fake.starts).toHaveLength(1);
      await expect(context.console.start({ ...data, operation_id: 'new-operation-same-directory' })).rejects.toThrow(/未决启动/);
    } finally { startup.release(); }
  });

  it('runs an independent task behind an unmet dependency on another binding (V14)', async () => {
    const context = await setup(2);
    const first = await attach(context, 'terminal-1'); const second = await attach(context, 'terminal-2');
    const upstream = await task(context, first.id, 'upstream');
    const blocked = await task(context, second.id, 'dependent', [{ taskId: upstream.id, artifacts: [] }]);
    const independent = await task(context, second.id, 'independent');
    await context.console.tick(); await context.console.tick();
    expect(context.fake.prompts.map(call => call.target)).toEqual(['terminal-1', 'terminal-2']);
    expect(context.console.store.state.tasks.find(row => row.id === blocked.id)!.phase).toBe('queued');
    expect(context.console.store.state.tasks.find(row => row.id === independent.id)!.phase).toBe('dispatching');
  });

  it('rejects confirming an agent whose work directory overlaps private service data (V21/V22)', async () => {
    const context = await setup();
    context.fake.agents.get('terminal-1')!.cwd = context.dataDir;
    const b = await context.console.attach({ operation_id: 'attach-private-dir', projectId: context.project.id, terminalId: 'terminal-1', label: 'private data overlap' }) as Binding;
    await expect(context.console.bindingAction(b.id, { operation_id: 'confirm-private-dir', action: 'confirm', evidence: 'test' })).rejects.toThrow();
    expect(context.console.store.state.bindings[0]!.confirmed).toBe(false);
  });

  it('rejects extra output roots overlapping private service data (V22)', async () => {
    const context = await setup(); const b = await attach(context);
    await expect(context.console.saveTask({ operation_id: 'unsafe-output', projectId: context.project.id, bindingId: b.id, title: 'unsafe output', instructions: 'test', dependencies: [], requiredArtifacts: [], outputRoots: [{ id: 'private-data', path: context.dataDir }] })).rejects.toThrow();
    expect(context.console.store.state.tasks).toEqual([]);
  });

  it('does not start an external agent after storage fails immediately after the durable startup intent', async () => {
    const context = await setup();
    let closing: Promise<void> | undefined;
    const listener = () => {
      if (context.console.store.state.starts.some(start => start.status === 'intent')) {
        context.console.store.off('change', listener);
        closing = context.console.store.close();
      }
    };
    context.console.store.on('change', listener);
    try {
      await context.console.start({ operation_id: 'start-storage-race', projectId: context.project.id, type: 'codex', cwd: join(context.projectRoot, 'storage-race-agent'), label: 'storage-fault-start' });
    } catch { /* A rejected operation is also safe; the external start must not occur. */ }
    await closing;
    expect(context.console.store.healthy).toBe(false);
    expect(context.fake.starts).toEqual([]);
  });

  it('does not send an unrecorded emergency interrupt after storage recovers during identity observation',async()=>{
    const context=await setup();const b=await attach(context);
    await (context.console.store as unknown as {worker:import('node:worker_threads').Worker}).worker.terminate();
    await expect.poll(()=>context.console.store.healthy).toBe(false);
    const entered=gate();const read=gate();context.fake.onList=async()=>{entered.release();await read.promise;};
    const pending=expect(context.console.emergencyInterrupt(b.id)).rejects.toThrow(/故障状态已经变化/);
    try{await entered.promise;await context.console.recoverStorage();read.release();await pending;expect(context.fake.interrupts).toEqual([]);}
    finally{read.release();}
  });

  it('does not dispatch when a real work directory refuses frozen-input writes (V25)',async()=>{
    const context=await setup();const b=await attach(context);await task(context,b.id);
    await chmod(context.directories[0]!,0o500);
    try{
      await context.console.tick();expect(context.fake.prompts).toEqual([]);expect(context.console.store.state.attempts).toEqual([]);
      expect(context.console.store.state.bindings[0]).toMatchObject({paused:true,reason:expect.stringContaining('派发准备失败')});
    }finally{await chmod(context.directories[0]!,0o700);}
  });
});
