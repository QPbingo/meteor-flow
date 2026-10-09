import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { createConnection, type Socket } from 'node:net';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { isProcessDescendant, processIdentity } from '@meteor-flow/posix-fs';

const execute = promisify(execFile);
const FRAME_LIMIT = 1024 * 1024;
const LIFECYCLE_EVENTS = ['pane.created', 'pane.closed', 'pane.updated', 'pane.moved', 'pane.exited', 'pane.agent_detected'];
type JsonObject = Record<string, unknown>;

export interface AgentObservation {
  terminalId: string;
  paneId: string;
  type: string;
  status: 'idle' | 'done' | 'working' | 'blocked' | 'unknown';
  cwd: string;
  agentSession: string | null;
  pid: number | null;
  processStart: string | null;
  sequence: number;
  launchPending: boolean;
  interactiveReady: boolean;
  fingerprint: string;
  instanceFingerprint?: string;
  observedAt: number;
}

export interface HerdrPort {
  session: string;
  connect(): Promise<{ version: string; protocol: number }>;
  listAgents(): Promise<AgentObservation[]>;
  prompt(target: string, text: string): Promise<void>;
  interrupt(target: string): Promise<void>;
  start(type: 'codex' | 'claude', cwd: string): Promise<{ target: string }>;
  subscribe(onChange: () => void, onDisconnect: (reason: string) => void): Promise<() => void>;
  close(): void;
}

/** No error from a submitted mutation authorizes a retry. The caller owns durable intents. */
export class HerdrError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly uncertain = false,
    readonly target?: string,
  ) { super(message); this.name = 'HerdrError'; }
}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HerdrError('无效 herdr 对象', 'invalid_response');
  return value as JsonObject;
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value.length) throw new HerdrError('缺少 herdr 字符串字段', 'invalid_response');
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new HerdrError('无效 herdr 整数字段', 'invalid_response');
  return value;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new HerdrError('缺少 herdr 数组字段', 'invalid_response');
  return value;
}
function optionalBoolean(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new HerdrError('无效 herdr 布尔字段', 'invalid_response');
  return value;
}
function validateSession(session: string): void {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(session) || session === '.' || session === '..') throw new HerdrError('无效 herdr session', 'invalid_session');
}
function environment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of ['HERDR_SESSION', 'HERDR_SOCKET_PATH', 'HERDR_CLIENT_SOCKET_PATH', 'HERDR_PANE_ID', 'HERDR_WORKSPACE_ID', 'HERDR_TERMINAL_ID']) delete env[key];
  return env;
}

/** Mirrors release herdr's config/io.rs and session.rs; explicit session ignores socket overrides. */
export function sessionSocketPath(session: string): string {
  validateSession(session);
  const root = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'herdr');
  return session === 'default' ? join(root, 'herdr.sock') : join(root, 'sessions', session, 'herdr.sock');
}

export async function listSessions(executable = 'herdr'): Promise<Array<{ name: string; socketPath: string }>> {
  const { stdout } = await execute(executable, ['session', 'list', '--json'], { env: environment(), timeout: 5000, maxBuffer: FRAME_LIMIT, encoding: 'utf8' });
  return array(object(JSON.parse(stdout)).sessions).map(value => {
    const row = object(value);
    const name = string(row.name);
    validateSession(name);
    const socketPath = string(row.socket_path);
    // The CLI is discovery, not permission to connect to an arbitrary returned path.
    if (socketPath !== sessionSocketPath(name)) throw new HerdrError('session socket 与官方路径不符', 'invalid_session');
    return { name, socketPath };
  });
}

/** One JSON request per socket is the upstream protocol, including subscription sockets. */
class Exchange {
  readonly socket: Socket;
  readonly result: Promise<JsonObject>;
  private buffer = Buffer.alloc(0);
  private acknowledged = false;
  private finished = false;
  private timer: NodeJS.Timeout;
  private resolve!: (value: JsonObject) => void;
  private reject!: (reason: Error) => void;
  private wrote = false;

