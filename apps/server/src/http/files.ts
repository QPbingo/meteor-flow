import { fork } from 'node:child_process';
/** Read-only children cannot publish files or mutate the database. The route
 * separately bounds simultaneous requests; completion still waits for exit. */
export function readArtifact(root:string,file:string,hash:string,max:number,signal?:AbortSignal):Promise<{data:Buffer;size:number}>{
  if(signal?.aborted)return Promise.reject(new Error('读取已取消'));
  return new Promise((resolve,reject)=>{
    const child=fork(new URL('./file-child.js',import.meta.url),[],{stdio:['ignore','ignore','ignore','ipc'],serialization:'advanced'});
    let reply:{data?:Buffer;size?:number;error?:string}|undefined;let code:number|null=null;let error:Error|undefined;
    const timer=setTimeout(()=>{error=new Error('归档读取超时');child.kill('SIGKILL');},15000);
    const abort=()=>{error=new Error('读取已取消');child.kill('SIGKILL');};
    signal?.addEventListener('abort',abort,{once:true});
    child.once('spawn',()=>{if(signal?.aborted)abort();else child.send({root,file,hash,max},sendError=>{if(sendError){error=sendError;child.kill('SIGKILL');}});});
    child.on('message',value=>{reply=value as typeof reply;});
    child.once('error',value=>{error=value;child.kill('SIGKILL');});
    child.once('exit',value=>{code=value;});
    child.once('close',()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error||code!==0||!reply?.data||reply.size===undefined)reject(error??new Error(reply?.error??'归档读取进程异常'));else resolve({data:reply.data,size:reply.size});});
  });
}
