import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { AgentObservation, HerdrPort } from '../../apps/server/src/adapters/herdr/index.js';
import { processIdentity } from '../../packages/posix-fs/src/index.js';

export type FakeAgent = { terminalId: string; cwd: string; type?: 'codex' | 'claude'; status?: AgentObservation['status']; agentSession?: string };
export type PromptCall = { target: string; text: string };

/** Only the external herdr boundary is simulated; consumers still use real DB,
 * filesystem collectors, HTTP and browser code. Never connects to user sessions. */
export class FakeHerdr extends EventEmitter implements HerdrPort {
  readonly session: string;
  readonly agents = new Map<string, AgentObservation>();
  readonly prompts: PromptCall[] = [];
  readonly interrupts: string[] = [];
  readonly starts: Array<{ type: 'codex' | 'claude'; cwd: string }> = [];
  connected = false;
  reads = 0;
  connections = 0;
  onList?: (read: number) => void | Promise<void>;
  onPrompt?: (call: PromptCall) => void | Promise<void>;
  onInterrupt?: (target: string) => void | Promise<void>;
  onStart?: (type: 'codex' | 'claude', cwd: string) => { target: string } | Promise<{ target: string }>;
  private changed?: () => void;
  private disconnected?: (reason: string) => void;

  constructor(options: { session?: string; agents?: FakeAgent[] } = {}) {
    super(); this.session = options.session ?? 'meteor-flow-test-state';
    for (const agent of options.agents ?? []) this.addAgent(agent);
  }
  addAgent(agent: FakeAgent): AgentObservation {
    const value: AgentObservation = { terminalId: agent.terminalId, paneId: `pane-${agent.terminalId}`, cwd: agent.cwd, type: agent.type ?? 'codex', status: agent.status ?? 'idle', agentSession: agent.agentSession ?? `session-${agent.terminalId}`, pid: process.pid, processStart: processIdentity(process.pid), sequence: 1, launchPending: false, interactiveReady: true, fingerprint: randomUUID(), observedAt: Date.now() };
    this.agents.set(agent.terminalId, value); return value;
  }
  async connect() {
    this.connected = true; this.connections++;
    for (const agent of this.agents.values()) agent.fingerprint = randomUUID();
    return { version: '0.9.3', protocol: 22 };
  }
  async listAgents() {
    if (!this.connected) throw new Error('fake herdr disconnected');
    await this.onList?.(++this.reads);
    if (!this.connected) throw new Error('fake herdr disconnected');
    return [...this.agents.values()].map(agent => ({ ...agent, observedAt: Date.now() }));
  }
  async prompt(target: string, text: string) {
    if (!this.connected || !this.agents.has(target)) throw new Error('fake target not available');
    const call = { target, text }; this.prompts.push(call); this.emit('prompt', call);
    await this.onPrompt?.(call);
  }
  async interrupt(target: string) {
    if (!this.connected || !this.agents.has(target)) throw new Error('fake target not available');
    this.interrupts.push(target); this.emit('interrupt', target); await this.onInterrupt?.(target);
  }
  async start(type: 'codex' | 'claude', cwd: string) {
    this.starts.push({ type, cwd }); this.emit('start', { type, cwd });
    if (this.onStart) return await this.onStart(type, cwd);
    const target = `terminal-${this.starts.length + 10}`; this.addAgent({ terminalId: target, cwd, type }); return { target };
  }
  async subscribe(onChange: () => void, onDisconnect: (reason: string) => void) {
    this.changed = onChange; this.disconnected = onDisconnect;
    return () => { this.changed = undefined; this.disconnected = undefined; };
  }
  setStatus(target: string, status: AgentObservation['status'], notify = false) {
    const agent = this.agents.get(target); if (!agent) throw new Error('fake agent missing');
    agent.status = status; agent.sequence++; agent.observedAt = Date.now(); if (notify) this.changed?.();
  }
  disconnect(reason = 'injected disconnect') { this.connected = false; this.disconnected?.(reason); }
  close() { this.connected = false; this.changed = undefined; this.disconnected = undefined; }
}

export function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
