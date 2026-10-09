import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import type { WebSocket } from 'ws';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Binding } from '@meteor-flow/contracts';
import type { AgentConsole } from '../application/console.js';
import { TerminalBridge } from './bridge.js';

const protocol = 'meteor-flow.terminal/v1';
class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  frames:Array<Record<string,any>> = [];
  closes:number[] = [];
  send(text:string) { this.frames.push(JSON.parse(text)); }
  close(code = 1000) { if (this.readyState !== 1) return;this.closes.push(code);this.readyState = 3;this.emit('close'); }
  request(data:Record<string,unknown>) { this.emit('message',Buffer.from(JSON.stringify({protocol,...data}))); }
}
class Child extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  signals:Array<NodeJS.Signals> = [];
  writes:string[] = [];
  closed = false;
  constructor(readonly mode:string) { super();this.stdin.on('data',data => this.writes.push(data.toString())); }
  kill(signal:NodeJS.Signals) { this.signals.push(signal);return true; }
  frame(text:string) { this.stdout.write(JSON.stringify({type:'terminal.frame',encoding:'ansi',bytes:Buffer.from(text).toString('base64')})+'\n'); }
  end() { if (this.closed) return;this.closed = true;this.emit('exit',0,null);this.emit('close',0,null); }
  commands() { return this.writes.join('').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
}
function gate() { let resolve!:()=>void;const promise = new Promise<void>(done => { resolve = done; });return {promise,resolve}; }
const flush = async () => { for (let i=0;i<6;i++) await Promise.resolve(); };
let bridge:TerminalBridge;
let children:Child[];
let service:EventEmitter & Pick<AgentConsole,'store'|'health'|'bindingAction'|'refresh'|'controlled'>;
let mono:number;
let wall:number;
let binding:Binding;

beforeEach(() => {
  vi.useFakeTimers();mono = 0;wall = 1_800_000_000_000;children = [];
  binding = {
    id:'binding',projectId:'project',session:'session',terminalId:'terminal',label:'agent',type:'codex',cwd:'/tmp/test',
    fingerprint:'identity',agentSession:null,mode:'observe',confirmed:true,managed:false,paused:false,reason:'',revision:1,
    observation:{terminalId:'terminal',paneId:'pane',type:'codex',status:'idle',cwd:'/tmp/test',agentSession:null,pid:42,
      processStart:'start',sequence:1,launchPending:false,interactiveReady:true,fingerprint:'identity',observedAt:wall},
  };
  service = Object.assign(new EventEmitter(),{
    store:{healthy:true,generation:'storage-generation',state:{bindings:[binding],settings:{session:'session'}}} as AgentConsole['store'],
    health:{connected:true} as AgentConsole['health'],
    bindingAction:vi.fn(async () => { binding.mode='manual';binding.paused=true; }),
    refresh:vi.fn(async () => []),controlled:() => false,
  });
  const spawnChild = vi.fn((_executable:string,args:string[]) => {
    const child = new Child(args[4]!);children.push(child);return child as unknown as ChildProcessWithoutNullStreams;
  });
  bridge = new TerminalBridge(service as AgentConsole,'/fixed/herdr',{spawn:spawnChild as unknown as typeof spawn,clock:{wall:()=>wall,monotonic:()=>mono}});
});
afterEach(async () => {
  const closing = bridge.close();
  for (const child of children) child.end();
  await closing;
  vi.useRealTimers();
});
function attach() { const socket = new Socket();bridge.attach(binding.id,socket as unknown as WebSocket);return socket; }
async function control(socket:Socket) {
  socket.request({action:'take'});await flush();
  const child = children.at(-1)!;expect(child.mode).toBe('control');child.frame('ready');
  const state = socket.frames.findLast(frame => frame.mode === 'control')!;
  expect(state).toMatchObject({protocol,mode:'control'});
  return {child,token:state.token,epoch:state.epoch};
}

it('starts observe at epoch zero and versions every state/output/error frame', () => {
  const socket = attach();children[0]!.frame('screen');socket.request({action:'input',text:'x',token:'stolen',epoch:1});
  expect(socket.frames[0]).toMatchObject({type:'state',mode:'observe',epoch:0,protocol});
  expect(socket.frames.map(frame => frame.type)).toEqual(['state','output','error']);
  expect(socket.frames.every(frame => frame.protocol === protocol)).toBe(true);
  expect(children[0]!.commands()).toEqual([]);
});

