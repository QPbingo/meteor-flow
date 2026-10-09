import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { WebSocket } from 'ws';
import { TerminalInput, Value } from '@meteor-flow/contracts';
import { fresh } from '../domain/model.js';
import type { AgentConsole } from '../application/console.js';

type Viewer = { socket:WebSocket; id:string; bindingId:string; closed:boolean; generation:number };
type Owner = {
  viewer:Viewer; token:string; epoch:number; heartbeat:number; child:ChildProcessWithoutNullStreams|null;
  granted:boolean; fingerprint:string; session:string; storageGeneration:string; timer?:NodeJS.Timeout;
};
type ObservationStream = { child:ChildProcessWithoutNullStreams|null; viewers:Set<Viewer>; restarting:boolean };
type ProcessRecord = {
  closed:Promise<void>; resolve:()=>void; stopping:boolean; termination?:Promise<void>;
};
type Dependencies = { spawn?:typeof spawn; clock?:{ wall:()=>number; monotonic:()=>number } };
const maxQueue = 1024 * 1024;
const maxProcesses = 8; // Four observed terminals plus four controllers, including processes still exiting.
const leaseMs = 15_000;

export class TerminalBridge {
  private streams = new Map<string,ObservationStream>();
  private owners = new Map<string,Owner>();
  private epochs = new Map<string,number>();
  private claiming = new Map<string,symbol>();
  private processes = new Map<ChildProcessWithoutNullStreams,ProcessRecord>();
  private generation = 0;
  private disposed = false;
  private timer:NodeJS.Timeout;
  private spawnProcess:typeof spawn;
  private clock:{ wall:()=>number; monotonic:()=>number };
  private onInvalidate = () => { this.invalidate(); };

  constructor(private console:AgentConsole, private executable:string, dependencies:Dependencies = {}) {
    this.spawnProcess = dependencies.spawn ?? spawn;
    this.clock = dependencies.clock ?? { wall:Date.now, monotonic:() => performance.now() };
    console.controlled = id => this.owners.has(id) || this.claiming.has(id);
    console.on('invalidate', this.onInvalidate);
    this.timer = setInterval(() => {
      for (const [id,owner] of this.owners) {
        if (!this.validOwner(owner)) this.release(id,'控制权已过期，请重新核对终端');
      }
    }, 1000);
  }

  attach(bindingId:string, socket:WebSocket) {
    const binding = this.console.store.state.bindings.find(b => b.id === bindingId);
    if (this.disposed || !binding || binding.session !== this.console.store.state.settings.session || !this.console.health.connected) {
      this.send(socket,{type:'error',message:'终端不可用'});socket.close(1008);return;
    }
    if (!this.streams.has(bindingId) && this.streams.size >= 4) {
      this.send(socket,{type:'error',message:'最多同时观察 4 个终端'});socket.close(1013);return;
    }
    const viewer:Viewer = { socket,id:randomUUID(),bindingId,closed:false,generation:this.generation };
    let stream = this.streams.get(bindingId);
    if (!stream) {
      stream = { child:null,viewers:new Set(),restarting:false };
      this.streams.set(bindingId,stream);
    }
    stream.viewers.add(viewer);
    this.state(viewer,'observe','只读观察；接管后才能输入');
    // A new page requires a full redraw. Coalesce concurrent attaches and wait
    // for the old observer's close before starting its replacement.
    void this.restartObserver(bindingId,stream,binding.terminalId);
    socket.on('message',data => {
      if (!this.currentViewer(viewer)) return;
      let message:typeof TerminalInput.static;
      try {
        const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
        if (bytes.length > 20000) throw new Error('终端消息过大');
        const parsed:unknown = JSON.parse(bytes.toString());
        if (!Value.Check(TerminalInput,parsed) || !this.validShape(parsed)) throw new Error('终端消息协议或格式无效');
        message = parsed;
      } catch (error) {
        this.send(socket,{type:'error',message:error instanceof Error ? error.message : String(error)});
        this.detach(viewer);socket.close(1008,'终端消息协议或格式无效');return;
      }
      try {
        if (message.action === 'take') {
          void this.take(viewer).catch(error => this.send(socket,{type:'error',message:String(error)}));return;
        }
        const owner = this.owners.get(bindingId);
        if (!owner || owner.viewer !== viewer || !owner.granted || message.token !== owner.token || message.epoch !== owner.epoch) {
          throw new Error('控制权无效或已过期');
        }
        // Authorize every message against the lease, even when the interval
        // has not run. A late heartbeat must never renew an expired token.
        if (!this.validOwner(owner)) {
          this.release(bindingId,'控制权已过期或连接身份已变化');throw new Error('控制权已过期或连接身份已变化');
        }
        if (message.action === 'release') { this.release(bindingId,'已释放控制；调度保持暂停');return; }
        if (message.action === 'heartbeat') { owner.heartbeat = this.clock.monotonic();return; }
        if (message.action === 'input') this.input(owner,{type:'terminal.input',text:message.text});
        else if (message.action === 'resize') this.input(owner,{type:'terminal.resize',cols:message.cols,rows:message.rows});
      } catch (error) {
        this.send(socket,{type:'error',message:error instanceof Error ? error.message : String(error)});
      }
    });
    socket.once('close',() => this.detach(viewer));
    socket.on('error',() => { this.detach(viewer);socket.close(); });
  }

