import { Type, type Static } from '@sinclair/typebox';
export { Type };
export { Value } from '@sinclair/typebox/value';
export const Id = Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_-]+$' });
const Text = (maxLength: number) => Type.String({ minLength: 1, maxLength });
export const Operation = { operation_id: Id };
export const ProjectInput = Type.Object({ ...Operation, name: Text(120), root: Text(4096) }, { additionalProperties: false });
export const DependencySchema = Type.Object({ taskId: Id, artifacts: Type.Array(Id, { maxItems: 100 }) }, { additionalProperties: false });
export const OutputRootSchema = Type.Object({ id: Id, path: Text(4096) }, { additionalProperties: false });
export const TaskFields = {
  projectId: Id, bindingId: Id, title: Text(160), instructions: Text(64000),
  dependencies: Type.Array(DependencySchema, { maxItems: 100 }),
  requiredArtifacts: Type.Array(Text(1024), { maxItems: 100 }),
  outputRoots: Type.Array(OutputRootSchema, { maxItems: 10 }),
};
export const TaskInput = Type.Object({ ...Operation, ...TaskFields }, { additionalProperties: false });
export const TaskUpdate = Type.Object({ ...Operation, ...TaskFields, expected_revision: Type.Integer({ minimum: 1 }) }, { additionalProperties: false });
export const BindingInput = Type.Object({ ...Operation, projectId: Id, terminalId: Text(256), label: Text(120) }, { additionalProperties: false });
export const StartInput = Type.Object({ ...Operation, projectId: Id, type: Type.Union([Type.Literal('codex'), Type.Literal('claude')]), cwd: Text(4096), label: Text(120) }, { additionalProperties: false });
export const StartResolutionInput = Type.Object({ ...Operation, evidence: Text(8000), confirmedStopped: Type.Literal(true) }, { additionalProperties: false });
export const ActionInput = Type.Object({
  ...Operation, action: Type.Union(['cancel','retry','copy','archive','retry-collection','record-conclusion','confirm','automatic','manual','pause','resume'].map(x => Type.Literal(x))),
  expected_revision: Type.Optional(Type.Integer({ minimum: 1 })),
  reason: Type.Optional(Text(4000)), evidence: Type.Optional(Text(8000)),
  outcome: Type.Optional(Type.Union([Type.Literal('succeeded'),Type.Literal('failed'),Type.Literal('cancelled')])),
  stopped: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
export const SettingsInput = Type.Object({ ...Operation, paused: Type.Boolean(), concurrency: Type.Integer({ minimum: 1, maximum: 8 }) }, { additionalProperties: false });
export const ResultSchema = Type.Object({
  protocol: Type.Literal('meteor-flow.result/v1'), task_id: Id, attempt_id: Id,
  outcome: Type.Union([Type.Literal('succeeded'),Type.Literal('failed')]), summary: Text(32768),
  artifacts: Type.Array(Type.Object({ root_id: Id, path: Text(4096), label: Text(1024) }, { additionalProperties: false }), { maxItems: 100 }),
}, { additionalProperties: false });
export const TerminalInput = Type.Object({
  protocol: Type.Literal('meteor-flow.terminal/v1'),
  action: Type.Union(['take','release','input','resize','heartbeat'].map(x => Type.Literal(x))),
  token: Type.Optional(Text(128)), epoch: Type.Optional(Type.Integer({ minimum: 1 })),
  text: Type.Optional(Type.String({ maxLength: 16384 })), cols: Type.Optional(Type.Integer({ minimum: 10, maximum: 400 })), rows: Type.Optional(Type.Integer({ minimum: 2, maximum: 200 })),
}, { additionalProperties: false });

export type CreateTask = Static<typeof TaskInput>;
export type Action = Static<typeof ActionInput>;
export type ResultDeclaration = Static<typeof ResultSchema>;
export type Dependency = Static<typeof DependencySchema>;
export type OutputRoot = Static<typeof OutputRootSchema>;
export type Phase = 'queued'|'dispatching'|'running'|'collecting'|'cancelling'|'needs_confirmation'|'succeeded'|'failed'|'cancelled';
export const terminalPhases: Phase[] = ['succeeded','failed','cancelled'];
export type Observation = {
  terminalId: string; paneId: string; type: string; status: 'idle'|'done'|'working'|'blocked'|'unknown';
  cwd: string; agentSession: string|null; pid: number|null; processStart: string|null;
  sequence: number; launchPending: boolean; interactiveReady: boolean; fingerprint: string; instanceFingerprint?: string; observedAt: number;
};
export type Project = { id:string; name:string; root:string; archived:boolean; createdAt:number };
export type Binding = { id:string; projectId:string; session:string; terminalId:string; label:string; type:string; cwd:string; fingerprint:string; agentSession:string|null; sessionIdentificationBlocked?:boolean; mode:'observe'|'automatic'|'manual'; confirmed:boolean; managed:boolean; paused:boolean; reason:string; revision:number; observation:Observation|null };
export type Task = Omit<CreateTask,'operation_id'> & { id:string; revision:number; createdAt:number; order:number; archived:boolean; currentAttemptId:string|null; phase:Phase; reason:string };
export type Artifact = { id:string; taskId:string; attemptId:string; label:string; rootId:string; sourcePath:string; archiveId:string; file:string; sha256:string; size:number };
export type FrozenDependency = { taskId:string; attemptId:string; summary:string; artifacts:Array<{ id:string; sha256:string; file:string }> };
export type FrozenInput = { title:string; instructions:string; roots:OutputRoot[]; requiredArtifacts:string[]; dependencies:FrozenDependency[] };
export type Attempt = { id:string; taskId:string; bindingId:string; number:number; phase:Phase; reason:string; occupies:boolean; createdAt:number; submittedAt:number|null; endedAt:number|null; fingerprint:string; identity:Pick<Observation,'pid'|'processStart'|'cwd'|'agentSession'|'type'>; baselineSeq:number; seenActivity:boolean; dispatch:'intent'|'submitted'|'unknown'|'not_sent'; cancelRequested:boolean; cancelAcceptedAt:number|null; attentionSince:number|null; remindedAt:number|null; input:FrozenInput; result:ResultDeclaration|null; resultHash:string|null; resultConflict?:string; archiveId:string|null; source:'agent'|'manual'; manualEvidence:string|null };
export type EventRecord = { seq:number; time:number; type:string; taskId:string|null; attemptId:string|null; message:string };
export type StartRecord = { id:string; projectId:string; type:'codex'|'claude'; cwd:string; label:string; status:'intent'|'started'|'unknown'|'dismissed'; target:string|null; reason:string; createdAt:number; resolution?:{source:'manual';evidence:string;at:number} };
export type CollectionJob = { id:string; taskId:string; attemptId:string; kind:'prepare'|'collect'|'verify'; generation:string; staging:string; pid:number|null; processStart:string|null; status:'intent'|'running'|'finished'|'orphaned'|'failed'; reason:string };
export type OperationRecord = { id:string; digest:string; result:unknown };
export type State = {
  projects:Project[]; bindings:Binding[]; tasks:Task[]; attempts:Attempt[]; artifacts:Artifact[];
  events:EventRecord[]; starts:StartRecord[]; jobs:CollectionJob[]; operations:OperationRecord[];
  settings:{ paused:boolean; concurrency:number; session:string; revision:number };
};
export type ConsoleSnapshot = Omit<State,'operations'> & { health:{storage:boolean; connected:boolean; version:string|null; error:string|null; lastObservation:number|null}; discoveries:Observation[]; generation:string };
