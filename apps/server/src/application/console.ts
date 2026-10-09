import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, lstat, statfs } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { performance } from 'node:perf_hooks';
import { canonicalDirectory, directoriesOverlap, processIdentity, safeRead } from '@meteor-flow/posix-fs';
import type { Action, Attempt, Binding, ConsoleSnapshot, CreateTask, FrozenInput, Observation, Project, StartRecord, Task } from '@meteor-flow/contracts';
import { active, current, digest, DomainError, ensure, fresh, ready, waiting, type Command } from '../domain/model.js';
import { HerdrClient, HerdrError, type HerdrPort } from '../adapters/herdr/index.js';
import { Store } from '../storage/store.js';
import { Collector } from '../results/collector.js';
import { limits } from '../results/protocol.js';
import { definitelyGone } from './process.js';

export type ConsoleOptions={dataDir:string;session:string;executable:string;portFactory?:(session:string)=>HerdrPort;minFreeBytes?:number;pollMs?:number;sessionSwitch?:(session:string)=>Promise<()=>void>};
export class AgentConsole extends EventEmitter {
  readonly generation=randomUUID();
  readonly store:Store;
  readonly collector:Collector;
  readonly options:ConsoleOptions;
  discoveries:Observation[]=[];
  health:ConsoleSnapshot['health']={storage:false,connected:false,version:null,error:null,lastObservation:null};
  port:HerdrPort;
  controlled=(bindingId:string)=>false;
  private commands:Promise<unknown>=Promise.resolve();
  private reads:Promise<unknown>=Promise.resolve();
  private ticking=false;
  private stopped=false;
  private timer?:NodeJS.Timeout;
  private collecting=new Set<string>();
  private starting=new Set<string>();
  private collectionErrors=new Set<string>();
  private scan=0;
  private clock={wall:Date.now(),mono:performance.now()};
  private reconciling=false;
  private connecting=false;

  constructor(options:ConsoleOptions){
    super();this.options=options;
    this.store=new Store(join(options.dataDir,'meteor-flow.sqlite'),options.session);
    this.collector=new Collector(this.store,options.dataDir,this.generation);
    this.port=this.makePort(options.session);
    this.store.on('change',()=>this.emit('change'));
    this.store.on('fault',(message:string)=>{this.health.storage=false;this.health.error=message;this.emit('invalidate',message);});
  }
  private makePort(session:string){return this.options.portFactory?.(session)??new HerdrClient({session,executable:this.options.executable});}
  private serial<T>(action:()=>Promise<T>):Promise<T>{const next=this.commands.then(action,action);this.commands=next.catch(()=>{});return next;}
  private operation(id:string,request:unknown){return {id,digest:digest(request)};}
  private replay(id:string,request:unknown){
    const previous=this.store.state.operations.find(o=>o.id===id);
    if(previous)ensure(previous.digest===digest(request),'OPERATION_CONFLICT','同一操作标识不能用于不同请求');
    return previous;
  }
  private async write<T>(command:Command,id?:string,request?:unknown){return this.store.command<T>(command,id?this.operation(id,request??command):undefined);}