  private validShape(message:typeof TerminalInput.static) {
    if (message.action === 'take') return message.token === undefined && message.epoch === undefined && message.text === undefined && message.cols === undefined && message.rows === undefined;
    if (message.token === undefined || message.epoch === undefined) return false;
    if (message.action === 'input') return message.text !== undefined && message.cols === undefined && message.rows === undefined;
    if (message.action === 'resize') return message.text === undefined && message.cols !== undefined && message.rows !== undefined;
    return message.text === undefined && message.cols === undefined && message.rows === undefined;
  }

  private currentViewer(viewer:Viewer) {
    return !this.disposed && !viewer.closed && viewer.socket.readyState === 1 && viewer.generation === this.generation &&
      !!this.streams.get(viewer.bindingId)?.viewers.has(viewer);
  }

  private validOwner(owner:Owner) {
    const b = this.console.store.state.bindings.find(b => b.id === owner.viewer.bindingId);
    const age = this.clock.monotonic() - owner.heartbeat;
    return this.currentViewer(owner.viewer) && age >= 0 && age < leaseMs && this.console.store.healthy &&
      this.console.health.connected && this.console.store.generation === owner.storageGeneration &&
      this.console.store.state.settings.session === owner.session && b?.session === owner.session &&
      b.fingerprint === owner.fingerprint && fresh(b.observation,this.clock.wall()) && b.observation.fingerprint === owner.fingerprint;
  }

  private detach(viewer:Viewer) {
    if (viewer.closed) return;
    viewer.closed = true;
    if (this.owners.get(viewer.bindingId)?.viewer === viewer) this.release(viewer.bindingId,'控制页面已断开，调度保持暂停');
    const current = this.streams.get(viewer.bindingId);
    current?.viewers.delete(viewer);
    if (current && !current.viewers.size) {
      this.streams.delete(viewer.bindingId);
      if (current.child) void this.stop(current.child).catch(() => {});
    }
  }

  private async restartObserver(id:string, stream:ObservationStream, target:string) {
    if (stream.restarting) return;
    stream.restarting = true;
    const generation = this.generation;
    try {
      const previous = stream.child;
      stream.child = null; // Immediately fence queued output from the old child.
      if (previous) await this.stop(previous);
      if (this.disposed || generation !== this.generation || this.streams.get(id) !== stream || !stream.viewers.size) return;
      const binding = this.console.store.state.bindings.find(b => b.id === id);
      if (!this.console.health.connected || !binding || binding.session !== this.console.store.state.settings.session || binding.terminalId !== target) throw new Error('终端身份已变化');
      const child = this.spawn('observe',target);
      stream.child = child;
      this.frames(child,data => {
        if (this.streams.get(id) !== stream || stream.child !== child || generation !== this.generation) return;
        for (const v of stream.viewers) {
          if (this.owners.get(id)?.viewer === v && this.owners.get(id)?.granted) continue;
          this.send(v.socket,{type:'output',data});
        }
      },reason => {
        if (this.streams.get(id) === stream && stream.child === child) this.failStream(id,stream,reason);
      });
      child.stdin.end();
    } catch (error) {
      if (this.streams.get(id) === stream) this.failStream(id,stream,String(error));
    } finally { stream.restarting = false; }
  }

