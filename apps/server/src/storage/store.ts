import { Worker } from 'node:worker_threads';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { State } from '@meteor-flow/contracts';
import { DomainError, type Command } from '../domain/model.js';
import { applyStatePatch, type StatePatch } from './state-patch.js';

type Reply = {generation:string;id?:string;ready?:boolean;ok?:boolean;fatal?:boolean;state?:State;patch?:StatePatch;result?:unknown;replayed?:boolean;error?:{code?:string;message:string;status?:number}};
type Pending={resolve:(reply:{result:unknown;replayed:boolean})=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout};
export class Store extends EventEmitter {
  state!:State;
  healthy=false;
  generation='';
  error:string|null=null;
  private worker:Worker|null=null;
  private exited:Promise<void>=Promise.resolve();
  private pending=new Map<string,Pending>();
  private closed=false;
  private starting=false;
  constructor(private file:string,private session:string,private options:{deadlineMs?:number;workerURL?:URL}={}){super();}

  async open() {
    if(this.starting||this.worker)throw new Error('旧 writer 尚未退出，拒绝创建第二个 writer');
    if(this.closed)throw new Error('存储已关闭');
    this.starting=true;
    await this.exited;
    if(this.closed){this.starting=false;throw new Error('存储已关闭');}
    const generation=randomUUID();
    this.generation=generation;
    this.error=null;
    let finishExit!:()=>void;
    this.exited=new Promise<void>(resolve=>{finishExit=resolve;});
    try {
      const worker=new Worker(this.options.workerURL??new URL('./worker.js',import.meta.url),{workerData:{file:this.file,session:this.session,generation},resourceLimits:{maxYoungGenerationSizeMb:16}});
      this.worker=worker;
      await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>{this.fail('数据库启动超时');reject(new Error(this.error!));},this.options.deadlineMs??10000);
        worker.on('message',(reply:Reply)=>{
          if(reply.generation!==this.generation)return;
          if(reply.fatal){clearTimeout(timer);this.fail(reply.error?.message??'数据库写入失败');reject(new Error(this.error!));return;}
          if(reply.ready){clearTimeout(timer);this.state=reply.state!;this.healthy=true;this.error=null;resolve();return;}
          if(!this.healthy||!reply.id)return;
          const pending=this.pending.get(reply.id);
          if(!pending)return;
          clearTimeout(pending.timer);this.pending.delete(reply.id);
          if(reply.ok){this.state=reply.state??applyStatePatch(this.state,reply.patch!);this.emit('change',this.state);pending.resolve({result:reply.result,replayed:!!reply.replayed});}
          else pending.reject(new DomainError(reply.error?.code??'COMMAND',reply.error?.message??'命令失败',reply.error?.status??409));
        });
        worker.on('error',error=>{clearTimeout(timer);this.fail(error.message);reject(error);});
        worker.on('exit',code=>{
          clearTimeout(timer);
          if(this.worker===worker)this.worker=null;
          if(this.generation===generation)this.fail(`数据库线程已退出（${code}）`);
          finishExit();reject(new Error(`数据库线程已退出（${code}）`));
        });
      });
    }catch(error){if(!this.worker)finishExit();throw error;}
    finally{this.starting=false;}
  }

  command<T=unknown>(command:Command,operation?:{id:string;digest:string}):Promise<{result:T;replayed:boolean}> {
    if(!this.healthy||!this.worker)return Promise.reject(new DomainError('STORAGE',this.error??'存储不可用',503));
    if(this.pending.size>=128)return Promise.reject(new DomainError('BUSY','存储队列已满，请稍后重试',503));
    const id=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.fail('数据库提交确认超时，已暂停所有新副作用'),this.options.deadlineMs??10000);
      this.pending.set(id,{resolve:reply=>resolve(reply as {result:T;replayed:boolean}),reject,timer});
      this.worker!.postMessage({generation:this.generation,id,command,operation});
    });
  }

  private fail(message:string) {
    if(!this.healthy&&this.error)return;
    this.healthy=false;this.error=message;this.generation=randomUUID();
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new DomainError('STORAGE',message,503));}
    this.pending.clear();this.emit('fault',message);
    // terminate() requests termination; only the exit event unlocks open().
    void this.worker?.terminate();
  }

  async recover(){await this.exited;if(this.closed)throw new Error('存储已关闭');await this.open();await this.command({type:'recover'});}
  async close(){this.closed=true;this.fail('服务正在关闭');await this.exited;}
}
