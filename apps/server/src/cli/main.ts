#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdir, readFile, stat, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { acquireLock, canonicalDirectory } from '@meteor-flow/posix-fs';
import { AgentConsole } from '../application/console.js';
import { createServer } from '../http/server.js';

const {values,positionals}=parseArgs({allowPositionals:true,options:{session:{type:'string'},'data-dir':{type:'string'},port:{type:'string'},herdr:{type:'string'},help:{type:'boolean'}}});
const command=positionals.filter(p=>p!=='--')[0]??'serve';
if(values.help){
  process.stdout.write('Meteor Flow\n  serve --session <会话> [--data-dir <路径>] [--port 4317] [--herdr <绝对路径>]\n  open [--data-dir <路径>]\n需要 Node 24、macOS arm64、受支持的 herdr；不会自动启动 herdr 服务。\n');
}else {
  try{
    if(Number(process.versions.node.split('.')[0])!==24)throw new Error('请使用 Node.js 24（见 .node-version）');
    const directory=resolve(values['data-dir']??join(homedir(),'Library','Application Support','Meteor Flow'));
    if(command==='open'){
      const file=join(directory,'open.json');const mode=(await stat(file)).mode;
      if(mode&0o077)throw new Error('启动入口文件权限过宽，拒绝读取');
      const data=JSON.parse(await readFile(file,'utf8')) as {url:string};const url=new URL(data.url);
      if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/'||!url.hash.startsWith('#token='))throw new Error('启动入口无效');
      const child=spawn('/usr/bin/open',[url.toString()],{stdio:'ignore'});await new Promise<void>((ok,fail)=>{child.once('error',fail);child.once('exit',code=>code===0?ok():fail(new Error('浏览器打开失败')));});
    }else if(command==='serve'){
      if(!values.session)throw new Error('请显式选择 herdr 会话：--session <name>');
      if(!/^[A-Za-z0-9._-]{1,64}$/.test(values.session)||['.','..'].includes(values.session))throw new Error('会话名称无效');
      const port=Number(values.port??4317);if(!Number.isInteger(port)||port<0||port>65535)throw new Error('端口无效');
      await mkdir(directory,{recursive:true,mode:0o700});const dataDir=canonicalDirectory(directory);
      const lock=acquireLock(join(dataDir,'.lock'));
      const lockDirectory=join(homedir(),'.meteor-flow','session-locks');await mkdir(lockDirectory,{recursive:true,mode:0o700});
      const lockRoot=canonicalDirectory(lockDirectory);
      const sessionLock=(session:string)=>acquireLock(join(lockRoot,`${createHash('sha256').update(session).digest('hex')}.lock`));
      let session=sessionLock(values.session);let console:AgentConsole|undefined;let http:Awaited<ReturnType<typeof createServer>>|undefined;
      const executable=values.herdr?await realpath(values.herdr):await findExecutable('herdr');
      try{
        console=new AgentConsole({dataDir,session:values.session,executable,sessionSwitch:async name=>sessionLock(name).release});
        console.on('session-switched',(release:(()=>void)|undefined)=>{if(release){session.release();session={release};}});
        await console.open();http=await createServer(console,{port});
        const entry=JSON.parse(await readFile(join(dataDir,'open.json'),'utf8')) as {url:string};
        let stopping=false;
        const stop=async()=>{if(stopping)return;stopping=true;await http?.app.close();await console?.close();session.release();lock.release();};
        for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>void stop().then(()=>process.exit(0),error=>{process.stderr.write(`${String(error)}\n`);process.exit(1);}));
        process.stdout.write(`Meteor Flow 已启动（仅本机）\n会话：${values.session}\n数据：${dataDir}\n打开：${entry.url}\n再次打开：pnpm start -- open --data-dir ${JSON.stringify(dataDir)}\n`);
      }catch(error){await http?.app.close();await console?.close();session.release();lock.release();throw error;}
    }else throw new Error(`未知命令：${command}`);
  }catch(error){process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;}
}

async function findExecutable(name:string){
  for(const directory of (process.env.PATH??'').split(':')){
    try{const file=await realpath(join(directory,name));const info=await stat(file);if(info.isFile()&&(info.mode&0o111))return file;}catch{/* next fixed PATH entry */}
  }
  throw new Error('未找到 herdr；请安装后使用 --herdr <绝对路径> 指定');
}