  constructor(path: string, method: string, params: JsonObject, timeout: number, mutation: boolean,
    private readonly ended: (exchange: Exchange) => void,
    private readonly failed: (error: HerdrError) => void,
    private readonly event?: (event: JsonObject) => void) {
    const id = randomUUID();
    const frame = Buffer.from(JSON.stringify({ id, method, params }) + '\n');
    if (frame.length > FRAME_LIMIT) throw new HerdrError('herdr 请求过大', 'frame_too_large');
    this.result = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.socket = createConnection(path);
    const fail = (error: unknown) => {
      if (this.finished) return;
      const source = error instanceof HerdrError ? error : new HerdrError('herdr 连接中断', 'disconnected');
      const wrapped = new HerdrError(source.message, source.code, mutation && this.wrote);
      this.reject(wrapped);
      this.dispose();
      this.failed(wrapped);
    };
    this.timer = setTimeout(() => fail(new HerdrError('herdr 请求超时', 'timeout')), timeout);
    this.socket.once('connect', () => { this.wrote = true; this.socket.write(frame); });
    this.socket.on('error', fail);
    this.socket.on('end', () => fail(new HerdrError('herdr 连接结束', 'disconnected')));
    this.socket.on('close', () => fail(new HerdrError('herdr 连接关闭', 'disconnected')));
    this.socket.on('data', (chunk: Buffer) => {
      if (this.finished) return;
      try {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (!this.finished) {
          const end = this.buffer.indexOf(10);
          if (end < 0) { if (this.buffer.length > FRAME_LIMIT) throw new HerdrError('herdr 帧过大', 'frame_too_large'); break; }
          if (end > FRAME_LIMIT) throw new HerdrError('herdr 帧过大', 'frame_too_large');
          const line = this.buffer.subarray(0, end);
          this.buffer = this.buffer.subarray(end + 1);
          const message = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)));
          if (!this.acknowledged) {
            if (message.id !== id) throw new HerdrError('herdr 响应 ID 不匹配', 'wrong_id');
            if (message.error !== undefined) {
              const error = object(message.error);
              const rejected = new HerdrError(string(error.message), string(error.code), mutation && this.wrote);
              this.reject(rejected);
              this.dispose();
              return;
            }
            const result = object(message.result);
            if (this.event && result.type !== 'subscription_started') throw new HerdrError('无效订阅确认', 'invalid_response');
            this.acknowledged = true;
            clearTimeout(this.timer);
            this.resolve(result);
            if (!this.event) this.dispose();
          } else {
            if (!this.event || typeof message.event !== 'string' || message.id !== undefined) throw new HerdrError('无效订阅事件', 'invalid_response');
            object(message.data);
            this.event(message);
          }
        }
      } catch (error) { fail(error instanceof HerdrError ? error : new HerdrError('无法解析 herdr 帧', 'invalid_response')); }
    });
  }

  cancel(): void {
    if (this.finished) return;
    this.reject(new HerdrError('herdr 连接代已失效', 'stale_generation', this.wrote));
    this.dispose();
  }
  private dispose(): void {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timer);
    this.socket.destroy();
    this.ended(this);
  }
}

interface SubscriptionState {
  change: () => void;
  disconnect: (reason: string) => void;
  global?: Exchange;
  panes: Map<string, Exchange>;
}

export class HerdrClient implements HerdrPort {
  readonly session: string;
  private readonly path: string;
  private readonly timeout: number;
  private readonly mutationTimeout: number;
  private generation = 0;
  private connectionId = randomUUID();
  private readSequence = 0;
  private targets = new Map<string,{paneId:string;observedAt:number}>();
  private connected = false;
  private exchanges = new Set<Exchange>();
  private subscription?: SubscriptionState;
  private readonly codexHelp: () => Promise<string>;
  private readonly codexExecutionPolicy?: 'workspace-write';

  constructor(options: { session: string; executable?: string; socketPath?: string; timeoutMs?: number; codexHelp?: () => Promise<string>; codexExecutionPolicy?: 'workspace-write' }) {
    validateSession(options.session);
    this.session = options.session;
    this.path = options.socketPath ?? sessionSocketPath(this.session);
    this.timeout = options.timeoutMs ?? 5000;
    this.mutationTimeout = options.timeoutMs ?? 15_000;
    this.codexHelp = options.codexHelp ?? (async () => (await execute('codex', ['--help'], { timeout: 5000, maxBuffer: 128 * 1024 })).stdout);
    this.codexExecutionPolicy = options.codexExecutionPolicy;
    if (!isAbsolute(this.path) || !Number.isFinite(this.timeout) || this.timeout <= 0) throw new HerdrError('无效 herdr 连接参数', 'invalid_options');
  }