  private failStream(id:string, stream:ObservationStream, reason:string) {
    if (this.streams.get(id) !== stream) return;
    this.streams.delete(id);this.release(id,reason);
    if (stream.child) void this.stop(stream.child).catch(() => {});
    for (const v of stream.viewers) {
      v.closed = true;this.send(v.socket,{type:'error',message:reason});v.socket.close(1012);
    }
  }

  private spawn(mode:'observe'|'control', target:string) {
    if (this.disposed || this.processes.size >= maxProcesses) throw new Error('终端进程正在退出或已达到上限，请稍后重试');
    const env = {...process.env};
    for (const key of ['HERDR_SESSION','HERDR_SOCKET_PATH','HERDR_CLIENT_SOCKET_PATH','HERDR_PANE_ID','HERDR_WORKSPACE_ID','HERDR_TERMINAL_ID']) delete env[key];
    const child = this.spawnProcess(this.executable,['--session',this.console.store.state.settings.session,'terminal','session',mode,target,'--cols','120','--rows','32'],{env,stdio:['pipe','pipe','pipe']});
    let resolve!:() => void;
    const closed = new Promise<void>(done => { resolve = done; });
    const record:ProcessRecord = { closed,resolve,stopping:false };
    this.processes.set(child,record);
    child.once('close',() => { this.processes.delete(child);record.resolve(); });
    return child;
  }

  private stop(child:ChildProcessWithoutNullStreams):Promise<void> {
    const record = this.processes.get(child);
    if (!record) return Promise.resolve();
    if (record.termination) return record.termination;
    record.stopping = true;
    record.termination = new Promise<void>((resolve,reject) => {
      // Only close proves that both the process and its output channels have
      // ended. A timed-out child stays in the process budget until that event.
      const force = setTimeout(() => child.kill('SIGKILL'),1000);
      const deadline = setTimeout(() => reject(new Error('终端进程退出未确认，保持容量占用')),3000);
      void record.closed.then(() => { clearTimeout(force);clearTimeout(deadline);resolve(); });
      child.kill('SIGTERM');
    });
    return record.termination;
  }

  private frames(child:ChildProcessWithoutNullStreams, frame:(data:string)=>void, ended:(reason:string)=>void) {
    let buffer = Buffer.alloc(0);let done = false;let stderr = '';
    const decoder = new TextDecoder();
    const finish = (reason:string) => {
      if (done) return;done = true;void this.stop(child).catch(() => {});ended(reason);
    };
    child.stderr.on('data',(data:Buffer) => { if (stderr.length < 4096) stderr += data.toString().slice(0,4096-stderr.length); });
    child.stdout.on('data',(data:Buffer) => {
      if (done || this.processes.get(child)?.stopping) return;
      buffer = Buffer.concat([buffer,data]);
      try {
        while (true) {
          const nl = buffer.indexOf(10);
          if (nl < 0) { if (buffer.length > 2 * maxQueue) throw new Error('终端输出帧过大');break; }
          if (nl > 2 * maxQueue) throw new Error('终端输出帧过大');
          const message = JSON.parse(buffer.subarray(0,nl).toString());buffer = buffer.subarray(nl+1);
          if (message.type === 'terminal.closed') { finish(`终端已关闭：${String(message.reason ?? '')}`);break; }
          if (message.type !== 'terminal.frame' || message.encoding !== 'ansi' || typeof message.bytes !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(message.bytes)) throw new Error('不支持的终端流协议');
          const bytes = Buffer.from(message.bytes,'base64');if (bytes.length > maxQueue) throw new Error('终端输出超限');
          frame(decoder.decode(bytes,{stream:true}));
        }
      } catch (error) { finish(String(error)); }
    });
    child.stdin.on('error',error => finish(error.message));
    child.stdout.on('error',error => finish(error.message));
    child.stderr.on('error',error => finish(error.message));
    child.once('error',error => finish(error.message));
    child.once('close',() => finish(stderr.trim() || '终端连接已结束'));
  }

