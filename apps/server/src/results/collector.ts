import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs, { mkdir, readdir, statfs } from 'node:fs/promises';
import { openSync, closeSync, fsyncSync } from 'node:fs';
import { join } from 'node:path';
import { safeRead, processIdentity } from '@meteor-flow/posix-fs';
import type { Attempt, CollectionJob, FrozenInput, Task } from '@meteor-flow/contracts';
import { Store } from '../storage/store.js';
import { limits, parseResult, type Manifest } from './protocol.js';
import type { ChildRequest } from './child.js';
import { definitelyGone } from '../application/process.js';
import { performance } from 'node:perf_hooks';

type ChildReply={ready?:boolean;ok?:boolean;error?:string;input?:FrozenInput;directory?:string;manifest?:Manifest};
export class Collector {
  readonly archiveRoot:string;
  private children=new Map<string,ChildProcess>();
  private reservations=new Set<string>();
  private stopped=false;
  constructor(private store:Store,private dataDir:string,readonly generation:string,private options:{timeoutMs?:number;childURL?:URL;maxJobs?:number}={}){this.archiveRoot=join(dataDir,'archives');}
  async init(){await mkdir(this.archiveRoot,{recursive:true,mode:0o700});await mkdir(join(this.dataDir,'staging'),{recursive:true,mode:0o700});await this.reconcile();}

  async reconcile(){
    await this.reapOrphans(true);
    for(const archive of await readdir(this.archiveRoot)){
      if(!/^[a-f0-9-]{36}$/.test(archive))continue;
      try{
        const manifest=await this.verify(join(this.archiveRoot,archive));
        if(manifest.archiveId!==archive)throw new Error('归档目录与声明不匹配');
        const attempt=this.store.state.attempts.find(a=>a.id===manifest.attemptId&&a.taskId===manifest.taskId);
        if(attempt&&!attempt.resultHash&&attempt.cancelRequested===manifest.cancelRequested)await this.record(manifest);
      }catch{/* incomplete/unrelated archives stay private for inspection */}
    }
  }
  async reapOrphans(includePreviousRunning=false){
    for(const job of this.store.state.jobs.filter(j=>j.status==='orphaned'||includePreviousRunning&&['intent','running'].includes(j.status))){
      const identity=job.pid?processIdentity(job.pid):null;
      if(job.pid&&identity&&identity===job.processStart){
        try{process.kill(job.pid,'SIGKILL');}catch{/* recheck below; never kill on PID alone */}
      }
      // Do not wait with a PID timeout and assume death. A surviving or unidentifiable
      // process reserves a slot until a later reconciliation proves it is absent.
      const remains=job.pid?processIdentity(job.pid):null;
      const exited=!!job.pid&&(definitelyGone(job.pid)||(!!remains&&!!job.processStart&&remains!==job.processStart));
      if(exited||job.status!=='orphaned')await this.store.command({type:'job',job:{...job,status:exited?'failed':'orphaned',reason:exited?'旧进程已核对退出；旧 staging 不复用':'进程身份或退出未确认，保留容量并隔离 staging'}});
    }
  }

  async prepare(task:Task,cwd:string,input:FrozenInput,attemptId:string):Promise<FrozenInput>{
    const reply=await this.run({kind:'prepare',jobId:randomUUID(),generation:this.generation,taskId:task.id,attemptId,cwd,staging:'',archiveRoot:this.archiveRoot,input});
    if(!reply.input)throw new Error('输入准备响应不完整');return reply.input;
  }

  async collect(attempt:Attempt,cwd:string){
    const storageGeneration=this.store.generation;
    const expires=performance.now()+(this.options.timeoutMs??60000);
    const archiveId=randomUUID();
    const request:ChildRequest={kind:'collect',jobId:randomUUID(),generation:this.generation,taskId:attempt.taskId,attemptId:attempt.id,cwd,staging:'',archiveId,cancelRequested:attempt.cancelRequested,input:attempt.input};
    const valid=()=>{
      const latest=this.store.state.attempts.find(a=>a.id===attempt.id);
      if(!latest||latest.cancelRequested!==attempt.cancelRequested||this.stopped||!this.store.healthy||this.store.generation!==storageGeneration||performance.now()>=expires)throw new Error('采集代、取消状态或期限已变化，保留私有 staging');
    };
    await this.run(request,expires-performance.now());valid();
    const manifest=await this.verify(request.staging,expires-performance.now());valid();
    if(manifest.jobId!==request.jobId||manifest.generation!==this.generation||manifest.attemptId!==attempt.id||manifest.archiveId!==archiveId)throw new Error('采集归属不一致');
    const published=join(this.archiveRoot,archiveId);
    await fs.rename(request.staging,published);
    try{valid();}
    catch(error){
      // No DB publication has been attempted. Remove this invalid candidate from
      // the recovery scan as well; its bytes remain private for inspection.
      await fs.rename(published,`${request.staging}.invalidated`);throw error;
    }
    this.syncDirectory(this.archiveRoot);
    await this.record(manifest);
  }

