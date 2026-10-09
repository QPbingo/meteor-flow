import { join } from 'node:path';
import { mkdirSync, writeFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { safeRead, safeCopy, createRunDirectory } from '@meteor-flow/posix-fs';
import type { FrozenInput } from '@meteor-flow/contracts';
import { limits, parseResult, type Manifest } from './protocol.js';
import { verifyManifest } from './validate.js';

export type CollectionRequest={kind:'collect';jobId:string;generation:string;taskId:string;attemptId:string;cwd:string;staging:string;archiveId:string;cancelRequested:boolean;input:FrozenInput};
export type PreparationRequest={kind:'prepare';jobId:string;generation:string;taskId:string;attemptId:string;cwd:string;staging:string;archiveRoot:string;input:FrozenInput};
export type VerificationRequest={kind:'verify';jobId:string;generation:string;taskId:string;attemptId:string;cwd:string;staging:string;directory:string};
export type ChildRequest=CollectionRequest|PreparationRequest|VerificationRequest;

function durable(path:string,data:string|Buffer){const fd=openSync(path,'wx',0o600);try{writeFileSync(fd,data);fsyncSync(fd);}finally{closeSync(fd);}}
function syncDirectory(path:string){const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
process.on('disconnect',()=>process.exit(2));
const handshake=setTimeout(()=>process.exit(2),10000);
process.once('message',(request:ChildRequest)=>{
  clearTimeout(handshake);
  try {
    if(request.kind==='verify'){
      const manifest=verifyManifest(request.directory);
      if(manifest.taskId!==request.taskId||manifest.attemptId!==request.attemptId)throw new Error('归档复核归属变化');
      process.send?.({ok:true,manifest},()=>process.exit(0));
    }else if(request.kind==='prepare'){
      const directory=createRunDirectory(request.cwd,request.attemptId);
      mkdirSync(join(directory,'inputs'),{mode:0o700});
      let total=0;
      for(const dep of request.input.dependencies)for(const artifact of dep.artifacts){
        const file=`${artifact.id}.bin`;
        const copy=safeCopy(request.archiveRoot,artifact.file,join(directory,'inputs',file),limits.file);
        if(copy.sha256!==artifact.sha256)throw new Error('冻结输入的归档摘要不一致');
        total+=copy.size;if(total>limits.total)throw new Error('输入副本超过总大小限制');
        artifact.file=join(directory,'inputs',file);
      }
      durable(join(directory,'input.json'),JSON.stringify(request.input,null,2));
      syncDirectory(join(directory,'inputs'));syncDirectory(directory);
      process.send?.({ok:true,input:request.input,directory},()=>process.exit(0));
    }else{
      const snapshot=safeRead(request.cwd,`.meteor-flow/runs/${request.attemptId}/result.json`,limits.result);
      const result=parseResult(snapshot.data,request.taskId,request.attemptId);
      const manifest:Manifest={version:1,jobId:request.jobId,generation:request.generation,taskId:request.taskId,attemptId:request.attemptId,archiveId:request.archiveId,cancelRequested:request.cancelRequested,result,resultHash:snapshot.sha256,artifacts:[]};
      let total=0;
      for(const declared of result.artifacts){
        const root=request.input.roots.find(r=>r.id===declared.root_id);
        if(!root)throw new Error(`产物根未授权：${declared.root_id}`);
        const id=randomUUID();const file=`${id}.bin`;
        const copy=safeCopy(root.path,declared.path,join(request.staging,file),limits.file);
        total+=copy.size;if(total>limits.total)throw new Error('产物超过总大小限制');
        manifest.artifacts.push({id,taskId:request.taskId,attemptId:request.attemptId,label:declared.label,rootId:declared.root_id,sourcePath:declared.path,archiveId:request.archiveId,file,sha256:copy.sha256,size:copy.size});
      }
      if(result.outcome==='succeeded'&&request.input.requiredArtifacts.some(name=>!manifest.artifacts.some(a=>a.label===name||a.sourcePath===name)))throw new Error('缺少任务要求的必要产物');
      // Re-read the declaration after all copies: a changed submission is never partially published.
      if(safeRead(request.cwd,`.meteor-flow/runs/${request.attemptId}/result.json`,limits.result).sha256!==snapshot.sha256)throw new Error('采集期间结果声明发生变化');
      durable(join(request.staging,'result.json'),snapshot.data);
      durable(join(request.staging,'manifest.json'),JSON.stringify(manifest));syncDirectory(request.staging);
      process.send?.({ok:true},()=>process.exit(0));
    }
  }catch(error){process.send?.({ok:false,error:error instanceof Error?error.message:String(error)},()=>process.exit(1));}
});
process.send?.({ready:true});