  async open(){
    await this.store.open();
    if(this.store.state.settings.session!==this.options.session){await this.write({type:'session',session:this.options.session});}
    await this.write({type:'recover'});
    await this.collector.init();this.health.storage=true;
    await this.connect();
    this.timer=setInterval(()=>void this.tick(),this.options.pollMs??500);
  }
  private async connect(){
    if(this.stopped||this.health.connected||this.connecting)return;
    this.connecting=true;
    try{
      const info=await this.port.connect();this.health.version=info.version;
      await this.port.subscribe(()=>{if(this.health.connected&&!this.ticking)void this.tick();},reason=>void this.disconnected(reason));
      this.health.connected=true;await this.refresh();this.health.error=null;
    }catch(error){this.health.connected=false;this.health.error=error instanceof Error?error.message:String(error);}
    finally{this.connecting=false;}
  }
  private async disconnected(reason:string){
    this.health.connected=false;this.health.error=reason;this.discoveries=[];this.emit('invalidate',reason);
    if(this.store.healthy)try{await this.write({type:'disconnect',reason});}catch{/* storage fault already reported */}
  }
  async refresh():Promise<Observation[]>{
    const port=this.port;
    const read=this.reads.then(async()=>{
      ensure(this.health.connected&&port===this.port,'DISCONNECTED','herdr 未连接');
      const observations=await port.listAgents();
      ensure(port===this.port&&this.health.connected,'DISCONNECTED','连接代已经变化');
      this.discoveries=observations;this.health.lastObservation=Date.now();
      if(this.store.healthy)await this.write({type:'observe',observations});
      return observations;
    });
    this.reads=read.catch(()=>{});return read;
  }
  snapshot():ConsoleSnapshot{
    const {operations:_,...state}=this.store.state;
    return {...state,tasks:state.tasks.map(task=>task.phase==='queued'?{...task,reason:waiting(this.store.state,task)??'等待调度'}:task),events:state.events.slice(-1000),health:{...this.health,storage:this.store.healthy},discoveries:this.discoveries,generation:this.generation};
  }
  async createProject(data:{operation_id:string;name:string;root:string}){
    return this.serial(async()=>{
      const replay=this.replay(data.operation_id,data);if(replay)return replay.result as Project;
      ensure(isAbsolute(data.root),'PATH','项目根目录必须是绝对路径');
      let root:string;
      try{root=canonicalDirectory(data.root);}catch(error){
        const code=(error as NodeJS.ErrnoException).code;
        throw new DomainError('PROJECT_DIRECTORY',code==='ENOENT'?'此目录不存在。请先创建目录，或填写现有目录的绝对路径':code==='EACCES'||code==='EPERM'?'无法访问此目录，请检查目录读取权限':'项目根目录必须是可访问的现有目录',400);
      }
      return (await this.write<Project>({type:'project.create',data:{name:data.name,root}},data.operation_id,data)).result;
    });
  }
  async archiveProject(id:string,operationId:string){return this.serial(async()=>(await this.write({type:'project.archive',id},operationId,{id,action:'archive-project'})).result);}

