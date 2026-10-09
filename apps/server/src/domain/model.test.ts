import { describe, expect, it } from 'vitest';
import type { Attempt, Observation, Task } from '@meteor-flow/contracts';
import { active, fresh, ready, reduce, waiting } from './model.js';
import { binding, frozen, observation, result, stateWithTask, taskInput } from '../../../../tests/fixtures/storage-support.js';

function submitted() {
  const setup = stateWithTask();
  const attempt = reduce(setup.state, { type: 'dispatch', taskId: setup.task.id, id: 'attempt-1', input: frozen() }) as Attempt;
  reduce(setup.state, { type: 'dispatch.result', id: attempt.id, status: 'submitted', reason: 'accepted', baselineSeq: 10 });
  return { ...setup, attempt };
}
function observe(setup: ReturnType<typeof submitted>, status: 'working' | 'idle', sequence: number) {
  reduce(setup.state, { type: 'observe', observations: [observation({ status, sequence })] });
}
function publish(setup: ReturnType<typeof submitted>, outcome: 'succeeded' | 'failed' = 'succeeded') {
  reduce(setup.state, { type: 'result', id: setup.attempt.id, result: result(setup.task.id, setup.attempt.id, { outcome }), hash: `hash-${outcome}`, archiveId: 'archive-1', artifacts: [] });
}

function unidentifiedSession() {
  const setup = stateWithTask(); const b = setup.state.bindings[0]!;
  b.agentSession = null; b.observation = observation({ agentSession: null, instanceFingerprint: 'same-instance' });
  const attempt = reduce(setup.state, { type: 'dispatch', taskId: setup.task.id, id: 'attempt-1', input: frozen() }) as Attempt;
  reduce(setup.state, { type: 'dispatch.result', id: attempt.id, status: 'submitted', reason: 'accepted', baselineSeq: 10 });
  return { ...setup, attempt, b };
}
const identified = (overrides: Partial<Observation> = {}) => observation({ agentSession: 'first-session', instanceFingerprint: 'same-instance', fingerprint: 'identified', status: 'working', sequence: 11, ...overrides });

