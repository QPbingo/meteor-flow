import Fastify, { type FastifyInstance } from 'fastify';
import { attachEvents } from './events.js';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import serveStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ActionInput, BindingInput, Id, Operation, ProjectInput, SettingsInput, StartInput, StartResolutionInput, TaskInput, TaskUpdate, Type, type Action, type CreateTask } from '@meteor-flow/contracts';
import { DomainError } from '../domain/model.js';
import { listSessions } from '../adapters/herdr/index.js';
import { AgentConsole } from '../application/console.js';
import { TerminalBridge } from '../terminal/bridge.js';
import { LocalAuth } from './auth.js';
import { limits } from '../results/protocol.js';
import { readArtifact } from './files.js';

export async function createServer(console:AgentConsole,options:{port?:number;webRoot?:string;listSessions?:typeof listSessions}={}){
  const app=Fastify({logger:false,bodyLimit:128*1024,ajv:{customOptions:{removeAdditional:false,coerceTypes:false,allErrors:false}}});
  await app.register(cookie);await app.register(websocket,{options:{maxPayload:20000}});
  await app.register(swagger,{openapi:{info:{title:'Meteor Flow',version:'0.1.0'}}});
  const auth=new LocalAuth(console.options.dataDir,console.generation);
  const terminal=new TerminalBridge(console,console.options.executable);
  let downloads=0;
  const readers=new Map<AbortController,Promise<unknown>>();
  const downloadResponses=new Set<import('node:http').ServerResponse>();
  const closeEvents=attachEvents(console);
  app.setErrorHandler((error,request,reply)=>{
    const known=error instanceof DomainError;
    const invalid=error instanceof Error&&'validation' in error;
    const status=known?error.status:invalid?400:500;
    const code=known?error.code:invalid?'VALIDATION':'INTERNAL';
    reply.status(status).send({error:{code,message:known?error.message:invalid?'请求字段不符合协议':'操作失败，请查看连接与存储状态',current:{storage:console.store.healthy,connected:console.health.connected},recoveryActions:code==='PROJECT_DIRECTORY'?['correct-directory']:!console.store.healthy?['recover-storage']:['refresh-and-check']}});
  });
  app.addHook('onRequest',async(request,reply)=>{
    reply.header('x-content-type-options','nosniff').header('referrer-policy','no-referrer').header('cache-control','no-store');
    reply.header('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
    auth.boundary(request);
    const path=request.url.split('?')[0]?.replace(/^\/api\/v1\//,'/api/');
    if(path?.startsWith('/api/')&&!['/api/auth','/api/bootstrap','/api/auth/session','/api/auth/bootstrap'].includes(path))auth.require(request,(path.startsWith('/api/terminal/')||path.startsWith('/api/terminals/')));
  });
  async function registerApi(instance:FastifyInstance){
  const app=instance.withTypeProvider<TypeBoxTypeProvider>();
  const authSession=async(request:import('fastify').FastifyRequest)=>{const session=auth.session(request);return {authenticated:!!session,csrf:session?.csrf??null};};
  app.get('/auth/session',authSession);
  app.get('/auth',async request=>{const session=auth.session(request);return {authenticated:!!session,csrf:session?.csrf??null};});
  app.post<{Body:{token:string}}>('/bootstrap',{schema:{body:Type.Object({token:Type.String({minLength:32,maxLength:128})},{additionalProperties:false})}},(request,reply)=>auth.exchange(request,reply,request.body.token));
  app.get('/state',async()=>console.snapshot());
  app.post<{Body:{token:string}}>('/auth/bootstrap',{schema:{body:Type.Object({token:Type.String({minLength:32,maxLength:128})},{additionalProperties:false})}},(request,reply)=>auth.exchange(request,reply,request.body.token));
  app.get('/system',async()=>({generation:console.generation,health:console.snapshot().health,settings:console.store.state.settings,version:'0.1.0',protocol:'meteor-flow.api/v1'}));
  app.get('/projects',async()=>({projects:console.store.state.projects}));
  app.get('/agents',async()=>({bindings:console.store.state.bindings,discoveries:console.discoveries,starts:console.store.state.starts}));
  app.get<{Params:{id:string}}>('/tasks/:id',{schema:{params:Type.Object({id:Id})}},request=>{const task=console.snapshot().tasks.find(t=>t.id===request.params.id);if(!task)throw new DomainError('TASK','任务不存在',404);return {task,attempts:console.store.state.attempts.filter(a=>a.taskId===task.id)};});
  app.get<{Params:{id:string}}>('/operations/:id',{schema:{params:Type.Object({id:Id})}},request=>{const operation=console.store.state.operations.find(o=>o.id===request.params.id);if(!operation)throw new DomainError('OPERATION','操作尚未被持久化接受',404);return {id:operation.id,result:operation.result};});
  app.get<{Params:{id:string}}>('/attempts/:id',{schema:{params:Type.Object({id:Id})}},request=>{const attempt=console.store.state.attempts.find(a=>a.id===request.params.id);if(!attempt)throw new DomainError('ATTEMPT','执行尝试不存在',404);return attempt;});
  app.get<{Params:{id:string}}>('/attempts/:id/inputs',{schema:{params:Type.Object({id:Id})}},request=>{const attempt=console.store.state.attempts.find(a=>a.id===request.params.id);if(!attempt)throw new DomainError('ATTEMPT','执行尝试不存在',404);return {attemptId:attempt.id,taskId:attempt.taskId,input:attempt.input};});
  app.get('/events',(request,reply)=>closeEvents.attach(request,reply));

  app.get('/openapi.json',async()=>app.swagger());
  app.get('/sessions',async()=>({sessions:await(options.listSessions??listSessions)(console.options.executable)}));
  app.post<{Body:{operation_id:string;session:string}}>('/session',{schema:{body:Type.Object({...Operation,session:Type.String({pattern:'^[A-Za-z0-9._-]{1,64}$'})},{additionalProperties:false})}},async request=>{
    return console.switchSession(request.body.session,request.body.operation_id,async()=>{
      const sessions=await(options.listSessions??listSessions)(console.options.executable);
      if(!sessions.some(row=>row.name===request.body.session))throw new DomainError('SESSION','会话不在当前本机列表中，请刷新后选择',400);
    });
  });
  app.post<{Body:{operation_id:string;name:string;root:string}}>('/projects',{schema:{body:ProjectInput}},request=>console.createProject(request.body));
  app.post<{Params:{id:string};Body:{operation_id:string}}>('/projects/:id/archive',{schema:{params:Type.Object({id:Id}),body:Type.Object(Operation,{additionalProperties:false})}},request=>console.archiveProject(request.params.id,request.body.operation_id));
  app.post<{Body:{operation_id:string;projectId:string;terminalId:string;label:string}}>('/bindings',{schema:{body:BindingInput}},request=>console.attach(request.body));
  app.post('/agents',{schema:{body:BindingInput}},request=>console.attach(request.body));
  app.post('/agents/start',{schema:{body:StartInput}},request=>console.start(request.body));
  app.post('/agents/:id/actions',{schema:{params:Type.Object({id:Id}),body:ActionInput}},request=>console.bindingAction(request.params.id,request.body));
  app.post<{Params:{id:string};Body:Action}>('/bindings/:id/actions',{schema:{params:Type.Object({id:Id}),body:ActionInput}},request=>console.bindingAction(request.params.id,request.body));
  app.post<{Body:{operation_id:string;projectId:string;type:'codex'|'claude';cwd:string;label:string}}>('/starts',{schema:{body:StartInput}},request=>console.start(request.body));
  app.post('/starts/:id/resolve',{schema:{params:Type.Object({id:Id}),body:StartResolutionInput}},request=>console.resolveStart(request.params.id,request.body));
  app.post<{Body:CreateTask}>('/tasks',{schema:{body:TaskInput}},request=>console.saveTask(request.body));
  app.put<{Params:{id:string};Body:CreateTask&{expected_revision:number}}>('/tasks/:id',{schema:{params:Type.Object({id:Id}),body:TaskUpdate}},request=>{const {expected_revision,...data}=request.body;return console.saveTask(data,request.params.id,expected_revision);});
  app.post<{Params:{id:string};Body:Action}>('/tasks/:id/actions',{schema:{params:Type.Object({id:Id}),body:ActionInput}},request=>console.taskAction(request.params.id,request.body));
  app.post<{Body:{operation_id:string;paused:boolean;concurrency:number}}>('/settings',{schema:{body:SettingsInput}},request=>console.settings(request.body));
  app.post('/storage/recover',async()=>{await console.recoverStorage();return {recovered:true,message:'存储已恢复；Agent 仍需重新核对'};});
  app.post<{Params:{id:string}}>('/bindings/:id/emergency-interrupt',{schema:{params:Type.Object({id:Id})}},request=>console.emergencyInterrupt(request.params.id));
  app.get<{Querystring:{offset?:string;limit?:string;project?:string;phase?:string;search?:string}}>('/tasks',async request=>{
    const query=request.query;const offset=Math.max(0,Number(query.offset)||0);const limit=Math.min(100,Math.max(1,Number(query.limit)||50));
    const rows=console.snapshot().tasks.filter(t=>(!query.project||t.projectId===query.project)&&(!query.phase||t.phase===query.phase)&&(!query.search||t.title.toLowerCase().includes(query.search.toLowerCase())));
    return {total:rows.length,offset,limit,tasks:rows.slice(offset,offset+limit)};
  });
  async function artifactContent(request:import('fastify').FastifyRequest<{Params:{id:string};Querystring:{download?:string}}>,reply:import('fastify').FastifyReply){
    const artifact=console.store.state.artifacts.find(a=>a.id===request.params.id);
    if(!artifact)throw new DomainError('ARTIFACT','产物不存在',404);
    if(downloads>=4)throw new DomainError('BUSY','下载容量已满，请稍后重试',429);
    downloads++;
    const controller=new AbortController();
    downloadResponses.add(reply.raw);
    let released=false;let readingDone=false;let responseDone=false;
    const release=()=>{if(!released&&readingDone&&responseDone){released=true;downloads--;}};
    const ended=()=>{responseDone=true;downloadResponses.delete(reply.raw);controller.abort();release();};
    reply.raw.once('finish',ended);reply.raw.once('close',ended);
    const reading=readArtifact(console.collector.archiveRoot,`${artifact.archiveId}/${artifact.file}`,artifact.sha256,limits.file,controller.signal);
    readers.set(controller,reading);
    try{
      const file=await reading;
      if(reply.raw.destroyed)return reply;
      reply.header('content-security-policy',"default-src 'none'; sandbox");
      if(request.query.download==='1'||request.url.split('?')[0]?.endsWith('/download')){
        reply.type('application/octet-stream').header('content-disposition',`attachment; filename="artifact.bin"; filename*=UTF-8''${encodeURIComponent(artifact.label).replace(/'/g,'%27')}`);return reply.send(file.data);
      }
      const data=file.data;
      const imageType=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':data[0]===255&&data[1]===216&&data[2]===255?'image/jpeg':/^(GIF87a|GIF89a)$/.test(data.subarray(0,6).toString('ascii'))?'image/gif':data.subarray(0,4).toString('ascii')==='RIFF'&&data.subarray(8,12).toString('ascii')==='WEBP'?'image/webp':null;
      if(imageType){if(file.size>20*1024*1024)throw new DomainError('PREVIEW_LIMIT','图片超过 20 MiB 预览上限，请下载查看',413);return reply.type(imageType).send(data);}
      if(file.size>1024*1024)throw new DomainError('PREVIEW_LIMIT','文件超过预览上限，请下载查看',413);
      if(/\.(html?|svg)$/i.test(artifact.sourcePath)||file.data.includes(0))throw new DomainError('DOWNLOAD_ONLY','此类型仅支持下载',415);
      reply.type('text/plain; charset=utf-8');return reply.send(new TextDecoder('utf-8',{fatal:true}).decode(file.data));
    }finally{readingDone=true;readers.delete(controller);release();}
  }
  for(const path of ['/artifacts/:id/content','/artifacts/:id/preview','/artifacts/:id/download'])app.get(path,{schema:{params:Type.Object({id:Id})}},artifactContent);
  app.get<{Params:{bindingId:string}}>('/terminals/:bindingId',{websocket:true},(socket,request)=>terminal.attach(request.params.bindingId,socket));
  app.get<{Params:{bindingId:string}}>('/terminal/:bindingId',{websocket:true},(socket,request)=>terminal.attach(request.params.bindingId,socket));
  }
  await app.register(registerApi,{prefix:'/api'});
  await app.register(registerApi,{prefix:'/api/v1'});
  const webRoot=options.webRoot??fileURLToPath(new URL('../../../web/dist/',import.meta.url));
  if(existsSync(join(webRoot,'index.html'))){
    await app.register(serveStatic,{root:webRoot,wildcard:false});
    app.setNotFoundHandler((request,reply)=>request.url.startsWith('/api/')?reply.code(404).send({error:{code:'NOT_FOUND',message:'接口不存在'}}):reply.sendFile('index.html'));
  }else app.get('/',async()=>({message:'网页尚未构建，请执行 pnpm build'}));
  app.addHook('preClose',async()=>{closeEvents();for(const response of downloadResponses)response.destroy();for(const controller of readers.keys())controller.abort();await Promise.allSettled([...readers.values()]);await terminal.close();});
  try{
    const address=await app.listen({host:'127.0.0.1',port:options.port??4317});
    await auth.init(address);
    return {app,auth,terminal,address};
  }catch(error){await app.close();throw error;}
}
