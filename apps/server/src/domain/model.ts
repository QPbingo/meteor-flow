import { createHash, randomUUID } from 'node:crypto';
import type { Action, Artifact, Attempt, Binding, CollectionJob, CreateTask, FrozenInput, Observation, Project, StartRecord, State, Task } from '@meteor-flow/contracts';
import { terminalPhases } from '@meteor-flow/contracts';

export class DomainError extends Error {
  constructor(public code:string, message:string, public status=409) { super(message); }
}
export function ensure(value:unknown, code:string, message:string): asserts value { if (!value) throw new DomainError(code,message); }
export function initialState(session:string):State {
  return { projects:[],bindings:[],tasks:[],attempts:[],artifacts:[],events:[],starts:[],jobs:[],operations:[],settings:{paused:false,concurrency:2,session,revision:1} };
}
export function stable(value:unknown):string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value==='object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export const digest = (value:unknown) => createHash('sha256').update(stable(value)).digest('hex');
export const active = (s:State,bindingId:string) => s.attempts.find(a=>a.bindingId===bindingId&&a.occupies);
export const current = (s:State,t:Task) => s.attempts.find(a=>a.id===t.currentAttemptId);
export function fresh(o:Observation|null,now=Date.now()):o is Observation {return !!o && now-o.observedAt>=0 && now-o.observedAt<5000;}
export function ready(b:Binding,now=Date.now()) { return fresh(b.observation,now) && b.observation.fingerprint===b.fingerprint && !!b.observation.pid && !!b.observation.processStart && ['idle','done'].includes(b.observation.status) && !b.observation.launchPending && (!b.managed||b.observation.interactiveReady); }
export function event(s:State,type:string,message:string,taskId:string|null=null,attemptId:string|null=null) {s.events.push({seq:(s.events.at(-1)?.seq??0)+1,time:Date.now(),type,message,taskId,attemptId});}
function phase(s:State,a:Attempt,value:Attempt['phase'],reason:string) {if(a.phase===value&&a.reason===reason)return;a.phase=value;a.reason=reason;if(value==='needs_confirmation')a.attentionSince??=Date.now();const t=s.tasks.find(t=>t.id===a.taskId)!;if(t.currentAttemptId===a.id){t.phase=value;t.reason=reason;t.revision++;}}
function finish(s:State,a:Attempt,value:'succeeded'|'failed'|'cancelled',reason:string) {phase(s,a,value,reason);a.occupies=false;a.endedAt=Date.now();event(s,'attempt.ended',reason,a.taskId,a.id);}
function pause(s:State,b:Binding,reason:string) {if(b.paused&&b.reason===reason)return;b.paused=true;b.reason=reason;b.revision++;event(s,'agent.paused',reason);}
function canIdentifySession(b:Binding,old:Observation|null,o:Observation,a:Attempt|undefined,observations:Observation[],reservations:ReadonlyArray<{bindingId:string;session:string|null|undefined}>):boolean {
  if(!b.confirmed||b.sessionIdentificationBlocked||!fresh(old)||!fresh(o)||old.fingerprint!==b.fingerprint||old.agentSession!==null||b.agentSession!==null||!o.agentSession)return false;
  if(!old.instanceFingerprint||old.instanceFingerprint!==o.instanceFingerprint||!old.pid||!old.processStart||!old.cwd||o.sequence<old.sequence)return false;
  if(old.terminalId!==o.terminalId||old.type!==o.type||old.pid!==o.pid||old.processStart!==o.processStart||old.cwd!==o.cwd)return false;
  if(a&&(a.fingerprint!==b.fingerprint||a.identity.agentSession!==null||a.identity.pid!==o.pid||a.identity.processStart!==o.processStart||a.identity.cwd!==o.cwd||a.identity.type!==o.type))return false;
  if(observations.some(other=>other.terminalId!==o.terminalId&&other.agentSession===o.agentSession))return false;
  return !reservations.some(other=>other.bindingId!==b.id&&other.session===o.agentSession);
}
export function waiting(s:State,t:Task,now=Date.now()):string|null {
  const b=s.bindings.find(b=>b.id===t.bindingId);
  if(t.archived||t.phase!=='queued')return '任务不在等待队列';
  if(s.projects.find(p=>p.id===t.projectId)?.archived)return '项目已归档';
  if(s.settings.paused)return '全局调度已暂停';
  if(!b||!b.confirmed||b.mode==='observe')return 'Agent 尚未确认接入';
  if(b.mode==='manual')return 'Agent 正在手动使用';
  if(b.paused)return b.reason||'Agent 已暂停';
  if(active(s,b.id))return '等待 Agent 当前执行结束';
  if(!ready(b,now))return '等待新鲜、身份连续且空闲的 Agent';
  for(const d of t.dependencies){const up=s.tasks.find(x=>x.id===d.taskId);const a=up&&current(s,up);if(!a||a.phase!=='succeeded'||!a.result||!a.archiveId)return `等待前置任务：${up?.title??d.taskId}`;if(d.artifacts.some(id=>!s.artifacts.some(x=>x.id===id&&x.attemptId===a.id)))return '前置任务的指定产物不可用';}
  if(s.attempts.filter(a=>a.occupies).length>=s.settings.concurrency)return '等待并行名额';
  return null;
}
function validateTask(s:State,data:CreateTask,id?:string) {
  const p=s.projects.find(p=>p.id===data.projectId);ensure(p&&!p.archived,'PROJECT','项目不存在或已归档');
  const b=s.bindings.find(b=>b.id===data.bindingId);ensure(b&&b.projectId===data.projectId,'BINDING','请选择本项目的 Agent');
  ensure(new Set(data.dependencies.map(d=>d.taskId)).size===data.dependencies.length,'DEPENDENCY','前置任务不能重复');
  for(const d of data.dependencies){ensure(d.taskId!==id,'CYCLE','任务不能依赖自身');const up=s.tasks.find(t=>t.id===d.taskId);ensure(up&&up.projectId===data.projectId,'DEPENDENCY','依赖必须属于同一项目');for(const artifact of d.artifacts)ensure(s.artifacts.some(a=>a.id===artifact&&a.taskId===d.taskId),'ARTIFACT','依赖产物不属于所选任务');}
  if(id){const seen=new Set<string>();const visit=(key:string):void=>{ensure(key!==id,'CYCLE','依赖会形成循环');if(seen.has(key))return;seen.add(key);s.tasks.find(t=>t.id===key)?.dependencies.forEach(d=>visit(d.taskId));};data.dependencies.forEach(d=>visit(d.taskId));}
}
export type Command =
 | {type:'project.create'; data:{name:string;root:string}}
 | {type:'project.archive'; id:string}
 | {type:'binding.create'; data:Binding}
 | {type:'binding.action'; id:string; action:Action}
 | {type:'task.create'; data:CreateTask}
 | {type:'task.update'; id:string; data:CreateTask; revision:number}
 | {type:'task.action'; id:string; action:Action; stopVerified?:boolean}
 | {type:'settings'; paused:boolean; concurrency:number}
 | {type:'session'; session:string}
 | {type:'observe'; observations:Observation[]}
 | {type:'disconnect'; reason:string}
 | {type:'recover'}
 | {type:'check-timeouts';now:number}
 | {type:'dispatch'; taskId:string; id:string; input:FrozenInput}
 | {type:'dispatch.result'; id:string; status:'submitted'|'unknown'|'not_sent'; reason:string; baselineSeq?:number}
 | {type:'result'; id:string; result:Attempt['result']; hash:string; archiveId:string; artifacts:Artifact[]}
 | {type:'result.conflict'; id:string; hash:string}
 | {type:'collection.error'; id:string; reason:string}
 | {type:'start'; record:StartRecord}
 | {type:'start.result'; id:string; target:string|null; reason:string; status:'started'|'unknown'}
 | {type:'start.resolve'; id:string; evidence:string}
 | {type:'note'; message:string}
 | {type:'job'; job:CollectionJob};
