import { parentPort, workerData } from 'node:worker_threads';
import { Repository } from './database.js';
import { DomainError, type Command } from '../domain/model.js';

const {file,session,generation}=workerData as {file:string;session:string;generation:string};
const port=parentPort!;
try {
  const repository=await Repository.open(file,session);
  port.on('message',(message:{generation:string;id:string;command:Command;operation?:{id:string;digest:string}})=>{
    if(message.generation!==generation)return;
    try {
      // Only transfer committed changes. Cloning all historical rows for every
      // observation otherwise grows the main isolate's heap under terminal load.
      const {state:_,...value}=repository.execute(message.command,message.operation);
      port.postMessage({generation,id:message.id,ok:true,...value});
    }catch(error){
      const domain=error instanceof DomainError;
      port.postMessage({generation,id:message.id,ok:false,fatal:!domain,error:{code:domain?error.code:'STORAGE',message:error instanceof Error?error.message:String(error),status:domain?error.status:503}});
      if(!domain){repository.close();port.close();}
    }
  });
  port.postMessage({generation,ready:true,state:repository.read()});
}catch(error){
  port.postMessage({generation,fatal:true,error:{message:error instanceof Error?error.message:String(error)}});
  port.close();
}
