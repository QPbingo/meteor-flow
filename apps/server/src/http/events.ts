import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AgentConsole } from '../application/console.js';

/** Durable event IDs are independent of sockets. Reconnect always announces the
 * resource snapshot to fetch before applying/replaying any event notifications. */
export function attachEvents(console:AgentConsole){
  const clients=new Set<()=>void>();
  const close=()=>{for(const end of clients)end();};
  return Object.assign(close,{attach(request:FastifyRequest,reply:FastifyReply){
    if(clients.size>=32)return reply.code(429).send({error:{code:'BUSY',message:'实时连接已达上限'}});
    reply.hijack();
    for(const [key,value] of Object.entries(reply.getHeaders()))if(value!==undefined)reply.raw.setHeader(key,value);
    reply.raw.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store','connection':'keep-alive','x-accel-buffering':'no'});
    let ended=false;let cursor=0;
    const finish=()=>{if(ended)return;ended=true;clearInterval(timer);console.off('change',changed);console.off('invalidate',invalidated);clients.delete(finish);reply.raw.destroy();};
    const write=(event:string,value:unknown,id?:number)=>{
      if(ended)return;
      if(reply.raw.writableLength>1024*1024){finish();return;}
      reply.raw.write(`${id===undefined?'':`id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify({protocol:'meteor-flow.events/v1',...value as object})}\n\n`);
    };
    const changed=()=>{for(const event of console.store.state.events){if(event.seq<=cursor)continue;write('change',{type:'change',sequence:event.seq,event},event.seq);cursor=event.seq;if(ended)break;}};
    const invalidated=()=>write('snapshot',{type:'snapshot',sequence:cursor,generation:console.generation,url:'/api/v1/state',reason:'连接状态已变化，请校准快照'});
    const timer=setInterval(()=>{if(!ended)write('heartbeat',{type:'heartbeat',sequence:cursor});},15000);
    clients.add(finish);reply.raw.once('close',finish);console.on('change',changed);console.on('invalidate',invalidated);
    const head=console.store.state.events.at(-1)?.seq??0;
    const raw=request.headers['last-event-id'];const last=typeof raw==='string'&&/^\d+$/.test(raw)?Number(raw):NaN;
    const resume=Number.isSafeInteger(last)&&last>=Math.max(0,head-1000)&&last<=head;
    cursor=resume?last:head;
    write('snapshot',{type:'snapshot',sequence:head,generation:console.generation,url:'/api/v1/state',resumeFrom:cursor});
    changed();
    return reply;
  }});
}
