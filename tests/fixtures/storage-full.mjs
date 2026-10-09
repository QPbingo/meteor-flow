import { parentPort, workerData } from 'node:worker_threads';
import { Repository } from '../../apps/server/dist/storage/database.js';
const {file,session,generation}=workerData;
const repository=await Repository.open(file,session);
// Limit only this temporary SQLite database; never fill the machine's disk.
const pages=repository.db.pragma('page_count',{simple:true});
repository.db.pragma(`max_page_count=${pages}`);
parentPort.on('message',message=>{
  try{parentPort.postMessage({generation,id:message.id,ok:true,...repository.execute(message.command,message.operation)});}
  catch(error){parentPort.postMessage({generation,id:message.id,fatal:true,error:{message:String(error.code)}});repository.close();parentPort.close();}
});
parentPort.postMessage({generation,ready:true,state:repository.read()});
