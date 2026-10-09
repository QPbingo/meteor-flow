import type { Binding, CreateTask, FrozenInput, Observation, Project, ResultDeclaration, State, Task } from '../../packages/contracts/src/index.js';
import { initialState, reduce } from '../../apps/server/src/domain/model.js';

export function observation(overrides: Partial<Observation> = {}): Observation {
  return { terminalId: 'terminal-1', paneId: 'w1:p1', type: 'codex', status: 'idle', cwd: '/tmp/meteor-flow-test-work', agentSession: 'agent-session-1', pid: 100, processStart: '100:1000:1', sequence: 10, launchPending: false, interactiveReady: false, fingerprint: 'identity-1', observedAt: Date.now(), ...overrides };
}
export function binding(projectId: string, cwd = '/tmp/meteor-flow-test-work', overrides: Partial<Binding> = {}): Binding {
  return { id: 'binding-1', projectId, session: 'meteor-flow-test-state', terminalId: 'terminal-1', label: '测试 Agent', type: 'codex', cwd, fingerprint: 'identity-1', agentSession: 'agent-session-1', mode: 'automatic', confirmed: true, managed: false, paused: false, reason: '', revision: 1, observation: observation({ cwd }), ...overrides };
}
export function taskInput(projectId: string, overrides: Partial<CreateTask> = {}): CreateTask {
  return { operation_id: 'create-task-1', projectId, bindingId: 'binding-1', title: '测试任务', instructions: '生成可核对结果', dependencies: [], requiredArtifacts: [], outputRoots: [], ...overrides };
}
export function frozen(cwd = '/tmp/meteor-flow-test-work', overrides: Partial<FrozenInput> = {}): FrozenInput {
  return { title: '测试任务', instructions: '生成可核对结果', roots: [{ id: 'workdir', path: cwd }], requiredArtifacts: [], dependencies: [], ...overrides };
}
export function result(taskId: string, attemptId: string, overrides: Partial<ResultDeclaration> = {}): ResultDeclaration {
  return { protocol: 'meteor-flow.result/v1', task_id: taskId, attempt_id: attemptId, outcome: 'succeeded', summary: '已完成', artifacts: [], ...overrides };
}
export function stateWithTask(): { state: State; task: Task; project: Project } {
  const state = initialState('meteor-flow-test-state');
  const project = reduce(state, { type: 'project.create', data: { name: '测试项目', root: '/tmp/meteor-flow-test-project' } }) as Project;
  reduce(state, { type: 'binding.create', data: binding(project.id) });
  const task = reduce(state, { type: 'task.create', data: taskInput(project.id) }) as Task;
  return { state, task, project };
}
