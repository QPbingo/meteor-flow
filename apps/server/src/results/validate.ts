import { openSync, closeSync, fsyncSync } from 'node:fs';
import { join } from 'node:path';
import { safeRead } from '@meteor-flow/posix-fs';
import { limits, parseResult, type Manifest } from './protocol.js';

/** Blocking filesystem validation runs only inside the supervised child. */
export function verifyManifest(directory:string):Manifest {
  const raw=safeRead(directory,'manifest.json',4*1024*1024);
  const manifest=JSON.parse(raw.data.toString('utf8')) as Manifest;
  if(manifest.version!==1||typeof manifest.cancelRequested!=='boolean'||!Array.isArray(manifest.artifacts)||manifest.artifacts.length>limits.count||!manifest.taskId||!manifest.attemptId)throw new Error('归档 manifest 无效');
  const result=safeRead(directory,'result.json',limits.result);
  const parsed=parseResult(result.data,manifest.taskId,manifest.attemptId);
  if(result.sha256!==manifest.resultHash||JSON.stringify(parsed)!==JSON.stringify(manifest.result)||manifest.artifacts.length!==parsed.artifacts.length)throw new Error('归档声明校验失败');
  let total=0;const ids=new Set<string>();
  for(const [index,artifact] of manifest.artifacts.entries()){
    const declared=parsed.artifacts[index]!;
    if(!/^[a-f0-9-]{36}\.bin$/.test(artifact.file)||ids.has(artifact.id)||artifact.archiveId!==manifest.archiveId||artifact.attemptId!==manifest.attemptId||artifact.taskId!==manifest.taskId||artifact.sourcePath!==declared.path||artifact.rootId!==declared.root_id||artifact.label!==declared.label)throw new Error('归档产物归属校验失败');
    ids.add(artifact.id);
    const file=safeRead(directory,artifact.file,limits.file);
    total+=file.size;if(total>limits.total||file.sha256!==artifact.sha256||file.size!==artifact.size)throw new Error('归档产物摘要校验失败');
    const fd=openSync(join(directory,artifact.file),'r');try{fsyncSync(fd);}finally{closeSync(fd);}
  }
  const fd=openSync(directory,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
  return manifest;
}
