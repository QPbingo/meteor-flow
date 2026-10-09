import { mkdtemp, mkdir, readFile, rm, realpath, chmod, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { afterEach, beforeEach, expect, it } from 'vitest';
import WebSocket from 'ws';
import { AgentConsole } from '../../dist/application/console.js';
import { createServer } from '../../dist/http/server.js';
import { FakeHerdr } from '../../../../tests/fixtures/fake-herdr.js';
import type { Binding, Project } from '@meteor-flow/contracts';

let temp:string;let service:AgentConsole;let http:Awaited<ReturnType<typeof createServer>>;
let fake:FakeHerdr;let cookie:string;let csrf:string;let binding:Binding;let log:string;
let discoverSessions:()=>Promise<Array<{name:string;socketPath:string}>>;
const sockets:WebSocket[]=[];
const op=()=>randomUUID();
beforeEach(async()=>{
  temp=await realpath(await mkdtemp(join(tmpdir(),'meteor-http-')));
  const cwd=join(temp,'work');const dataDir=join(temp,'data');await mkdir(cwd);await mkdir(dataDir);
  fake=new FakeHerdr({agents:[{terminalId:'terminal-1',cwd}]});
  const executable=resolve('tests/fixtures/terminal-cli.mjs');await chmod(executable,0o700);
  log=join(temp,'terminal.log');await writeFile(log,'');process.env.METEOR_TEST_TERMINAL_LOG=log;
  service=new AgentConsole({dataDir,session:fake.session,executable,portFactory:()=>fake,pollMs:1000000});
  discoverSessions=async()=>[{name:fake.session,socketPath:join(temp,'unused.sock')}];
  await service.open();http=await createServer(service,{port:0,listSessions:()=>discoverSessions()});
  const entry=JSON.parse(await readFile(join(dataDir,'open.json'),'utf8'));
  const token=new URLSearchParams(new URL(entry.url).hash.slice(1)).get('token');
  const response=await fetch(`${http.address}/api/bootstrap`,{method:'POST',headers:{origin:http.address,'content-type':'application/json'},body:JSON.stringify({token})});
  expect(response.status).toBe(200);cookie=response.headers.get('set-cookie')!.split(';')[0]!;csrf=(await response.json() as {csrf:string}).csrf;
  const p=await service.createProject({operation_id:op(),name:'隔离 HTTP 项目',root:cwd}) as Project;
  binding=await service.attach({operation_id:op(),projectId:p.id,terminalId:'terminal-1',label:'测试 Agent'}) as Binding;
});
afterEach(async()=>{
  for(const socket of sockets.splice(0))socket.terminate();
  await http?.app.close();await service?.close();delete process.env.METEOR_TEST_TERMINAL_LOG;
  if(temp)await rm(temp,{recursive:true,force:true});
});
function headers(extra:Record<string,string>={}){return {cookie,origin:http.address,'content-type':'application/json','x-csrf-token':csrf,...extra};}
async function connect(){
  const socket=new WebSocket(`${http.address.replace('http:','ws:')}/api/terminal/${binding.id}?csrf=${csrf}`,{headers:headers()});
  const frames:any[]=[];socket.on('message',bytes=>frames.push(JSON.parse(bytes.toString())));sockets.push(socket);await once(socket,'open');
  return {socket,frames};
}
function send(socket:WebSocket,body:Record<string,unknown>){socket.send(JSON.stringify({protocol:'meteor-flow.terminal/v1',...body}));}
async function commands(){return(await readFile(log,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}

it('requires a cookie for reads, rejects external Origin/Host, and enforces JSON/CSRF for writes',async()=>{
  expect((await fetch(`${http.address}/api/state`)).status).toBe(401);
  expect((await fetch(`${http.address}/api/state`,{headers:headers({origin:'https://outside.invalid'})})).status).toBe(403);
  const host=await http.app.inject({method:'GET',url:'/api/state',headers:{host:'outside.invalid',cookie}});expect(host.statusCode).toBe(403);
  const mutation={operation_id:op(),paused:true,concurrency:2};
  expect((await fetch(`${http.address}/api/settings`,{method:'POST',headers:headers({'x-csrf-token':'wrong'}),body:JSON.stringify(mutation)})).status).toBe(403);
  expect((await fetch(`${http.address}/api/settings`,{method:'POST',headers:{cookie,origin:http.address,'x-csrf-token':csrf,'content-type':'text/plain'},body:JSON.stringify(mutation)})).status).toBe(400);
  expect(service.store.state.settings.paused).toBe(false);
});
it('rotates the single-use entry, protects the cookie, and persists an operation exactly once',async()=>{
  const entryFile=join(service.options.dataDir,'open.json');const entry=JSON.parse(await readFile(entryFile,'utf8'));const token=new URLSearchParams(new URL(entry.url).hash.slice(1)).get('token');
  const exchange=()=>fetch(`${http.address}/api/bootstrap`,{method:'POST',headers:{origin:http.address,'content-type':'application/json'},body:JSON.stringify({token})});
  const first=await exchange();expect(first.status).toBe(200);expect(first.headers.get('set-cookie')).toContain('HttpOnly');expect(first.headers.get('set-cookie')).toContain('SameSite=Strict');
  expect((await exchange()).status).toBe(401);
  expect(JSON.parse(await readFile(entryFile,'utf8')).url).not.toBe(entry.url);
  const payload={operation_id:op(),name:'重复请求项目',root:binding.cwd};
  const create=()=>fetch(`${http.address}/api/projects`,{method:'POST',headers:headers(),body:JSON.stringify(payload)});
  const responses=await Promise.all([create(),create()]);expect(responses.map(r=>r.status)).toEqual([200,200]);
  const projects=await Promise.all(responses.map(r=>r.json()));expect(projects[0]).toEqual(projects[1]);expect(service.store.state.projects.filter(p=>p.name===payload.name)).toHaveLength(1);
});
it('rejects cross-site and unauthenticated WebSocket upgrades before starting a CLI',async()=>{
  for(const h of [{origin:'https://outside.invalid',cookie},{origin:http.address}]){
    const response=await new Promise<number>((resolve,reject)=>{
      const socket=new WebSocket(`${http.address.replace('http:','ws:')}/api/terminal/${binding.id}?csrf=${csrf}`,{headers:h});
      socket.once('unexpected-response',(_request,response)=>{resolve(response.statusCode!);response.resume();socket.terminate();});socket.on('error',()=>{});socket.once('open',()=>{socket.close();reject(new Error('Unexpected accepted socket'));});
    });expect([401,403]).toContain(response);
  }
  expect(await commands()).toEqual([]);
});
it('keeps observers read-only, gives every page a redraw, and arbitrates two controllers with revocation',async()=>{
  const one=await connect();await expect.poll(()=>one.frames.some(f=>f.type==='output')).toBe(true);
  const two=await connect();await expect.poll(()=>two.frames.some(f=>f.type==='output')).toBe(true);
  send(one.socket,{action:'input',text:'UNAUTHORIZED',token:'old',epoch:1});
  await expect.poll(()=>one.frames.some(f=>f.type==='error')).toBe(true);
  expect((await commands()).some(c=>c.kind==='input')).toBe(false);
  send(one.socket,{action:'take'});send(two.socket,{action:'take'});
  await expect.poll(()=>[...one.frames,...two.frames].filter(f=>f.type==='state'&&f.mode==='control').length).toBe(1);
  const owner=one.frames.some(f=>f.type==='state'&&f.mode==='control')?one:two;const other=owner===one?two:one;
  const lease=owner.frames.find(f=>f.type==='state'&&f.mode==='control');
  expect(service.store.state.bindings[0]!.mode).toBe('manual');expect(service.store.state.bindings[0]!.paused).toBe(true);
  send(owner.socket,{action:'input',text:'USER-INPUT',token:lease.token,epoch:lease.epoch});
  await expect.poll(async()=>(await commands()).filter(c=>c.kind==='input'&&c.frame.text==='USER-INPUT').length).toBe(1);
  send(other.socket,{action:'input',text:'STOLEN',token:lease.token,epoch:lease.epoch});
  send(owner.socket,{action:'release',token:lease.token,epoch:lease.epoch});
  await expect.poll(()=>owner.frames.filter(f=>f.type==='state'&&f.mode==='observe').length).toBe(2);
  send(owner.socket,{action:'input',text:'LATE',token:lease.token,epoch:lease.epoch});
  await expect.poll(()=>owner.frames.filter(f=>f.type==='error').length).toBeGreaterThan(0);
  expect((await commands()).filter(c=>c.kind==='input'&&['LATE','STOLEN'].includes(c.frame.text))).toEqual([]);
  expect(service.store.state.bindings[0]!.paused).toBe(true);expect(fake.prompts).toHaveLength(0);
});
it('closes a controller on disconnect without resuming dispatch, while observer closure has no scheduling side effect',async()=>{
  const first=await connect();first.socket.close();await once(first.socket,'close');expect(service.store.state.bindings[0]!.mode).toBe('observe');
  const owner=await connect();send(owner.socket,{action:'take'});await expect.poll(()=>owner.frames.some(f=>f.mode==='control')).toBe(true);
  owner.socket.close();await once(owner.socket,'close');
  await expect.poll(()=>service.controlled(binding.id)).toBe(false);expect(service.store.state.bindings[0]!.paused).toBe(true);
});

it('rejects authenticated terminal upgrades with missing or null Origin',async()=>{
  for(const origin of [undefined,'null']){
    const response=await new Promise<number>((resolve,reject)=>{
      const socket=new WebSocket(`${http.address.replace('http:','ws:')}/api/v1/terminals/${binding.id}?csrf=${csrf}`,{headers:{cookie,...(origin?{origin}:{})}});
      socket.once('unexpected-response',(_request,response)=>{resolve(response.statusCode!);response.resume();socket.terminate();});socket.on('error',()=>{});socket.once('open',()=>{socket.close();reject(new Error('Unexpected accepted socket'));});
    });expect(response).toBe(403);
  }
  expect(await commands()).toEqual([]);
});

it('provides versioned resources, an operation receipt and an actionable directory error',async()=>{
  const invalid=await fetch(`${http.address}/api/v1/projects`,{method:'POST',headers:headers(),body:JSON.stringify({operation_id:op(),name:'不存在目录',root:join(temp,'missing')})});
  expect(invalid.status).toBe(400);expect(await invalid.json()).toMatchObject({error:{code:'PROJECT_DIRECTORY',message:expect.stringContaining('不存在')}});
  for(const path of ['/system','/projects','/agents','/state'])expect((await fetch(`${http.address}/api/v1${path}`,{headers:headers()})).status).toBe(200);
  const operation_id=op();const response=await fetch(`${http.address}/api/v1/settings`,{method:'POST',headers:headers(),body:JSON.stringify({operation_id,paused:true,concurrency:2})});expect(response.status).toBe(200);
  expect(await(await fetch(`${http.address}/api/v1/operations/${operation_id}`,{headers:headers()})).json()).toMatchObject({id:operation_id,result:{paused:true}});
  expect((await fetch(`${http.address}/api/v1/attempts/missing/inputs`,{headers:headers()})).status).toBe(404);
  expect((await fetch(`${http.address}/api/v1/session`,{method:'POST',headers:headers(),body:JSON.stringify({operation_id:op(),session:'not-enumerated'})})).status).toBe(400);
  expect(service.store.state.settings.session).toBe(fake.session);
});

it('replays an accepted session receipt despite discovery failure or disappearance and rejects changed payloads',async()=>{
  const operation_id=op();const payload={operation_id,session:fake.session};
  const submit=(body=payload)=>fetch(`${http.address}/api/v1/session`,{method:'POST',headers:headers(),body:JSON.stringify(body)});
  const first=await submit();expect(first.status).toBe(200);const receipt=await first.json();
  const eventCount=service.store.state.events.length;
  for(const discover of [async()=>{throw new Error('session discovery unavailable');},async()=>[]]){
    discoverSessions=discover;
    const repeated=await submit();expect(repeated.status).toBe(200);expect(await repeated.json()).toEqual(receipt);
    const changed=await submit({...payload,session:'changed'});expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({error:{code:'OPERATION_CONFLICT'}});
  }
  expect(service.store.state.events).toHaveLength(eventCount);
  expect(service.store.state.operations.filter(row=>row.id===operation_id)).toHaveLength(1);
  const unseen=await submit({...payload,operation_id:op()});expect(unseen.status).toBe(400);
});

it('replays a created project after its directory moves without duplicating records or revalidating an accepted operation',async()=>{
  const root=join(temp,'moved-project');await mkdir(root);
  const payload={operation_id:op(),name:'移动后的项目',root};
  const submit=(body=payload)=>fetch(`${http.address}/api/v1/projects`,{method:'POST',headers:headers(),body:JSON.stringify(body)});
  const first=await submit();expect(first.status).toBe(200);const receipt=await first.json();
  const eventCount=service.store.state.events.length;
  await rename(root,join(temp,'new-project-location'));
  const repeated=await Promise.all([submit(),submit()]);
  expect(repeated.map(response=>response.status)).toEqual([200,200]);
  expect(await Promise.all(repeated.map(response=>response.json()))).toEqual([receipt,receipt]);
  const changed=await submit({...payload,name:'不同请求'});expect(changed.status).toBe(409);
  expect(await changed.json()).toMatchObject({error:{code:'OPERATION_CONFLICT'}});
  const unseen=await submit({...payload,operation_id:op()});expect(unseen.status).toBe(400);
  expect(await unseen.json()).toMatchObject({error:{code:'PROJECT_DIRECTORY'}});
  expect(service.store.state.events).toHaveLength(eventCount);
  expect(service.store.state.operations.filter(row=>row.id===payload.operation_id)).toHaveLength(1);
  expect(service.store.state.projects.filter(project=>project.root===root)).toHaveLength(1);
});

it('announces snapshot calibration and replays durable SSE IDs after reconnect',async()=>{
  const before=service.store.state.events.at(-1)!.seq;
  await service.settings({operation_id:op(),paused:true,concurrency:2});
  const accepted=service.store.state.events.at(-1)!;
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),3000);
  try{
    const response=await fetch(`${http.address}/api/v1/events`,{headers:headers({'last-event-id':String(before)}),signal:controller.signal});
    expect(response.status).toBe(200);expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader=response.body!.getReader();let text='';
    while(!text.includes(`id: ${accepted.seq}\n`)){const value=await reader.read();if(value.done)throw new Error('SSE ended before replay');text+=new TextDecoder().decode(value.value);}
    expect(text.indexOf('event: snapshot')).toBeLessThan(text.indexOf('event: change'));
    expect(text).toContain('meteor-flow.events/v1');expect(text).toContain('全局暂停');expect(text).not.toContain('terminal.frame');
    await reader.cancel();
  }finally{clearTimeout(timer);controller.abort();}
});

it('requires explicit confirmation to resolve an unknown start over HTTP and replays the recorded manual evidence',async()=>{
  fake.onStart=async()=>{throw new Error('controlled startup response loss');};
  const start=await service.start({operation_id:op(),projectId:binding.projectId,type:'codex',cwd:join(temp,'unknown-start'),label:'人工核对测试'});
  await expect.poll(()=>service.store.state.starts.find(row=>row.id===start.id)?.status).toBe('unknown');
  const payload={operation_id:op(),evidence:'已核对原生窗格和进程，启动未创建',confirmedStopped:true};
  const submit=(body:Record<string,unknown>)=>fetch(`${http.address}/api/v1/starts/${start.id}/resolve`,{method:'POST',headers:headers(),body:JSON.stringify(body)});
  for(const invalid of [{...payload,confirmedStopped:undefined},{...payload,confirmedStopped:false},{...payload,evidence:''}]){
    expect((await submit(invalid)).status).toBe(400);
    expect(service.store.state.starts.find(row=>row.id===start.id)?.status).toBe('unknown');
  }
  const accepted=await submit(payload);expect(accepted.status).toBe(200);const receipt=await accepted.json();
  expect(receipt).toMatchObject({status:'dismissed',resolution:{source:'manual',evidence:payload.evidence}});
  fake.onList=async()=>{throw new Error('disconnected after acceptance');};
  const replay=await submit(payload);expect(replay.status).toBe(200);expect(await replay.json()).toEqual(receipt);
  expect((await submit({...payload,evidence:'不同证据'})).status).toBe(409);
  expect(service.store.state.events.filter(event=>event.type==='start.resolve')).toHaveLength(1);
  expect(fake.starts).toHaveLength(1);expect(fake.interrupts).toEqual([]);
});

async function archivedFile(size:number){
  const {createHash}=await import('node:crypto');
  await service.bindingAction(binding.id,{operation_id:op(),action:'confirm',evidence:'HTTP artifact fixture'});
  await service.bindingAction(binding.id,{operation_id:op(),action:'automatic'});
  const task=await service.saveTask({operation_id:op(),projectId:binding.projectId,bindingId:binding.id,title:'下载资源测试',instructions:'Fixture only',dependencies:[],requiredArtifacts:[],outputRoots:[]}) as import('@meteor-flow/contracts').Task;
  await service.tick();const attempt=service.store.state.attempts.find(a=>a.taskId===task.id)!;
  const archiveId=op(),id=op();const directory=join(service.collector.archiveRoot,archiveId);await mkdir(directory);
  const bytes=Buffer.alloc(size,120);await writeFile(join(directory,'large.bin'),bytes);
  const sha256=createHash('sha256').update(bytes).digest('hex');
  await service.store.command({type:'result',id:attempt.id,hash:'http-fixture-result',archiveId,result:{protocol:'meteor-flow.result/v1',task_id:task.id,attempt_id:attempt.id,outcome:'succeeded',summary:'HTTP fixture',artifacts:[{root_id:'workdir',path:'large.bin',label:'large'}]},artifacts:[{id,taskId:task.id,attemptId:attempt.id,label:'large',rootId:'workdir',sourcePath:'large.bin',archiveId,file:'large.bin',sha256,size}]});
  expect((await fetch(`${http.address}/api/v1/attempts/${attempt.id}/inputs`,{headers:headers()})).status).toBe(200);
  return id;
}

it('holds all four download slots until slow responses finish and aborts them on service close',async()=>{
  const {get}=await import('node:http');const id=await archivedFile(50*1024*1024);
  const opened:import('node:http').IncomingMessage[]=[];
  const slow=()=>new Promise<import('node:http').IncomingMessage>((resolve,reject)=>{
    const request=get(`${http.address}/api/v1/artifacts/${id}/download`,{headers:headers()},response=>{response.pause();response.on('error',()=>{});opened.push(response);resolve(response);});request.on('error',reject);
  });
  try{
    const responses=await Promise.all([slow(),slow(),slow(),slow()]);expect(responses.map(r=>r.statusCode)).toEqual([200,200,200,200]);
    const rejected=await fetch(`${http.address}/api/v1/artifacts/${id}/download`,{headers:headers()});expect(rejected.status).toBe(429);await rejected.arrayBuffer();
    responses[0]!.destroy();
    await expect.poll(async()=>{const response=await fetch(`${http.address}/api/v1/artifacts/${id}/preview`,{headers:headers()});await response.arrayBuffer();return response.status;}).toBe(413);
    await http.app.close();
    // A paused client cannot observe EOF until it resumes consumption, even
    // after the server has destroyed the corresponding socket.
    for(const response of opened)response.resume();
    await expect.poll(()=>opened.every(r=>r.destroyed||r.complete)).toBe(true);
  }finally{for(const response of opened)response.destroy();}
},15000);