  async connect(): Promise<{ version: string; protocol: number }> {
    this.close();
    const generation = this.generation;
    const result = await this.request('ping', {}, 'pong', false, true);
    const version = string(result.version);
    const protocol = integer(result.protocol);
    if (!/^0\.9\.(0|3)$/.test(version) || protocol !== 22) {
      this.invalidate('herdr 版本或协议不受支持');
      throw new HerdrError('herdr 版本或协议不受支持', 'unsupported_version');
    }
    this.assertGeneration(generation);
    this.connected = true;
    return { version, protocol };
  }

  async listAgents(): Promise<AgentObservation[]> {
    try { return await this.collectAgents(); }
    catch (error) {
      if (error instanceof HerdrError && error.code === 'invalid_response') this.invalidate(error.message);
      throw error;
    }
  }

  private async collectAgents(): Promise<AgentObservation[]> {
    const generation = this.generation;
    const sequence = ++this.readSequence;
    let rows = await this.readAgents();
    const current = () => {
      this.assertGeneration(generation);
      if (sequence !== this.readSequence) throw new HerdrError('herdr 旧读取已失效', 'stale_read');
    };
    current();
    const state = this.subscription;
    if (state) {
      const panes = new Set(rows.map(row => string(row.pane_id)));
      let added = false;
      for (const pane of panes) {
        const existing = state.panes.get(pane);
        if (existing) { await existing.result; current(); continue; }
        const stream = this.exchange('events.subscribe', { subscriptions: [{ type: 'pane.agent_status_changed', pane_id: pane }] }, false,
          event => { if (event.event !== 'pane.agent_status_changed') throw new HerdrError('未知状态事件', 'invalid_response'); state.change(); });
        state.panes.set(pane, stream);
        await stream.result;
        current();
        added = true;
      }
      for (const [pane, stream] of state.panes) if (!panes.has(pane)) { stream.cancel(); state.panes.delete(pane); }
      // Never use the pre-subscription snapshot as the calibrated observation.
      if (added) { rows = await this.readAgents(); current(); }
    }
    const observations: AgentObservation[] = [];
    for (const row of rows) observations.push(await this.observe(row));
    current();
    this.targets=new Map(observations.map(row=>[row.terminalId,{paneId:row.paneId,observedAt:row.observedAt}]));
    return observations;
  }

  private agentTarget(terminalId:string):string{
    if(!this.connected)throw new HerdrError('herdr 尚未连接','not_connected');
    const target=this.targets.get(terminalId);
    if(!target||Date.now()-target.observedAt>5000)throw new HerdrError('需要先取得新鲜终端快照','stale_target',false,terminalId);
    // Unlike terminal.session, agent.* in herdr 0.9.x accepts a public pane ID
    // or managed name, not terminal_id. Never fall back to a guessed name.
    return target.paneId;
  }

  async prompt(target: string, text: string): Promise<void> {
    string(target); string(text);
    const result = await this.request('agent.prompt', { target:this.agentTarget(target), text }, 'agent_prompted', true);
    try {
      if (string(object(result.agent).terminal_id) !== target) throw new HerdrError('投递响应目标不匹配', 'invalid_response');
    } catch {
      this.invalidate('投递响应目标不匹配');
      throw new HerdrError('投递响应目标不匹配', 'invalid_response', true, target);
    }
  }
  async interrupt(target: string): Promise<void> {
    string(target);
    await this.request('agent.send_keys', { target:this.agentTarget(target), keys: ['C-c'] }, 'ok', true);
  }