it.each([
  {action:'input',text:'expired'},
  {action:'resize',cols:100,rows:30},
  {action:'heartbeat'},
])('rejects an expired $action before the interval runs', async action => {
  const socket = attach();const lease = await control(socket);
  mono = 15_000; // Intentionally do not advance timers: the interval never runs.
  socket.request({...action,token:lease.token,epoch:lease.epoch});
  expect(service.controlled(binding.id)).toBe(false);
  expect(lease.child.commands()).toEqual([{type:'terminal.release'}]);
  expect(socket.frames.findLast(frame => frame.type === 'state')).toMatchObject({mode:'observe'});
  socket.request({action:'input',text:'late after heartbeat',token:lease.token,epoch:lease.epoch});
  expect(lease.child.commands().some(frame => frame.type === 'terminal.input')).toBe(false);
});

it('renews a live lease, routes valid input/resize once, and rejects token/epoch/connection theft', async () => {
  const socket = attach();const lease = await control(socket);
  const observer = attach();
  mono = 14_999;socket.request({action:'heartbeat',token:lease.token,epoch:lease.epoch});
  mono = 15_001;
  socket.request({action:'input',text:'accepted',token:lease.token,epoch:lease.epoch});
  socket.request({action:'resize',cols:100,rows:30,token:lease.token,epoch:lease.epoch});
  socket.request({action:'input',text:'bad token',token:'wrong',epoch:lease.epoch});
  socket.request({action:'input',text:'bad epoch',token:lease.token,epoch:lease.epoch+1});
  observer.request({action:'input',text:'other connection',token:lease.token,epoch:lease.epoch});
  expect(lease.child.commands()).toEqual([{type:'terminal.input',text:'accepted'},{type:'terminal.resize',cols:100,rows:30}]);
  expect(service.controlled(binding.id)).toBe(true);
});

it.each([
  {action:'take',protocol:'meteor-flow.terminal/v2'},
  {action:'unexpected'},
  {action:'input',token:'x',epoch:1},
  {action:'resize',token:'x',epoch:1,cols:100},
  {action:'heartbeat',token:'x',epoch:1,text:'not allowed'},
  {action:'take',extra:true},
])('closes unknown protocol or malformed request %# without control side effects', async request => {
  const socket = attach();socket.request(request);await flush();
  expect(socket.frames.at(-1)).toMatchObject({type:'error',protocol});
  expect(socket.closes).toEqual([1008]);
  expect(service.bindingAction).not.toHaveBeenCalled();
  expect(children.filter(child => child.mode === 'control')).toEqual([]);
});

it('rejects malformed JSON and makes queued requests after closure inert', async () => {
  const socket = attach();socket.emit('message',Buffer.from('{broken'));
  socket.request({action:'take'});await flush();
  expect(socket.closes).toEqual([1008]);expect(service.bindingAction).not.toHaveBeenCalled();
});

it('fences old observer bytes and coalesces attaches until close, including exit-before-close', async () => {
  const first = attach();const old = children[0]!;old.frame('old full');
  const second = attach();const third = attach();
  old.frame('buffered old data');
  expect(second.frames.some(frame => frame.type === 'output')).toBe(false);
  expect(third.frames.some(frame => frame.type === 'output')).toBe(false);
  expect(first.frames.filter(frame => frame.type === 'output').map(frame => frame.data)).toEqual(['old full']);
  expect(children).toHaveLength(1);
  old.emit('exit',0,null);await flush();expect(children).toHaveLength(1);
  old.end();await flush();expect(children).toHaveLength(2);
  children[1]!.frame('new full');old.frame('late old data');
  for (const socket of [first,second,third]) expect(socket.frames.filter(frame => frame.type === 'output').at(-1)?.data).toBe('new full');
  expect(second.frames.filter(frame => frame.type === 'output')).toHaveLength(1);
});