describe('first session identification without granting new authority', () => {
  it('identifies the same continuously observed instance once and lets its submitted result finish', () => {
    const setup = unidentifiedSession();
    reduce(setup.state, { type: 'observe', observations: [identified()] });
    reduce(setup.state, { type: 'observe', observations: [identified()] });
    expect(setup.b).toMatchObject({ confirmed: true, paused: false, mode: 'automatic', agentSession: 'first-session', fingerprint: 'identified' });
    expect(setup.attempt).toMatchObject({ fingerprint: 'identified', identity: { agentSession: 'first-session' }, dispatch: 'submitted', seenActivity: true });
    expect(setup.state.events.filter(e => e.type === 'agent.session-identified')).toHaveLength(1);
    publish(setup); reduce(setup.state, { type: 'observe', observations: [identified({ status: 'idle', sequence: 12 })] });
    expect(setup.attempt).toMatchObject({ phase: 'succeeded', occupies: false });
  });

  it.each<Partial<Observation>>([
    { instanceFingerprint: undefined }, { instanceFingerprint: 'new-connection' }, { pid: null }, { pid: 101 },
    { processStart: 'reused-pid' }, { cwd: '/tmp/another' }, { type: 'claude' }, { sequence: 9 }, { observedAt: 1 },
  ])('rejects incomplete or discontinuous identity %j', overrides => {
    const setup = unidentifiedSession();
    reduce(setup.state, { type: 'observe', observations: [identified(overrides)] });
    expect(setup.b).toMatchObject({ confirmed: false, mode: 'observe', paused: true });
    expect(setup.attempt).toMatchObject({ occupies: true, phase: 'needs_confirmation', identity: { agentSession: null } });
    expect(setup.state.events.some(e => e.type === 'agent.session-identified')).toBe(false);
  });

  it.each(['missing', 'disconnect', 'stale', 'recover'] as const)('does not wash out a %s gap with a fresh null observation', gap => {
    const setup = unidentifiedSession();
    if (gap === 'missing') reduce(setup.state, { type: 'observe', observations: [] });
    if (gap === 'disconnect') reduce(setup.state, { type: 'disconnect', reason: 'lost connection' });
    if (gap === 'stale') setup.b.observation!.observedAt = 1;
    if (gap === 'recover') reduce(setup.state, { type: 'recover' });
    reduce(setup.state, { type: 'observe', observations: [observation({ agentSession: null, instanceFingerprint: 'same-instance' })] });
    reduce(setup.state, { type: 'observe', observations: [identified()] });
    expect(setup.b).toMatchObject({ confirmed: false, sessionIdentificationBlocked: true });
    expect(setup.attempt.identity.agentSession).toBeNull();
    expect(setup.attempt.occupies).toBe(true);
  });

  it.each(['different-session', null])('revokes confirmation on a later session change to %s', agentSession => {
    const setup = unidentifiedSession();
    reduce(setup.state, { type: 'observe', observations: [identified()] });
    reduce(setup.state, { type: 'observe', observations: [identified({ agentSession, fingerprint: 'later-change', sequence: 12 })] });
    expect(setup.b).toMatchObject({ confirmed: false, mode: 'observe', paused: true });
    expect(setup.attempt.identity.agentSession).toBe('first-session');
    expect(setup.attempt.occupies).toBe(true);
  });

  it('retains manual mode and requires explicit confirmation to reset an identification gap', () => {
    const setup = stateWithTask(); const b = setup.state.bindings[0]!;
    b.agentSession = null; b.observation = observation({ agentSession: null, instanceFingerprint: 'same-instance' });
    reduce(setup.state, { type: 'observe', observations: [] });
    reduce(setup.state, { type: 'observe', observations: [observation({ agentSession: null, instanceFingerprint: 'same-instance' })] });
    reduce(setup.state, { type: 'binding.action', id: b.id, action: { operation_id: 'reconfirm', action: 'confirm', evidence: 'explicit user review' } });
    reduce(setup.state, { type: 'observe', observations: [identified()] });
    expect(b).toMatchObject({ agentSession: 'first-session', confirmed: true, mode: 'manual', paused: true });
  });

  it.each([false, true])('reserves the pre-batch session even if its previous owner is revoked first (reverse=%s)', reverse => {
    const setup = unidentifiedSession();
    const other = binding(setup.project.id, '/tmp/other', { id: 'other', terminalId: 'terminal-2', fingerprint: 'other-old', agentSession: 'first-session', observation: observation({ terminalId: 'terminal-2', fingerprint: 'other-old', cwd: '/tmp/other', agentSession: 'first-session', instanceFingerprint: 'other-instance' }) });
    setup.state.bindings.push(other); if (reverse) setup.state.bindings.reverse();
    const observations = [identified(), observation({ terminalId: 'terminal-2', fingerprint: 'other-replaced', cwd: '/tmp/other', agentSession: 'replacement-session', instanceFingerprint: 'replacement-instance' })];
    reduce(setup.state, { type: 'observe', observations: reverse ? observations.reverse() : observations });
    expect(setup.b.confirmed).toBe(false); expect(other.confirmed).toBe(false);
    expect(setup.attempt.identity.agentSession).toBeNull();
  });

  it('rejects a first session claimed by another observation in the same batch', () => {
    const setup = unidentifiedSession();
    reduce(setup.state, { type: 'observe', observations: [identified(), identified({ terminalId: 'terminal-2', cwd: '/tmp/other', instanceFingerprint: 'other-instance' })] });
    expect(setup.b.confirmed).toBe(false); expect(setup.attempt.identity.agentSession).toBeNull();
  });
});