  private async record(manifest:Manifest){await this.store.command({type:'result',id:manifest.attemptId,result:manifest.result,hash:manifest.resultHash,archiveId:manifest.archiveId,artifacts:manifest.artifacts});}

  async verify(directory:string,timeoutMs=this.options.timeoutMs??60000):Promise<Manifest>{
    // Only small metadata is inspected here to bind the verification job. It is
    // re-read and fully checked in a child after the previous writer has exited.
    const metadata=JSON.parse(safeRead(directory,'manifest.json',4*1024*1024).data.toString('utf8')) as Manifest;
    if(!this.store.state.attempts.some(a=>a.id===metadata.attemptId&&a.taskId===metadata.taskId))throw new Error('归档执行不存在');
    const reply=await this.run({kind:'verify',jobId:randomUUID(),generation:this.generation,taskId:metadata.taskId,attemptId:metadata.attemptId,cwd:directory,staging:'',directory},timeoutMs);
    if(!reply.manifest)throw new Error('归档复核响应缺失');return reply.manifest;
  }

  private syncDirectory(directory:string){const fd=openSync(directory,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
  private async run(request:ChildRequest,timeoutMs=this.options.timeoutMs??60000):Promise<ChildReply>{
    if(this.stopped||!this.store.healthy)throw new Error('采集服务不可用');
    const reserved=new Set([...this.reservations,...this.store.state.jobs.filter(j=>['intent','running','orphaned'].includes(j.status)).map(j=>j.id)]);
    if(reserved.size>=(this.options.maxJobs??2))throw new Error('采集容量已满（包含未回收进程）');
    this.reservations.add(request.jobId);
    try{return await this.perform(request,timeoutMs);}finally{this.reservations.delete(request.jobId);}
  }
  private async perform(request:ChildRequest,timeoutMs:number):Promise<ChildReply>{
    if(timeoutMs<=0)throw new Error('采集期限已到');
    const disk=await statfs(this.dataDir);if(disk.bavail*disk.bsize<limits.total*2)throw new Error('磁盘空间不足以安全采集');
    request.staging=join(this.dataDir,'staging',request.jobId);
    await mkdir(request.staging,{mode:0o700});
    const job:CollectionJob={id:request.jobId,taskId:request.taskId,attemptId:request.attemptId,kind:request.kind,generation:this.generation,staging:request.staging,pid:null,processStart:null,status:'intent',reason:''};
    await this.store.command({type:'job',job});
    const storageGeneration=this.store.generation;
    let child:ChildProcess;
    try{child=fork(this.options.childURL??new URL('./child.js',import.meta.url),[],{stdio:['ignore','ignore','pipe','ipc'],serialization:'json'});}catch(error){await this.store.command({type:'job',job:{...job,status:'failed',reason:String(error)}});throw error;}
    this.children.set(job.id,child);
    return new Promise<ChildReply>((resolve,reject)=>{
      let candidate:ChildReply|undefined;let exitSeen=false;let code:number|null=null;let failure:string|null=null;let sent=false;let stderr='';
      const fail=(message:string)=>{failure??=message;child.kill('SIGKILL');};
      const timer=setTimeout(()=>fail('采集超时，等待子进程退出'),timeoutMs);
      child.stderr?.on('data',(chunk:Buffer)=>{if(stderr.length<4096)stderr+=chunk.toString().slice(0,4096-stderr.length);});
      child.on('error',error=>fail(error.message));
      child.on('message',(reply:ChildReply)=>{
        if(reply.ready&&!sent){sent=true;void(async()=>{
          job.pid=child.pid??null;job.processStart=job.pid?processIdentity(job.pid):null;
          if(!job.pid||!job.processStart)throw new Error('无法确定采集进程身份');
          job.status='running';await this.store.command({type:'job',job});
          if(this.store.generation!==storageGeneration||this.stopped||exitSeen)throw new Error('采集启动代已失效');
          child.send(request);
        })().catch(error=>fail(error.message));}
        else if(typeof reply.ok==='boolean')candidate=reply;
      });
      child.on('exit',value=>{exitSeen=true;code=value;});
      child.on('close',()=>{void(async()=>{
        clearTimeout(timer);this.children.delete(job.id);
        const valid=exitSeen&&code===0&&candidate?.ok&&!failure&&this.store.generation===storageGeneration&&!this.stopped;
        if(this.store.healthy)await this.store.command({type:'job',job:{...job,status:valid?'finished':'failed',reason:valid?'子进程已退出并关闭全部通道':failure??candidate?.error??stderr??'采集退出异常'}});
        if(valid)resolve(candidate!);else reject(new Error(failure??candidate?.error??(stderr||'采集未完整结束')));
      })().catch(reject);});
    });
  }
  async close(){this.stopped=true;await Promise.all([...this.children.values()].map(child=>new Promise<void>(resolve=>{child.once('close',()=>resolve());child.kill('SIGKILL');})));}
}