it('escalates a stuck observer to SIGKILL and waits for close before its replacement', async () => {
  attach();const old = children[0]!;attach();
  expect(old.signals).toEqual(['SIGTERM']);
  await vi.advanceTimersByTimeAsync(1000);expect(old.signals).toEqual(['SIGTERM','SIGKILL']);
  expect(children).toHaveLength(1);old.end();await flush();expect(children).toHaveLength(2);
});

it('retains unclosed children in the global budget under repeated attachment', async () => {
  for (let i=0;i<30;i++) { const socket = attach();socket.close(); }
  expect(children).toHaveLength(8);
  expect(children.every(child => !child.closed)).toBe(true);
  const blocked = attach();expect(blocked.closes).toEqual([1012]);expect(children).toHaveLength(8);
  children[0]!.end();await flush();attach();expect(children).toHaveLength(9);
  expect(children.filter(child => !child.closed)).toHaveLength(8);
});

it('close waits for all observers/controllers, and repeated close is harmless after completion', async () => {
  const socket = attach();await control(socket);attach();
  let complete = false;const closing = bridge.close().then(() => { complete=true; });
  await flush();expect(complete).toBe(false);
  for (const child of children) child.emit('exit',0,null);
  await flush();expect(complete).toBe(false);
  for (const child of children) child.end();
  await closing;expect(complete).toBe(true);await bridge.close();
});

it('reports shutdown timeout without freeing a process whose close is unconfirmed', async () => {
  attach();const closing = bridge.close();const rejected = expect(closing).rejects.toThrow(/退出未确认/);
  await vi.advanceTimersByTimeAsync(3000);await rejected;
  expect(children[0]!.signals).toEqual(['SIGTERM','SIGKILL']);
  expect(children[0]!.closed).toBe(false);children[0]!.end();
  await bridge.close();
});

it.each(['pause','refresh'])('invalidates a pending claim at the %s barrier without spawning a controller', async stage => {
  const socket = attach();const barrier = gate();
  if (stage === 'pause') vi.mocked(service.bindingAction).mockImplementation(async () => barrier.promise);
  else vi.mocked(service.refresh).mockImplementation(async () => { await barrier.promise;return []; });
  socket.request({action:'take'});await flush();expect(service.controlled(binding.id)).toBe(true);
  service.emit('invalidate');barrier.resolve();await flush();
  expect(children.some(child => child.mode === 'control')).toBe(false);
  expect(service.controlled(binding.id)).toBe(false);
});

it('rejects a pending claim after storage generation changes without requiring an invalidate event', async () => {
  const socket = attach();const barrier = gate();
  vi.mocked(service.refresh).mockImplementation(async () => { await barrier.promise;return []; });
  socket.request({action:'take'});await flush();
  Object.assign(service.store,{generation:'replacement'});barrier.resolve();await flush();
  expect(children.some(child => child.mode === 'control')).toBe(false);
  expect(service.controlled(binding.id)).toBe(false);
});

it('rejects replacement of the binding identity while the control claim is waiting', async () => {
  const socket = attach();const barrier = gate();
  vi.mocked(service.refresh).mockImplementation(async () => { await barrier.promise;return []; });
  socket.request({action:'take'});await flush();
  binding.fingerprint = 'replacement';binding.observation!.fingerprint = 'replacement';
  barrier.resolve();await flush();
  expect(children.some(child => child.mode === 'control')).toBe(false);
  expect(service.controlled(binding.id)).toBe(false);
});

it('does not let an old claim completion clear a new connection claim', async () => {
  const oldSocket = attach();const oldGate = gate();const newGate = gate();
  vi.mocked(service.bindingAction).mockImplementationOnce(async () => oldGate.promise).mockImplementationOnce(async () => newGate.promise);
  oldSocket.request({action:'take'});await flush();service.emit('invalidate');
  const nextSocket = attach();nextSocket.request({action:'take'});await flush();
  oldGate.resolve();await flush();expect(service.controlled(binding.id)).toBe(true);
  expect(children.some(child => child.mode === 'control')).toBe(false);
  newGate.resolve();await flush();
  expect(children.filter(child => child.mode === 'control')).toHaveLength(1);
  children.at(-1)!.frame('new control');
  expect(nextSocket.frames.findLast(frame => frame.mode === 'control')).toBeDefined();
});