describe('task and observation state invariants', () => {
  it('keeps published terminal results immutable while persisting and pausing on a later conflicting declaration',()=>{
    const setup=submitted();observe(setup,'working',11);publish(setup);observe(setup,'idle',12);
    reduce(setup.state,{type:'result.conflict',id:setup.attempt.id,hash:'conflicting-hash'});
    reduce(setup.state,{type:'result.conflict',id:setup.attempt.id,hash:'conflicting-hash'});
    expect(setup.attempt).toMatchObject({phase:'succeeded',occupies:false,resultHash:'hash-succeeded',resultConflict:'conflicting-hash'});
    expect(setup.state.bindings[0]!.paused).toBe(true);
    expect(setup.state.events.filter(event=>event.type==='result.conflict')).toHaveLength(1);
  });
  it('does not let collection retry clear a conflict but still allows cancellation to complete after proven activity and stop',()=>{
    const setup=submitted();observe(setup,'working',11);publish(setup);
    reduce(setup.state,{type:'result.conflict',id:setup.attempt.id,hash:'conflicting-hash'});
    expect(()=>reduce(setup.state,{type:'task.action',id:setup.task.id,action:{operation_id:'retry-conflict',action:'retry-collection'}})).toThrow(/冲突/);
    reduce(setup.state,{type:'task.action',id:setup.task.id,action:{operation_id:'cancel-conflict',action:'cancel'}});
    observe(setup,'idle',12);
    expect(setup.attempt).toMatchObject({phase:'cancelled',occupies:false,resultConflict:'conflicting-hash'});
  });
  it('rejects retrying an archived task and allows copying it into a new active task',()=>{
    const setup=submitted();observe(setup,'working',11);publish(setup,'failed');observe(setup,'idle',12);
    reduce(setup.state,{type:'task.action',id:setup.task.id,action:{operation_id:'archive',action:'archive'}});
    expect(()=>reduce(setup.state,{type:'task.action',id:setup.task.id,action:{operation_id:'retry',action:'retry'}})).toThrow(/归档/);
    const copy=reduce(setup.state,{type:'task.action',id:setup.task.id,action:{operation_id:'copy',action:'copy'}}) as Task;
    expect(setup.task).toMatchObject({phase:'failed',archived:true});
    expect(copy).toMatchObject({phase:'queued',archived:false,currentAttemptId:null});
    expect(copy.id).not.toBe(setup.task.id);
  });
  it('keeps cancelled work occupied after the 15 second deadline and only reminds after 30 minutes', () => {
    const setup=submitted();
    reduce(setup.state,{type:'task.action',id:setup.task.id,action:{operation_id:'cancel',action:'cancel'}});
    const at=setup.attempt.cancelAcceptedAt!;
    reduce(setup.state,{type:'check-timeouts',now:at+14999});expect(setup.task.phase).toBe('cancelling');
    reduce(setup.state,{type:'check-timeouts',now:at+15000});expect(setup.task.phase).toBe('needs_confirmation');expect(setup.attempt.occupies).toBe(true);
    const attention=setup.attempt.attentionSince!;
    reduce(setup.state,{type:'check-timeouts',now:attention+30*60*1000});
    reduce(setup.state,{type:'check-timeouts',now:attention+30*60*1000+1});
    expect(setup.state.events.filter(e=>e.type==='attention.reminder')).toHaveLength(1);
    expect(setup.attempt.occupies).toBe(true);expect(setup.task.phase).toBe('needs_confirmation');
  });
  it('accepts existing agents without managed readiness but rejects future/stale observations', () => {
    const b = binding('project');
    expect(ready(b)).toBe(true);
    expect(ready({ ...b, managed: true })).toBe(false);
    expect(fresh(observation({ observedAt: 1001 }), 1000)).toBe(false);
    expect(fresh(observation({ observedAt: 1000 }), 6000)).toBe(false);
    expect(ready({ ...b, observation: observation({ processStart: null }) })).toBe(false);
  });

  it('does not infer success from activity followed by idle without a result (V08)', () => {
    const setup = submitted();
    observe(setup, 'working', 11); observe(setup, 'idle', 12);
    expect(setup.task.phase).toBe('needs_confirmation');
    expect(setup.attempt.occupies).toBe(true);
    expect(setup.state.bindings[0]!.paused).toBe(true);
  });

  it('holds occupancy for a submitted result until this execution ends (V09/V10)', () => {
    const setup = submitted();
    observe(setup, 'working', 11); publish(setup);
    expect(setup.task.phase).toBe('collecting');
    expect(setup.attempt.occupies).toBe(true);
    observe(setup, 'idle', 12);
    expect(setup.task.phase).toBe('succeeded');
    expect(active(setup.state, 'binding-1')).toBeUndefined();
    expect(setup.state.artifacts).toEqual([]);
  });

  it('requires activity from after the final dispatch baseline', () => {
    const setup = submitted();
    observe(setup, 'working', 10); publish(setup); observe(setup, 'idle', 11);
    expect(setup.attempt.seenActivity).toBe(false);
    expect(setup.attempt.occupies).toBe(true);
    expect(setup.task.phase).not.toBe('succeeded');
  });

  it('a committed success remains successful when cancel arrives later (V11)', () => {
    const setup = submitted();
    observe(setup, 'working', 11); observe(setup, 'idle', 12); publish(setup);
    reduce(setup.state, { type: 'task.action', id: setup.task.id, action: { operation_id: 'cancel', action: 'cancel' } });
    expect(setup.task.phase).toBe('succeeded');
    expect(setup.attempt.cancelRequested).toBe(false);
    expect(setup.attempt.occupies).toBe(false);
  });

  it('an accepted cancel keeps later success as late information and waits for stop (V11/V12)', () => {
    const setup = submitted();
    observe(setup, 'working', 11);
    reduce(setup.state, { type: 'task.action', id: setup.task.id, action: { operation_id: 'cancel', action: 'cancel' } });
    publish(setup);
    expect(setup.task.phase).toBe('cancelling');
    expect(setup.attempt.result?.outcome).toBe('succeeded');
    expect(setup.attempt.occupies).toBe(true);
    expect(() => reduce(setup.state, { type: 'task.action', id: setup.task.id, action: { operation_id: 'retry', action: 'retry' } })).toThrow();
    observe(setup, 'idle', 12);
    expect(setup.task.phase).toBe('cancelled');
    expect(setup.attempt.occupies).toBe(false);
  });

  it('keeps manual declarations separate from unproven stop evidence', () => {
    const setup = submitted();
    reduce(setup.state, { type: 'task.action', id: setup.task.id, action: { operation_id: 'manual', action: 'record-conclusion', reason: '人工判断', evidence: '终端画面', outcome: 'cancelled', stopped: true }, stopVerified: false });
    expect(setup.attempt.source).toBe('manual');
    expect(setup.attempt.manualEvidence).toContain('终端画面');
    expect(setup.attempt.phase).toBe('needs_confirmation');
    expect(setup.attempt.occupies).toBe(true);
  });

  it('recovery invalidates dispatch intent, startup intent, workers and authorization without releasing occupancy (V04/V06/V24)', () => {
    const setup = stateWithTask();
    reduce(setup.state, { type: 'dispatch', taskId: setup.task.id, id: 'attempt-1', input: frozen() });
    reduce(setup.state, { type: 'start', record: { id: 'start-1', projectId: setup.project.id, type: 'codex', cwd: '/tmp', label: 'starting', status: 'intent', target: null, reason: '', createdAt: 1 } });
    reduce(setup.state, { type: 'job', job: { id: 'job-1', taskId: setup.task.id, attemptId: 'attempt-1', kind: 'collect', generation: 'old', staging: '/tmp/staging', pid: null, processStart: null, status: 'intent', reason: '' } });
    reduce(setup.state, { type: 'recover' });
    expect(setup.state.attempts[0]).toMatchObject({ dispatch: 'unknown', occupies: true, phase: 'needs_confirmation', seenActivity: false });
    expect(setup.state.starts[0]!.status).toBe('unknown');
    expect(setup.state.jobs[0]!.status).toBe('orphaned');
    expect(setup.state.bindings[0]).toMatchObject({ confirmed: false, mode: 'observe', paused: true, observation: null });
  });

  it('revokes authorization when another occupant replaces a running agent (V07)', () => {
    const setup = submitted(); observe(setup, 'working', 11);
    reduce(setup.state, { type: 'observe', observations: [observation({ fingerprint: 'replacement', status: 'idle', sequence: 100 })] });
    publish(setup);
    expect(setup.state.bindings[0]).toMatchObject({ confirmed: false, mode: 'observe', paused: true });
    expect(setup.attempt.occupies).toBe(true);
    expect(setup.task.phase).not.toBe('succeeded');
  });

  it('late old-attempt results do not overwrite a newly dispatched retry (V13)', () => {
    const setup = submitted();
    reduce(setup.state, { type: 'task.action', id: setup.task.id, action: { operation_id: 'stop', action: 'record-conclusion', reason: '停止已核对', evidence: 'identity exited', outcome: 'cancelled', stopped: true }, stopVerified: true });
    reduce(setup.state, { type: 'task.action', id: setup.task.id, action: { operation_id: 'retry', action: 'retry' } });
    reduce(setup.state, { type: 'dispatch', taskId: setup.task.id, id: 'attempt-2', input: frozen() });
    publish(setup);
    expect(setup.task.currentAttemptId).toBe('attempt-2');
    expect(setup.task.phase).toBe('dispatching');
    expect(setup.state.attempts[1]).toMatchObject({ occupies: true, result: null, number: 2 });
    expect(setup.attempt.result?.summary).toBe('已完成');
  });

  it('allows independent tasks behind dependency blockers, but freezes started task descriptions (V14/V16)', () => {
    const { state, task, project } = stateWithTask();
    const dependent = reduce(state, { type: 'task.create', data: taskInput(project.id, { dependencies: [{ taskId: task.id, artifacts: [] }] }) }) as Task;
    const independent = reduce(state, { type: 'task.create', data: taskInput(project.id) }) as Task;
    expect(waiting(state, dependent)).toContain('前置任务');
    expect(waiting(state, independent)).toBeNull();
    reduce(state, { type: 'dispatch', taskId: independent.id, id: 'attempt-1', input: frozen() });
    expect(() => reduce(state, { type: 'task.update', id: independent.id, revision: independent.revision, data: taskInput(project.id, { instructions: 'changed' }) })).toThrow();
    expect(state.attempts[0]!.input.instructions).toBe('生成可核对结果');
  });

  it('rejects dependency cycles and cross-project task associations (V16)', () => {
    const { state, task, project } = stateWithTask();
    const child = reduce(state, { type: 'task.create', data: taskInput(project.id, { dependencies: [{ taskId: task.id, artifacts: [] }] }) }) as Task;
    expect(() => reduce(state, { type: 'task.update', id: task.id, revision: task.revision, data: taskInput(project.id, { dependencies: [{ taskId: child.id, artifacts: [] }] }) })).toThrow(/循环/);
    expect(() => reduce(state, { type: 'task.create', data: taskInput('wrong-project') })).toThrow();
  });

  it('business failure releases occupancy while uncertain delivery pauses the binding (V15)', () => {
    const failure = submitted(); observe(failure, 'working', 11); publish(failure, 'failed'); observe(failure, 'idle', 12);
    expect(failure.task.phase).toBe('failed');
    expect(failure.attempt.occupies).toBe(false);
    expect(failure.state.bindings[0]!.paused).toBe(false);
    const uncertain = submitted();
    reduce(uncertain.state, { type: 'dispatch.result', id: uncertain.attempt.id, status: 'unknown', reason: '响应丢失' });
    expect(uncertain.attempt).toMatchObject({ phase: 'needs_confirmation', occupies: true });
    expect(uncertain.state.bindings[0]!.paused).toBe(true);
  });
});