export function reduce(s:State,c:Command):unknown {
  switch(c.type){
    case 'project.create':{const p:Project={id:randomUUID(),...c.data,archived:false,createdAt:Date.now()};s.projects.push(p);event(s,c.type,`创建项目 ${p.name}`);return p;}
    case 'project.archive':{const p=s.projects.find(p=>p.id===c.id);ensure(p,'PROJECT','项目不存在');p.archived=true;event(s,c.type,`归档项目 ${p.name}`);return p;}
    case 'binding.create':{ensure(!s.bindings.some(b=>b.terminalId===c.data.terminalId&&b.session===c.data.session),'BOUND','该终端已接入');ensure(s.projects.some(p=>p.id===c.data.projectId&&!p.archived),'PROJECT','项目不存在或已归档');s.bindings.push(c.data);event(s,c.type,`接入 ${c.data.label}，当前只观察`);return c.data;}
    case 'binding.action':{const b=s.bindings.find(b=>b.id===c.id);ensure(b,'BINDING','Agent 不存在');if(c.action.expected_revision!==undefined)ensure(b.revision===c.action.expected_revision,'REVISION','Agent 已变化，请刷新后重试');
      switch(c.action.action){
        case 'confirm':ensure(!active(s,b.id)&&b.session===s.settings.session,'NOT_READY','仍有占用或绑定不属于当前会话');ensure(b.observation,'NOT_READY','Agent 当前不可见');b.fingerprint=b.observation.fingerprint;b.cwd=b.observation.cwd;b.agentSession=b.observation.agentSession;b.type=b.observation.type;ensure(ready(b)&&['codex','claude'].includes(b.type),'NOT_READY','请先确认 Agent 空闲、身份连续且连接新鲜');ensure(!!c.action.evidence,'EVIDENCE','请确认独立目录、独立会话、无未完成工作及结果交付能力');b.confirmed=true;b.sessionIdentificationBlocked=false;b.mode='manual';b.paused=true;b.reason='已确认接入，请启用自动调度';break;
        case 'automatic':case 'resume':ensure(b.confirmed&&ready(b),'NOT_READY','Agent 尚未完成接入或当前不可安全恢复');ensure(!active(s,b.id),'OCCUPIED','当前执行仍占用 Agent');b.mode='automatic';b.paused=false;b.reason='';break;
        case 'manual':b.mode='manual';b.paused=true;b.reason='手动使用';break;
        case 'pause':b.paused=true;b.reason=c.action.reason??'用户暂停';break;
        default:throw new DomainError('ACTION','该操作不适用于 Agent');
      }b.revision++;event(s,c.type,`${b.label}：${b.reason||'自动调度'}`);return b;}
    case 'task.create':{validateTask(s,c.data);const {operation_id:_,...data}=c.data;const t:Task={...data,id:randomUUID(),revision:1,createdAt:Date.now(),order:(s.tasks.at(-1)?.order??0)+1,archived:false,currentAttemptId:null,phase:'queued',reason:''};s.tasks.push(t);event(s,c.type,`创建任务 ${t.title}`,t.id);return t;}
    case 'task.update':{const t=s.tasks.find(t=>t.id===c.id);ensure(t,'TASK','任务不存在');ensure(!t.currentAttemptId&&t.phase==='queued','FROZEN','任务已开始；请复制为新任务');ensure(t.revision===c.revision,'REVISION','任务已变化，请刷新后重试');validateTask(s,c.data,t.id);const {operation_id:_,...data}=c.data;Object.assign(t,data,{revision:t.revision+1});event(s,c.type,'更新待派发任务',t.id);return t;}
    case 'task.action':{const t=s.tasks.find(t=>t.id===c.id);ensure(t,'TASK','任务不存在');const a=current(s,t);if(c.action.expected_revision!==undefined)ensure(t.revision===c.action.expected_revision,'REVISION','任务已变化，请刷新');
      switch(c.action.action){
        case 'copy':return reduce(s,{type:'task.create',data:{...t,title:`${t.title}（副本）`,operation_id:randomUUID()}});
        case 'archive':ensure(!a?.occupies&&t.phase!=='queued','OCCUPIED','待执行或活动任务请先取消');t.archived=true;break;
        case 'retry':ensure(!t.archived,'ARCHIVED','已归档任务不能重试，请复制为新任务');ensure(['failed','cancelled'].includes(t.phase)&&!a?.occupies,'OCCUPIED','仅已停止的失败或取消任务可以重试');t.phase='queued';t.reason='在当前文件状态上重试';break;
        case 'cancel':if(terminalPhases.includes(t.phase))return t;if(!a||t.phase==='queued'){t.phase='cancelled';t.reason='派发前取消';}else if(!a.cancelRequested){a.cancelRequested=true;a.cancelAcceptedAt=Date.now();phase(s,a,'cancelling','已接受取消，等待停止证据');}break;
        case 'retry-collection':ensure(a&&a.occupies&&!a.cancelRequested&&!a.resultConflict,'COLLECTION','当前执行不能重试采集；结果冲突请核对归档后人工补录');phase(s,a,'collecting','用户重试结果采集');break;
        case 'record-conclusion':{ensure(a&&a.occupies,'ATTEMPT','没有待处理执行');ensure(c.action.reason&&c.action.evidence&&c.action.outcome,'EVIDENCE','补录需要结论、原因和证据');a.manualEvidence=`${c.action.outcome}\n${c.action.reason}\n${c.action.evidence}`;a.source='manual';if(!c.action.stopped||!c.stopVerified){phase(s,a,'needs_confirmation','已记录人工声明；停止证据不足，继续保留占用');break;}if(c.action.outcome==='succeeded')ensure(a.result&&a.archiveId&&a.input.requiredArtifacts.every(name=>s.artifacts.some(x=>x.attemptId===a.id&&(x.label===name||x.sourcePath===name))),'RESULT_REQUIRED','人工成功仍需要有效结果及必要产物');finish(s,a,a.cancelRequested?'cancelled':c.action.outcome,`人工结论：${c.action.reason}`);break;}
        default:throw new DomainError('ACTION','该操作不适用于任务');
      }t.revision++;event(s,c.type,c.action.reason??c.action.action,t.id,a?.id??null);return t;}
    case 'settings':s.settings={...s.settings,paused:c.paused,concurrency:c.concurrency,revision:s.settings.revision+1};event(s,c.type,c.paused?'全局暂停':'全局调度开启');return s.settings;
    case 'session':ensure(!s.attempts.some(a=>a.occupies)&&!s.starts.some(r=>['intent','unknown'].includes(r.status)),'OCCUPIED','活动执行或未决启动阻止切换会话');s.settings.session=c.session;for(const b of s.bindings){b.confirmed=false;b.mode='observe';b.paused=true;b.observation=null;b.sessionIdentificationBlocked=true;b.reason='会话已切换，需重新确认归属';}event(s,c.type,'切换会话；旧授权已撤销');return s.settings;
    case 'observe':{
      // Reserve identities at the start of the batch: revoking an earlier binding
      // must not make its session adoptable by a later binding in the same batch.
      const reservations=s.bindings.filter(b=>b.confirmed||active(s,b.id)).flatMap(b=>[{bindingId:b.id,session:b.agentSession},{bindingId:b.id,session:b.observation?.agentSession}]);
      reservations.push(...s.attempts.filter(a=>a.occupies).map(a=>({bindingId:a.bindingId,session:a.identity.agentSession})));
      for(const b of s.bindings){if(b.session!==s.settings.session)continue;const o=c.observations.find(o=>o.terminalId===b.terminalId);const a=active(s,b.id);if(!o){b.observation=null;b.sessionIdentificationBlocked=true;pause(s,b,'终端不可见，请核对实例');if(a)phase(s,a,'needs_confirmation','缺少执行身份与停止证据');continue;}
      const old=b.observation;b.observation=o;
      if(!fresh(old)||!fresh(o))b.sessionIdentificationBlocked=true;
      if(o.fingerprint!==b.fingerprint&&canIdentifySession(b,old,o,a,c.observations,reservations)){
        b.fingerprint=o.fingerprint;b.agentSession=o.agentSession;b.revision++;
        if(a){a.fingerprint=o.fingerprint;a.identity={...a.identity,agentSession:o.agentSession};}
        event(s,'agent.session-identified',`${b.label}：进程及连接身份连续，补全首次会话标识；保留原授权与模式`,a?.taskId??null,a?.id??null);
      }
      if(o.fingerprint!==b.fingerprint){b.confirmed=false;b.mode='observe';pause(s,b,'Agent 身份已变化，需重新接入确认');if(a)phase(s,a,'needs_confirmation','执行身份已变化');continue;}
      if(old?.status!==o.status)event(s,'agent.observed',`${b.label}：${o.status}`,a?.taskId??null,a?.id??null);
      if(a){if(a.resultConflict&&!a.cancelRequested){phase(s,a,'needs_confirmation','结果声明发生冲突，请核对归档并人工补录');continue;}if(a.dispatch==='submitted'&&o.sequence>a.baselineSeq&&['working','blocked'].includes(o.status)){a.seenActivity=true;if(!a.cancelRequested)phase(s,a,'running',o.status==='blocked'?'Agent 等待人工处理':'执行中');}
        if(o.status==='blocked')a.attentionSince??=Date.now();else if(a.phase==='running')a.attentionSince=null;
        if(a.cancelRequested){if(a.seenActivity&&ready(b))finish(s,a,'cancelled','取消后已观察到执行停止');}
        else if(a.result&&a.archiveId&&a.seenActivity&&ready(b))finish(s,a,a.result.outcome,a.result.summary);
        else if(a.dispatch==='submitted'&&ready(b)&&(a.seenActivity||Date.now()-(a.submittedAt??Date.now())>30000)){phase(s,a,'needs_confirmation',a.result?'结果已收到，执行结束证据不足':'Agent 空闲但缺少有效结果');pause(s,b,'任务需要人工核对');}
      }
    }return null;}
    case 'disconnect':for(const b of s.bindings){b.observation=null;b.sessionIdentificationBlocked=true;pause(s,b,c.reason);const a=active(s,b.id);if(a)phase(s,a,'needs_confirmation','连接中断，执行事实待核对');}return null;
    case 'check-timeouts':for(const a of s.attempts.filter(a=>a.occupies)){
      if(a.cancelRequested&&a.phase==='cancelling'&&a.cancelAcceptedAt!==null&&c.now-a.cancelAcceptedAt>=15000){phase(s,a,'needs_confirmation','中断后 15 秒仍缺少停止证据；继续保留占用');pause(s,s.bindings.find(b=>b.id===a.bindingId)!,'取消需要人工核对');}
      if(a.attentionSince!==null&&c.now-a.attentionSince>=30*60*1000&&(a.remindedAt===null||c.now-a.remindedAt>=30*60*1000)){a.remindedAt=c.now;event(s,'attention.reminder','已等待人工处理 30 分钟；不会自动批准或解除占用',a.taskId,a.id);}
    }return null;
    case 'recover':for(const b of s.bindings){b.observation=null;b.sessionIdentificationBlocked=true;b.confirmed=false;b.mode='observe';b.paused=true;b.reason='服务重启，请重新核对身份与执行';}for(const a of s.attempts.filter(a=>a.occupies)){if(a.dispatch==='intent')a.dispatch='unknown';a.seenActivity=false;phase(s,a,'needs_confirmation','服务重启，不自动重放命令');}for(const j of s.jobs.filter(j=>['intent','running'].includes(j.status)))j.status='orphaned';for(const start of s.starts.filter(r=>r.status==='intent')){start.status='unknown';start.reason='启动时服务中断，请核对已存在实例';}event(s,c.type,'启动恢复：观测缺口与旧控制权已失效');return null;
    case 'dispatch':{const t=s.tasks.find(t=>t.id===c.taskId);ensure(t,'TASK','任务不存在');const reason=waiting(s,t);ensure(!reason,'WAITING',reason??'暂不可派发');const b=s.bindings.find(b=>b.id===t.bindingId)!;const a:Attempt={id:c.id,taskId:t.id,bindingId:b.id,number:s.attempts.filter(a=>a.taskId===t.id).length+1,phase:'dispatching',reason:'投递意图已持久化',occupies:true,createdAt:Date.now(),submittedAt:null,endedAt:null,fingerprint:b.fingerprint,identity:{pid:b.observation!.pid,processStart:b.observation!.processStart,cwd:b.observation!.cwd,agentSession:b.observation!.agentSession,type:b.observation!.type},baselineSeq:b.observation!.sequence,seenActivity:false,dispatch:'intent',cancelRequested:false,cancelAcceptedAt:null,attentionSince:null,remindedAt:null,input:c.input,result:null,resultHash:null,archiveId:null,source:'agent',manualEvidence:null};s.attempts.push(a);t.currentAttemptId=a.id;t.phase=a.phase;t.revision++;event(s,c.type,a.reason,t.id,a.id);return a;}
    case 'dispatch.result':{const a=s.attempts.find(a=>a.id===c.id);ensure(a&&a.occupies,'ATTEMPT','执行已失效');a.dispatch=c.status;if(c.baselineSeq!==undefined)a.baselineSeq=c.baselineSeq;if(c.status==='submitted'){a.submittedAt=Date.now();if(!a.cancelRequested)phase(s,a,'dispatching','输入已提交，等待本次活动');}else{phase(s,a,'needs_confirmation',c.reason);pause(s,s.bindings.find(b=>b.id===a.bindingId)!,c.reason);}event(s,c.type,c.reason,a.taskId,a.id);return a;}
    case 'result':{const a=s.attempts.find(a=>a.id===c.id);ensure(a,'ATTEMPT','执行不存在');if(a.resultHash){ensure(a.resultHash===c.hash,'RESULT_CONFLICT','同一次执行提交了冲突结果');return a;}a.result=c.result;a.resultHash=c.hash;a.archiveId=c.archiveId;s.artifacts.push(...c.artifacts);event(s,c.type,a.cancelRequested||!a.occupies?'保留迟到结果':'结果及归档已保存，等待结束证据',a.taskId,a.id);if(a.occupies&&!a.cancelRequested){const b=s.bindings.find(b=>b.id===a.bindingId)!;if(a.seenActivity&&ready(b)&&b.fingerprint===a.fingerprint)finish(s,a,c.result!.outcome,c.result!.summary);else phase(s,a,'collecting','结果已收到，等待本次执行结束');}return a;}
    case 'result.conflict':{const a=s.attempts.find(a=>a.id===c.id);ensure(a&&a.resultHash,'ATTEMPT','尚无已归档结果');if(a.resultConflict)return a;a.resultConflict=c.hash;event(s,c.type,`结果冲突：已归档 ${a.resultHash}，后续声明 ${c.hash}；保留原归档与已发布终态`,a.taskId,a.id);pause(s,s.bindings.find(b=>b.id===a.bindingId)!,'结果声明发生冲突，请核对归档');if(a.occupies&&!a.cancelRequested)phase(s,a,'needs_confirmation','结果声明发生冲突，请核对归档并人工补录');return a;}
    case 'collection.error':{const a=s.attempts.find(a=>a.id===c.id);if(a&&a.occupies&&!a.cancelRequested){phase(s,a,'needs_confirmation',`收集异常：${c.reason}`);pause(s,s.bindings.find(b=>b.id===a.bindingId)!,'结果采集需要处理');}return a;}
    case 'start':s.starts.push(c.record);event(s,c.type,`准备启动 ${c.record.type}`);return c.record;
    case 'start.result':{const start=s.starts.find(r=>r.id===c.id);ensure(start,'START','启动记录不存在');start.target=c.target;start.status=c.status;start.reason=c.reason;event(s,c.type,c.reason);return start;}
    case 'start.resolve':{const start=s.starts.find(r=>r.id===c.id);ensure(start?.status==='unknown','START','启动当前不处于待核对状态');ensure(c.evidence.trim(),'EVIDENCE','缺少人工核对证据');start.status='dismissed';start.resolution={source:'manual',evidence:c.evidence,at:Date.now()};start.reason=`人工核对后解除未决启动，不代表服务端证明停止：${c.evidence}`;event(s,c.type,`${start.label}：${start.reason}`);return start;}
    case 'note':event(s,c.type,c.message);return null;
    case 'job':{const index=s.jobs.findIndex(j=>j.id===c.job.id);if(index>=0)s.jobs[index]=c.job;else s.jobs.push(c.job);return c.job;}
  }
}