  async start(type: 'codex' | 'claude', cwd: string): Promise<{ target: string }> {
    const generation=this.generation;
    if (type !== 'codex' && type !== 'claude') throw new HerdrError('不支持的 agent 类型', 'unsupported_agent');
    if (!isAbsolute(cwd) || !(await stat(cwd)).isDirectory()) throw new HerdrError('启动目录不可用', 'invalid_cwd');
    const directory = await realpath(cwd);
    let args: string[] = [];
    if (type === 'codex') {
      let help: string;
      try { help = await this.codexHelp(); }
      catch { throw new HerdrError('无法在启动前核实 Codex CLI 能力，请先检查本机安装', 'codex_capability_unavailable'); }
      if (/^\s+--no-daemon(?:\s|$)/m.test(help) && /^\s+(?:-c,\s+)?--config(?:\s|=|$)/m.test(help)) args = ['--no-daemon', '-c', 'check_for_update_on_startup=false'];
      // Explicit callers (including isolated real tests) may impose this policy.
      // Normal console launches omit it and retain the user's configured policy.
      if (this.codexExecutionPolicy) {
        if (!/^\s+(?:-s,\s+)?--sandbox(?:\s|=|$)/m.test(help) || !/^\s+(?:-a,\s+)?--ask-for-approval(?:\s|=|$)/m.test(help)) throw new HerdrError('Codex CLI 无法核实指定的执行保护选项', 'codex_capability_unavailable');
        args.push('--sandbox', 'workspace-write', '--ask-for-approval', 'on-request');
      }
    }
    this.assertGeneration(generation);
    // A fresh workspace creates a shell without depending on the user's focused pane.
    const created = await this.request('workspace.create', { cwd: directory, focus: false, label: `meteor-flow-${randomUUID()}` }, 'workspace_created', true);
    let target: string | undefined;
    try {
      const pane = object(created.root_pane);
      target = string(pane.terminal_id);
      const paneId = string(pane.pane_id);
      this.assertGeneration(generation);
      await this.waitForShell(paneId,target,generation);
      this.assertGeneration(generation);
      const started = await this.request('agent.start', { name: `mf-${randomUUID().replaceAll('-', '').slice(0,24)}`, kind: type, pane_id: paneId, timeout_ms: 60_000, ...(args.length ? { args } : {}) }, 'agent_started', true);
      if (string(object(started.agent).terminal_id) !== target) throw new HerdrError('启动响应目标不匹配', 'invalid_response', true);
      return { target };
    } catch (error) {
      const source = error instanceof HerdrError ? error : new HerdrError('启动结果不确定', 'start_failed', true);
      throw new HerdrError(source.message, source.code, true, target);
    }
  }

  private async waitForShell(paneId:string,target:string,generation:number):Promise<void>{
    const deadline=performance.now()+10000;
    while(performance.now()<deadline){
      this.assertGeneration(generation);
      const current=object((await this.request('pane.get',{pane_id:paneId},'pane_info')).pane);
      this.assertGeneration(generation);
      if(current.terminal_id!==target||current.agent)throw new HerdrError('启动目标已变化或已有 Agent','agent_pane_busy',true,target);
      const info=object((await this.request('pane.process_info',{pane_id:paneId},'pane_process_info')).process_info);
      this.assertGeneration(generation);
      const processes=array(info.foreground_processes??[]).map(object);
      if(info.shell_pid&&info.foreground_process_group_id===info.shell_pid&&processes.length===1&&processes[0]!.pid===info.shell_pid&&['zsh','bash','sh','fish','dash','ksh','tcsh','csh','nu','pwsh','powershell'].includes(basename(String(processes[0]!.name)).replace(/^-/,'').toLowerCase()))return;
      await delay(100);
    }
    throw new HerdrError('新 shell 尚未就绪；未发送 Agent 启动命令','shell_not_ready',true,target);
  }

  async subscribe(onChange: () => void, onDisconnect: (reason: string) => void): Promise<() => void> {
    if (!this.connected) throw new HerdrError('herdr 尚未连接', 'not_connected');
    if (this.subscription) throw new HerdrError('herdr 已存在订阅', 'already_subscribed');
    let ready = false;
    const state: SubscriptionState = { change: () => { if (ready) onChange(); }, disconnect: onDisconnect, panes: new Map() };
    this.subscription = state;
    try {
      state.global = this.exchange('events.subscribe', { subscriptions: LIFECYCLE_EVENTS.map(type => ({ type })) }, false, event => {
        if (!LIFECYCLE_EVENTS.includes(string(event.event))) throw new HerdrError('未知生命周期事件', 'invalid_response');
        state.change();
      });
      await state.global.result;
      await this.listAgents();
      ready = true;
      onChange();
      return () => this.unsubscribe(state);
    } catch (error) { this.unsubscribe(state); throw error; }
  }

  close(): void { this.invalidate('herdr 连接已关闭'); }