  async attach(data:{operation_id:string;projectId:string;terminalId:string;label:string}){
    return this.serial(async()=>{
      const old=this.store.state.operations.find(o=>o.id===data.operation_id);
      if(old){ensure(old.digest===digest(data),'OPERATION_CONFLICT','同一操作标识不能用于不同请求');return old.result;}
      await this.refresh();const observation=this.discoveries.find(o=>o.terminalId===data.terminalId);
      ensure(observation,'AGENT','终端当前不可见');
      const unresolved=this.store.state.starts.filter(start=>start.projectId===data.projectId&&start.status==='unknown'&&start.cwd===observation.cwd&&start.type===observation.type&&(!start.target||start.target===observation.terminalId));
      if(unresolved.length===1)await this.write({type:'start.result',id:unresolved[0]!.id,target:observation.terminalId,status:'started',reason:'用户选择当前可见实例，已核对未决启动的目录、类型与目标；尚需接入确认'});
      const b:Binding={id:randomUUID(),projectId:data.projectId,session:this.store.state.settings.session,terminalId:data.terminalId,label:data.label,type:observation.type,cwd:observation.cwd,fingerprint:observation.fingerprint,agentSession:observation.agentSession,mode:'observe',confirmed:false,managed:this.store.state.starts.some(s=>s.target===data.terminalId),paused:true,reason:'观察模式；请核对接入条件',revision:1,observation};
      return (await this.write({type:'binding.create',data:b},data.operation_id,data)).result;
    });
  }
  private isolation(binding:Binding,roots:string[]=[],starting=false){
    ensure(binding.cwd&&canonicalDirectory(binding.cwd)===binding.cwd,'CWD','Agent 工作目录无法核实');
    ensure(!directoriesOverlap(binding.cwd,this.options.dataDir),'ISOLATION','Agent 工作目录不得与服务数据目录重叠');
    for(const root of roots)ensure(!directoriesOverlap(root,this.options.dataDir),'ISOLATION','输出根不得与服务数据目录重叠');
    for(const other of this.store.state.bindings){
      if(other.id===binding.id||(!other.confirmed&&!active(this.store.state,other.id)))continue;
      ensure(!directoriesOverlap(binding.cwd,other.cwd),'ISOLATION',`工作目录与 ${other.label} 重叠`);
      ensure(!binding.agentSession||binding.agentSession!==other.agentSession,'ISOLATION',`Agent 会话与 ${other.label} 相同`);
      for(const root of roots)ensure(!directoriesOverlap(root,other.cwd),'ISOLATION',`输出根与 ${other.label} 工作目录重叠`);
    }
    for(const start of this.store.state.starts.filter(s=>['intent','unknown'].includes(s.status))){
      ensure(!directoriesOverlap(binding.cwd,start.cwd),'START_UNKNOWN','此目录存在未决启动，请先核对');
    }
    for(const attempt of this.store.state.attempts.filter(a=>a.occupies&&a.bindingId!==binding.id)){
      for(const root of attempt.input.roots){
        ensure(!directoriesOverlap(binding.cwd,root.path),'ISOLATION','工作目录与其他执行的输出根重叠');
        for(const output of roots)ensure(!directoriesOverlap(output,root.path),'ISOLATION','输出根与其他执行重叠');
      }
    }
    if(starting)for(const o of this.discoveries)if(o.cwd)ensure(!directoriesOverlap(binding.cwd,o.cwd),'ISOLATION','启动目录与现有 Agent 重叠');
  }
  async bindingAction(id:string,action:Action){
    return this.serial(async()=>{
      const replay=this.replay(action.operation_id,{id,action});if(replay)return replay.result;
      if(['confirm','automatic','resume'].includes(action.action)){
        await this.refresh();const b=this.store.state.bindings.find(b=>b.id===id);ensure(b,'BINDING','Agent 不存在');
        this.isolation({...b,cwd:b.observation?.cwd??b.cwd,agentSession:b.observation?.agentSession??null});
        ensure(!this.controlled(id),'CONTROLLED','请先释放网页终端控制权');
      }
      const response=await this.write({type:'binding.action',id,action},action.operation_id,{id,action});
      if(['pause','manual'].includes(action.action))this.emit('binding-mode',id);
      return response.result;
    });
  }
  async saveTask(data:CreateTask,id?:string,revision?:number){
    return this.serial(async()=>{
      const replay=this.replay(data.operation_id,{id,revision,data});if(replay)return replay.result;
      const b=this.store.state.bindings.find(b=>b.id===data.bindingId);ensure(b,'BINDING','Agent 不存在');
      ensure(!!b.cwd,'CWD','Agent 工作目录尚不能核实');
      ensure(data.outputRoots.every(root=>isAbsolute(root.path)),'ROOT','输出根必须是绝对路径');
      const roots=data.outputRoots.map(root=>({id:root.id,path:canonicalDirectory(root.path)}));
      ensure(roots.every(r=>r.id!=='workdir')&&new Set(roots.map(r=>r.id)).size===roots.length,'ROOT','输出根 ID 重复或占用 workdir');
      for(const [i,root] of roots.entries()){
        ensure(!directoriesOverlap(root.path,this.options.dataDir),'ISOLATION','输出根不得与服务数据目录重叠');
        ensure(!directoriesOverlap(root.path,b.cwd),'ROOT','额外输出根不能与工作目录重叠');
        for(const previous of roots.slice(0,i))ensure(!directoriesOverlap(previous.path,root.path),'ROOT','输出根之间不能重叠');
      }
      const command:Command=id?{type:'task.update',id,data:{...data,outputRoots:roots},revision:revision!}:{type:'task.create',data:{...data,outputRoots:roots}};
      return (await this.write(command,data.operation_id,{id,revision,data})).result;
    });
  }
  async taskAction(id:string,action:Action){
    let interrupt:Attempt|undefined;
    let acceptedGeneration='';const acceptedPort=this.port;
    const result=await this.serial(async()=>{
      const task=this.store.state.tasks.find(t=>t.id===id);ensure(task,'TASK','任务不存在');
      const attempt=current(this.store.state,task);
      let stopVerified=false;
      if(action.action==='record-conclusion'&&attempt&&action.stopped){
        try{await this.refresh();}catch{/* declaration can still be recorded */}
        const o=this.store.state.bindings.find(b=>b.id===attempt.bindingId)?.observation;
        const identity=attempt.identity;
        stopVerified=!!(o&&fresh(o)&&['idle','done'].includes(o.status)&&!o.launchPending&&identity&&o.pid===identity.pid&&o.processStart===identity.processStart&&o.cwd===identity.cwd&&o.agentSession===identity.agentSession&&o.type===identity.type);
        if(!stopVerified&&identity?.pid&&identity.processStart&&this.health.connected){
          const now=processIdentity(identity.pid);
          stopVerified=definitelyGone(identity.pid)||(!!now&&now!==identity.processStart);
        }
      }
      acceptedGeneration=this.store.generation;
      const response=await this.write<Task>({type:'task.action',id,action,stopVerified},action.operation_id,{id,action});
      if(!response.replayed&&action.action==='cancel'&&attempt?.occupies&&!attempt.cancelRequested&&response.result.phase==='cancelling')interrupt=attempt;
      if(action.action==='retry-collection')this.collectionErrors.delete(attempt?.id??'');
      return response.result;
    });
    if(interrupt)void this.interrupt(interrupt,acceptedGeneration,acceptedPort);
    return result;
  }
  private async interrupt(attempt:Attempt,generation:string,port:HerdrPort){
    try{
      ensure(this.store.healthy&&this.store.generation===generation&&port===this.port&&!this.stopped,'STORAGE','中断意图的存储代已失效');
      await this.refresh();const b=this.store.state.bindings.find(b=>b.id===attempt.bindingId);
      ensure(b&&fresh(b.observation)&&b.observation.fingerprint===attempt.fingerprint,'IDENTITY','无法确认中断目标身份');
      ensure(this.store.healthy&&this.store.generation===generation&&port===this.port&&!this.stopped,'STORAGE','中断调用前存储代已失效');
      await port.interrupt(b.terminalId);
      await this.write({type:'note',message:`中断命令已提交，执行 ${attempt.id} 仍等待停止证据`});
    }catch(error){if(this.store.healthy)await this.write({type:'note',message:`执行 ${attempt.id} 的中断结果不确定：${String(error)}`});}
  }
  async settings(data:{operation_id:string;paused:boolean;concurrency:number}){return this.serial(async()=>(await this.write({type:'settings',paused:data.paused,concurrency:data.concurrency},data.operation_id,data)).result);}
  async switchSession(session:string,operationId:string,validateSession?:()=>Promise<void>){
    return this.serial(async()=>{
      const replay=this.replay(operationId,{session});if(replay)return replay.result;
      // A durable receipt remains valid even if discovery later fails. Only a
      // new operation depends on today's selectable sessions.
      await validateSession?.();
      if(session===this.store.state.settings.session)return (await this.write({type:'session',session},operationId,{session})).result;
      const release=await this.options.sessionSwitch?.(session);
      try{
        const response=await this.write({type:'session',session},operationId,{session});
        if(response.replayed){release?.();return response.result;}
        this.emit('invalidate','正在切换会话');this.health.connected=false;this.port.close();
        this.port=this.makePort(session);this.discoveries=[];await this.connect();this.emit('session-switched',release);
        return response.result;
      }catch(error){release?.();throw error;}
    });
  }
  async start(data:{operation_id:string;projectId:string;type:'codex'|'claude';cwd:string;label:string}){
    let freshIntent=false;
    let intentGeneration='';let intentPort=this.port;
    const record=await this.serial(async()=>{
      const previous=this.store.state.operations.find(o=>o.id===data.operation_id);
      if(previous){ensure(previous.digest===digest(data),'OPERATION_CONFLICT','同一操作标识不能用于不同请求');return previous.result as StartRecord;}
      ensure(this.health.connected,'DISCONNECTED','herdr 未连接');
      ensure(this.store.state.projects.some(p=>p.id===data.projectId&&!p.archived),'PROJECT','项目不存在');
      ensure(isAbsolute(data.cwd),'PATH','启动目录必须是绝对路径');
      await mkdir(data.cwd,{recursive:true,mode:0o700});const cwd=canonicalDirectory(data.cwd);
      await this.refresh();
      this.isolation({id:'pending',cwd,agentSession:null} as Binding,[],true);
      const record:StartRecord={id:randomUUID(),projectId:data.projectId,type:data.type,cwd,label:data.label,status:'intent',target:null,reason:'启动意图已保存',createdAt:Date.now()};
      intentGeneration=this.store.generation;intentPort=this.port;
      const response=await this.write<StartRecord>({type:'start',record},data.operation_id,data);freshIntent=!response.replayed;return response.result;
    });
    if(freshIntent)void this.performStart(record,intentGeneration,intentPort);return record;
  }
  private async performStart(record:StartRecord,generation:string,port:HerdrPort){
    if(!this.store.healthy||this.store.generation!==generation||this.stopped||port!==this.port||!this.health.connected)return;
    this.starting.add(record.id);
    try{
      const result=await port.start(record.type,record.cwd);
      if(generation!==this.store.generation||port!==this.port)return;
      await this.write({type:'start.result',id:record.id,target:result.target,status:'started',reason:'启动已确认；请观察就绪并接入'});await this.refresh();
    }catch(error){if(this.store.healthy&&generation===this.store.generation)await this.write({type:'start.result',id:record.id,target:error instanceof HerdrError?error.target??null:null,status:'unknown',reason:`启动结果未知，不自动重试：${String(error)}`});}
    finally{this.starting.delete(record.id);}
  }
  async resolveStart(id:string,data:{operation_id:string;evidence:string;confirmedStopped:true}){
    return this.serial(async()=>{
      const replay=this.replay(data.operation_id,{id,data});if(replay)return replay.result;
      const record=this.store.state.starts.find(start=>start.id===id);ensure(record?.status==='unknown','START','只有结果未知的启动可经人工核对解除');
      ensure(!this.starting.has(id),'START_PENDING','启动调用尚未返回，请先等待本次调用结束');
      ensure(data.confirmedStopped===true&&data.evidence.trim(),'EVIDENCE','必须核对原生窗格与进程，并提供人工核对证据');
      const observations=await this.refresh();
      ensure(observations.every(o=>fresh(o)),'STALE','观测已过期，请重新核对启动');
      ensure(!observations.some(o=>o.terminalId===record.target||o.cwd&&directoriesOverlap(o.cwd,record.cwd)),'START_VISIBLE','原目标或目录仍有 Agent，请观察并接入现有实例；不能解除未决启动');
      return (await this.write({type:'start.resolve',id,evidence:data.evidence},data.operation_id,{id,data})).result;
    });
  }
  async recoverStorage(){
    ensure(!this.store.healthy,'NORMAL_MODE','存储当前可用，无需恢复');
    ensure(!this.reconciling,'RECOVERY','恢复正在执行');this.reconciling=true;
    try{await this.store.recover();await this.collector.reconcile();this.health.storage=true;this.health.error=null;await this.disconnected('存储恢复，需重新确认 Agent');}
    finally{this.reconciling=false;}
  }
  private frozen(task:Task,binding:Binding):FrozenInput{
    return {title:task.title,instructions:task.instructions,requiredArtifacts:task.requiredArtifacts,roots:[{id:'workdir',path:binding.cwd},...task.outputRoots],dependencies:task.dependencies.map(dep=>{
      const parent=this.store.state.tasks.find(t=>t.id===dep.taskId)!;const attempt=current(this.store.state,parent)!;
      const artifacts=this.store.state.artifacts.filter(a=>a.attemptId===attempt.id&&(dep.artifacts.length===0||dep.artifacts.includes(a.id)));
      return {taskId:parent.id,attemptId:attempt.id,summary:attempt.result!.summary,artifacts:artifacts.map(a=>({id:a.id,sha256:a.sha256,file:`${a.archiveId}/${a.file}`}))};
    })};
  }
  private prompt(task:Task,attemptId:string,binding:Binding,input:FrozenInput){
    const result=join(binding.cwd,'.meteor-flow','runs',attemptId,'result.json');
    return `执行以下任务，并遵循交付协议。不要运行其他队列任务。\n任务：${task.title}\n${task.instructions}\n\n冻结输入：${join(binding.cwd,'.meteor-flow','runs',attemptId,'input.json')}\n上游摘要与独立文件副本：\n${JSON.stringify(input.dependencies,null,2)}\n\n授权输出根：${JSON.stringify(input.roots)}\n必要产物（逻辑名称或相对路径）：${JSON.stringify(input.requiredArtifacts)}\n完成后先写同目录临时 JSON，再原子 rename 为 ${result}。严格 JSON，禁止额外字段：\n${JSON.stringify({protocol:'meteor-flow.result/v1',task_id:task.id,attempt_id:attemptId,outcome:'succeeded',summary:'请填写真实完成摘要；失败填写原因并将 outcome 改为 failed',artifacts:[{root_id:'workdir',path:'相对路径（无产物时数组为空）',label:'产物名称'}]},null,2)}\n结束前完成结果文件交付；不要仅在聊天中声称成功。`;
  }
  private async dispatch(task:Task){
    const binding=this.store.state.bindings.find(b=>b.id===task.bindingId)!;const attemptId=randomUUID();
    try{
      this.isolation(binding,task.outputRoots.map(r=>r.path));
      const disk=await statfs(this.options.dataDir);ensure(disk.bavail*disk.bsize>=(this.options.minFreeBytes??1024**3),'DISK','可用磁盘低于派发安全余量');
      const input=await this.collector.prepare(task,binding.cwd,this.frozen(task,binding),attemptId);
      await this.serial(async()=>{
        const latest=this.store.state.tasks.find(t=>t.id===task.id)!;ensure(latest.revision===task.revision,'REVISION','输入准备期间任务已变化');
        ensure(!this.controlled(binding.id),'CONTROLLED','终端已被接管');this.isolation(binding,task.outputRoots.map(r=>r.path));
        await this.write({type:'dispatch',taskId:task.id,id:attemptId,input});
      });
      const generation=this.store.generation;
      try{
        await this.refresh();
        const send=await this.serial(async()=>{
          const a=this.store.state.attempts.find(a=>a.id===attemptId);const b=this.store.state.bindings.find(b=>b.id===binding.id)!;
          ensure(this.store.healthy&&this.store.generation===generation&&a?.occupies&&a.dispatch==='intent'&&!a.cancelRequested&&!this.store.state.settings.paused&&b.mode==='automatic'&&!b.paused&&!this.controlled(b.id)&&ready(b)&&b.fingerprint===a.fingerprint,'NOT_SENT','最终检查已变化，未调用投递');
          this.isolation(b,task.outputRoots.map(r=>r.path));
          // This synchronous call is the local arbitration boundary. Do not await its
          // network response while holding the user-command queue.
          return {response:this.port.prompt(b.terminalId,this.prompt(task,attemptId,b,input)),baseline:b.observation!.sequence};
        });
        try{await send.response;if(this.store.generation===generation)await this.write({type:'dispatch.result',id:attemptId,status:'submitted',reason:'herdr 已确认接收',baselineSeq:send.baseline});}
        catch(error){if(this.store.healthy&&this.store.generation===generation)await this.write({type:'dispatch.result',id:attemptId,status:'unknown',reason:`投递结果未知，不重发：${String(error)}`});}
      }catch(error){if(this.store.healthy&&this.store.generation===generation)await this.write({type:'dispatch.result',id:attemptId,status:'not_sent',reason:`最终检查失败，未投递：${String(error)}`});}
    }catch(error){if(this.store.healthy)await this.write({type:'binding.action',id:binding.id,action:{operation_id:randomUUID(),action:'pause',reason:`派发准备失败：${String(error)}`}});}
  }
  private async scanResults(){
    const attempts=this.store.state.attempts;
    const candidates=[...attempts.filter(a=>a.occupies),...attempts.slice(this.scan,this.scan+4).filter(a=>!a.occupies)];
    this.scan=(this.scan+4)%Math.max(1,attempts.length);
    for(const attempt of candidates){
      if(this.collecting.has(attempt.id)||this.collectionErrors.has(attempt.id))continue;
      const b=this.store.state.bindings.find(b=>b.id===attempt.bindingId);if(!b)continue;
      try{
        await lstat(join(attempt.identity.cwd,'.meteor-flow','runs',attempt.id,'result.json'));
        if(attempt.resultHash){
          const hash=safeRead(attempt.identity.cwd,`.meteor-flow/runs/${attempt.id}/result.json`,limits.result).sha256;
          if(hash!==attempt.resultHash){await this.write({type:'result.conflict',id:attempt.id,hash});this.collectionErrors.add(attempt.id);}continue;
        }
      }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;this.collectionErrors.add(attempt.id);await this.write({type:'collection.error',id:attempt.id,reason:String(error)});continue;}
      if(this.collecting.size>=2)break;
      this.collecting.add(attempt.id);
      void this.collector.collect(attempt,attempt.identity.cwd).catch(async error=>{this.collectionErrors.add(attempt.id);if(this.store.healthy)await this.write({type:'collection.error',id:attempt.id,reason:String(error)});}).finally(()=>this.collecting.delete(attempt.id));
    }
  }
  async tick(){
    if(this.ticking||this.stopped||!this.store.healthy||this.reconciling)return;this.ticking=true;
    try{
      const clock={wall:Date.now(),mono:performance.now()};
      if(Math.abs((clock.wall-this.clock.wall)-(clock.mono-this.clock.mono))>5000||clock.mono-this.clock.mono>10000){await this.disconnected('休眠或时钟跳变，旧观测已失效');this.port.close();}
      this.clock=clock;
      if(!this.health.connected)await this.connect();
      if(this.health.connected)await this.refresh();
      await this.write({type:'check-timeouts',now:Date.now()});
      await this.collector.reapOrphans();
      await this.scanResults();
      if(!this.health.connected)return;
      const next=this.store.state.tasks.find(task=>!waiting(this.store.state,task)&&!this.controlled(task.bindingId));
      if(next)await this.dispatch(next);
    }catch(error){this.health.error=error instanceof Error?error.message:String(error);}
    finally{this.ticking=false;}
  }
  async emergencyInterrupt(bindingId:string){
    ensure(!this.store.healthy,'NORMAL_MODE','存储可用，请使用正常取消或终端控制');
    const port=this.port;const generation=this.store.generation;
    const binding=this.store.state.bindings.find(b=>b.id===bindingId);ensure(binding,'BINDING','Agent 不存在');
    const observed=(await port.listAgents()).find(o=>o.terminalId===binding.terminalId);
    ensure(!this.store.healthy&&!this.stopped&&port===this.port&&generation===this.store.generation,'FAULT_CHANGED','故障状态已经变化，请重新核对后操作');
    ensure(observed&&fresh(observed)&&observed.fingerprint===binding.fingerprint,'IDENTITY','身份无法重新确认，不执行紧急中断');
    await port.interrupt(binding.terminalId);this.health.error='紧急中断已发送，但未持久化；占用尚未释放';
    return {persisted:false,message:this.health.error};
  }
  async close(){this.stopped=true;if(this.timer)clearInterval(this.timer);this.emit('invalidate','服务关闭');this.health.connected=false;this.port.close();await this.collector.close();await this.store.close();}
}