  private async take(viewer:Viewer) {
    const id = viewer.bindingId;
    if (this.owners.has(id) || this.claiming.has(id)) throw new Error('另一个页面已持有或正在申请控制权');
    const claim = Symbol(id);
    const generation = this.generation;
    const storageGeneration = this.console.store.generation;
    const session = this.console.store.state.settings.session;
    const binding = this.console.store.state.bindings.find(b => b.id === id);
    const fingerprint = binding?.fingerprint;
    const target = binding?.terminalId;
    const stillCurrent = () => this.currentViewer(viewer) && generation === this.generation &&
      this.claiming.get(id) === claim && this.console.store.generation === storageGeneration &&
      this.console.store.state.settings.session === session;
    this.claiming.set(id,claim);
    try {
      await this.console.bindingAction(id,{operation_id:randomUUID(),action:'manual',reason:'网页终端接管'});
      if (!stillCurrent()) throw new Error('控制申请的连接代已失效');
      await this.console.refresh();
      const b = this.console.store.state.bindings.find(b => b.id === id);
      if (!stillCurrent() || !b || b.session !== session || b.fingerprint !== fingerprint || b.terminalId !== target ||
        !fresh(b.observation,this.clock.wall()) || b.observation.fingerprint !== fingerprint || !this.console.store.healthy || !this.console.health.connected) throw new Error('终端状态无法确认');
      const owner:Owner = {
        viewer,token:randomUUID(),epoch:(this.epochs.get(id) ?? 0)+1,heartbeat:this.clock.monotonic(),
        child:null,granted:false,fingerprint:b.observation.fingerprint,session,storageGeneration,
      };
      const child = this.spawn('control',b.terminalId);owner.child = child;
      this.epochs.set(id,owner.epoch);this.owners.set(id,owner);
      owner.timer = setTimeout(() => { if (this.owners.get(id) === owner) this.release(id,'控制申请超时；请核对原生终端控制权'); },5000);
      this.frames(child,data => {
        if (this.owners.get(id) !== owner) return;
        if (!this.validOwner(owner)) { this.release(id,'控制权已过期或连接身份已变化');return; }
        if (!owner.granted) {
          clearTimeout(owner.timer);owner.granted = true;this.state(viewer,'control','已接管；输入将发送到 Agent',owner);
        }
        this.send(viewer.socket,{type:'output',data});
      },reason => { if (this.owners.get(id) === owner) this.release(id,reason); });
    } finally { if (this.claiming.get(id) === claim) this.claiming.delete(id); }
  }

  private input(owner:Owner, frame:unknown) {
    if (!this.validOwner(owner)) { this.release(owner.viewer.bindingId,'控制权已过期或连接身份已变化');throw new Error('控制权已过期'); }
    if (!owner.child || owner.child.stdin.destroyed || owner.child.stdin.writableLength > 65536) {
      this.release(owner.viewer.bindingId,'输入通道已阻塞，控制权失效');throw new Error('输入未确认，请在终端核对，勿自动重发');
    }
    owner.child.stdin.write(`${JSON.stringify(frame)}\n`);
  }

  private release(id:string, message:string) {
    const owner = this.owners.get(id);if (!owner) return;
    this.owners.delete(id);this.epochs.set(id,owner.epoch+1);clearTimeout(owner.timer);
    if (owner.child) {
      if (!owner.child.stdin.destroyed && !owner.child.stdin.writableEnded) owner.child.stdin.end(`${JSON.stringify({type:'terminal.release'})}\n`);
      void this.stop(owner.child).catch(() => {});
    }
    this.state(owner.viewer,'observe',message);
  }

  private state(viewer:Viewer, mode:'observe'|'control', message:string, owner?:Owner) {
    this.send(viewer.socket,{type:'state',mode,message,epoch:owner?.epoch ?? this.epochs.get(viewer.bindingId) ?? 0,...(owner ? {token:owner.token} : {})});
  }

  private send(socket:WebSocket, value:Record<string,unknown>) {
    if (socket.readyState !== 1) return;
    if (socket.bufferedAmount > maxQueue) { socket.close(1013,'终端积压，请重新连接以取得完整画面');return; }
    socket.send(JSON.stringify({...value,protocol:'meteor-flow.terminal/v1'}));
  }

  invalidate() {
    this.generation++;this.claiming.clear();
    for (const id of this.owners.keys()) this.release(id,'连接代已失效，调度保持暂停');
    for (const stream of this.streams.values()) {
      for (const v of stream.viewers) { v.closed = true;v.socket.close(1012,'连接已失效'); }
    }
    this.streams.clear();
    for (const child of this.processes.keys()) void this.stop(child).catch(() => {});
  }

  async close() {
    this.disposed = true;clearInterval(this.timer);this.console.off('invalidate',this.onInvalidate);this.invalidate();
    const results = await Promise.allSettled([...this.processes.keys()].map(child => this.stop(child)));
    if (results.some(result => result.status === 'rejected')) throw new Error('终端进程退出未确认');
  }
}