  private unsubscribe(state: SubscriptionState): void {
    state.global?.cancel();
    for (const stream of state.panes.values()) stream.cancel();
    if (this.subscription === state) this.subscription = undefined;
  }
  private invalidate(reason: string): void {
    this.connected = false;
    this.targets.clear();
    this.generation++;
    this.connectionId = randomUUID();
    const state = this.subscription;
    this.subscription = undefined;
    for (const exchange of this.exchanges) exchange.cancel();
    this.exchanges.clear();
    state?.disconnect(reason);
  }
  private assertGeneration(generation: number): void {
    if (generation !== this.generation) throw new HerdrError('herdr 连接代已失效', 'stale_generation');
  }
  private exchange(method: string, params: JsonObject, mutation: boolean, event?: (event: JsonObject) => void): Exchange {
    const generation = this.generation;
    const timeout = method === 'agent.start' ? Math.max(this.timeout, 65_000) : mutation ? this.mutationTimeout : this.timeout;
    const exchange = new Exchange(this.path, method, params, timeout, mutation,
      ended => this.exchanges.delete(ended),
      error => { if (generation === this.generation) this.invalidate(error.message); },
      event ? value => { if (generation === this.generation) event(value); } : undefined);
    this.exchanges.add(exchange);
    return exchange;
  }
  private async request(method: string, params: JsonObject, type: string, mutation = false, handshake = false): Promise<JsonObject> {
    if (!this.connected && !handshake) throw new HerdrError('herdr 尚未连接', 'not_connected');
    const generation = this.generation;
    const result = await this.exchange(method, params, mutation).result;
    this.assertGeneration(generation);
    if (result.type !== type) {
      this.invalidate('herdr 响应类型不匹配');
      throw new HerdrError('herdr 响应类型不匹配', 'invalid_response', mutation);
    }
    return result;
  }
  private async readAgents(): Promise<JsonObject[]> {
    const result = await this.request('agent.list', {}, 'agent_list');
    try { return array(result.agents).map(object); }
    catch (error) { this.invalidate('herdr agent 快照无效'); throw error; }
  }
  private async observe(row: JsonObject): Promise<AgentObservation> {
    const terminalId = string(row.terminal_id);
    const paneId = string(row.pane_id);
    const type = row.agent === undefined ? 'unknown' : string(row.agent);
    const status = string(row.agent_status);
    if (!['idle', 'done', 'working', 'blocked', 'unknown'].includes(status)) throw new HerdrError('未知 agent 状态', 'invalid_response');
    const sequence = integer(row.state_change_seq ?? 0);
    const session = row.agent_session == null ? null : object(row.agent_session);
    const agentSession = session ? JSON.stringify([string(session.source), string(session.agent), string(session.kind), string(session.value)]) : null;
    let cwd = typeof row.foreground_cwd === 'string' ? row.foreground_cwd : typeof row.cwd === 'string' ? row.cwd : '';
    let pid: number | null = null;
    let processStart: string | null = null;
    try {
      const result = await this.request('pane.process_info', { pane_id: paneId }, 'pane_process_info');
      const info = object(result.process_info);
      if (info.pane_id !== paneId) throw new HerdrError('进程信息 pane 不匹配', 'invalid_response');
      const processes = array(info.foreground_processes ?? []).map(object);
      // An Agent can own foreground MCP/tool children. Accept only one named
      // Agent and prove every companion belongs to its live process tree;
      // unrelated pipelines or two Agents remain observation-only.
      const candidates=processes.filter(p=>typeof p.name==='string'&&basename(p.name).toLowerCase()===type.toLowerCase());
      if(candidates.length===1&&type!=='unknown'){
        const candidate=integer(candidates[0]!.pid);const identity=processIdentity(candidate);
        if(identity&&processes.every(p=>p===candidates[0]||isProcessDescendant(integer(p.pid),candidate,identity))&&processIdentity(candidate)===identity){pid=candidate;processStart=identity;}
      }
    } catch (error) {
      if (error instanceof HerdrError && ['disconnected', 'timeout', 'stale_generation', 'not_connected', 'invalid_response', 'wrong_id', 'frame_too_large'].includes(error.code)) throw error;
      // Unsupported/missing process information leaves the binding observation-only.
    }
    try { cwd = isAbsolute(cwd) ? await realpath(cwd) : ''; }
    catch { cwd = ''; processStart = null; }
    const fingerprint = createHash('sha256').update(JSON.stringify([this.session, this.path, this.connectionId, terminalId, type, agentSession, pid, processStart, cwd])).digest('hex');
    const instanceFingerprint = createHash('sha256').update(JSON.stringify([this.session, this.path, this.connectionId, terminalId, type, pid, processStart, cwd])).digest('hex');
    return { terminalId, paneId, type, status: status as AgentObservation['status'], cwd, agentSession, pid, processStart, sequence,
      launchPending: optionalBoolean(row.launch_pending), interactiveReady: optionalBoolean(row.interactive_ready), fingerprint, instanceFingerprint, observedAt: Date.now() };
  }
}
