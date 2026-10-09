import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { HerdrClient } from './index.js';

// Opt in explicitly: this starts only an isolated headless server, never a user session.
it.runIf(process.env.METEOR_FLOW_REAL_HERDR === '1')('connects, snapshots and subscribes to an isolated real herdr 0.9.3 server', async () => {
  const directory = await mkdtemp('/tmp/mf-real-');
  const session = `meteor-flow-test-${randomUUID().slice(0, 8)}`;
  const socketPath = join(directory, 'config/herdr/sessions', session, 'herdr.sock');
  const env = { ...process.env, XDG_CONFIG_HOME: join(directory, 'config'), XDG_STATE_HOME: join(directory, 'state') };
  for (const key of ['HERDR_SESSION', 'HERDR_SOCKET_PATH', 'HERDR_CLIENT_SOCKET_PATH', 'HERDR_PANE_ID']) delete env[key as keyof typeof env];
  const child = spawn('herdr', ['--session', session, 'server'], { cwd: directory, env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', data => { stderr = (stderr + String(data)).slice(-8192); });
  let spawnError: Error | undefined;
  child.on('error', error => { spawnError = error; });
  const client = new HerdrClient({ session, socketPath, timeoutMs: 1000 });
  try {
    await expect.poll(async () => {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`herdr exited: ${stderr}`);
      try { return await client.connect(); } catch { return null; }
    }, { timeout: 10_000, interval: 25 }).toEqual({ version: '0.9.3', protocol: 22 });
    expect(await client.listAgents()).toEqual([]);
    let changes = 0;
    const stop = await client.subscribe(() => { changes++; }, () => {});
    expect(changes).toBe(1);
    expect(await client.listAgents()).toEqual([]);
    stop();
  } finally {
    client.close();
    if (child.exitCode === null && !spawnError) {
      const closed = once(child, 'close');
      // Test-only shutdown targets the exact socket under this test's private directory.
      const socket = createConnection(socketPath);
      socket.on('error', () => {});
      socket.once('connect', () => socket.end(JSON.stringify({ id: randomUUID(), method: 'server.stop', params: {} }) + '\n'));
      const deadline = setTimeout(() => child.kill('SIGTERM'), 2000);
      await closed;
      clearTimeout(deadline);
      socket.destroy();
    }
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);

it.runIf(process.env.METEOR_FLOW_REAL_HERDR === '1')('uses real official terminal observe/control streams in a dedicated shell without model calls',async()=>{
  const {readFile}=await import('node:fs/promises');
  const directory=await mkdtemp('/tmp/mf-terminal-real-');const session=`mf-terminal-${randomUUID().slice(0,8)}`;
  const socketPath=join(directory,'config/herdr/sessions',session,'herdr.sock');
  const env:NodeJS.ProcessEnv={...process.env,XDG_CONFIG_HOME:join(directory,'config'),XDG_STATE_HOME:join(directory,'state')};
  for(const key of ['HERDR_SESSION','HERDR_SOCKET_PATH','HERDR_CLIENT_SOCKET_PATH','HERDR_PANE_ID','HERDR_WORKSPACE_ID','HERDR_TERMINAL_ID'])delete env[key];
  const server=spawn('herdr',['--session',session,'server'],{cwd:directory,env,stdio:['ignore','ignore','ignore']});const serverClosed=once(server,'close');
  const clients:Array<ReturnType<typeof spawn>>=[];
  const rpc=(method:string,params:Record<string,unknown>={})=>new Promise<Record<string,any>>((resolve,reject)=>{
    const id=randomUUID();const socket=createConnection(socketPath);let data='';
    const timer=setTimeout(()=>{socket.destroy();reject(new Error(`${method} timeout`));},3000);
    const finish=(error?:Error,value?:Record<string,any>)=>{clearTimeout(timer);socket.destroy();error?reject(error):resolve(value!);};
    socket.on('error',finish);socket.once('connect',()=>socket.write(JSON.stringify({id,method,params})+'\n'));
    socket.on('data',chunk=>{data+=chunk;if(data.includes('\n')){try{const response=JSON.parse(data.split('\n')[0]!);if(response.id!==id||response.error)finish(new Error(`${method}: ${response.error?.code??'response mismatch'}`));else finish(undefined,response.result);}catch(error){finish(error as Error);}}});
  });
  function terminal(mode:'observe'|'control',target:string,cols:number,rows:number){
    const child=spawn('herdr',['--session',session,'terminal','session',mode,target,'--cols',String(cols),'--rows',String(rows)],{cwd:directory,env,stdio:['pipe','pipe','pipe']});clients.push(child);
    const frames:any[]=[];let data='';let stderr='';const closed=once(child,'close');
    child.stdout.on('data',chunk=>{data+=chunk;while(data.includes('\n')){const end=data.indexOf('\n');frames.push(JSON.parse(data.slice(0,end)));data=data.slice(end+1);}});child.stderr.on('data',chunk=>{stderr+=chunk;});
    return {child,frames,closed,error:()=>stderr};
  }
  try{
    await expect.poll(async()=>{try{return(await rpc('ping')).version;}catch{return null;}},{timeout:10000}).toBe('0.9.3');
    const created=await rpc('workspace.create',{cwd:directory,focus:false,label:'Terminal integration only'});const target=created.root_pane.terminal_id;const pane=created.root_pane.pane_id;
    await expect.poll(async()=>{const info=(await rpc('pane.process_info',{pane_id:pane})).process_info;return info.shell_pid===info.foreground_process_group_id;},{timeout:5000}).toBe(true);
    const observer=terminal('observe',target,120,32);observer.child.stdin.end();
    await expect.poll(()=>observer.frames.some(f=>f.type==='terminal.frame'),{timeout:5000}).toBe(true);expect(observer.child.exitCode).toBeNull();
    expect(observer.frames.find(f=>f.type==='terminal.frame')).toMatchObject({encoding:'ansi',bytes:expect.any(String)});
    const controller=terminal('control',target,100,30);
    await expect.poll(()=>controller.frames.some(f=>f.type==='terminal.frame'),{timeout:5000}).toBe(true);
    controller.child.stdin.write(JSON.stringify({type:'terminal.input',text:'printf meteor-flow-terminal-ok > control.txt\r'})+'\n');
    await expect.poll(()=>readFile(join(directory,'control.txt'),'utf8').catch(()=>''),{timeout:5000}).toBe('meteor-flow-terminal-ok');
    controller.child.stdin.write(JSON.stringify({type:'terminal.input',text:'stty size > before.txt\r'})+'\n');
    await expect.poll(()=>readFile(join(directory,'before.txt'),'utf8').catch(()=>''),{timeout:5000}).toMatch(/30\s+100/);
    const secondObserver=terminal('observe',target,80,20);secondObserver.child.stdin.end();await expect.poll(()=>secondObserver.frames.some(f=>f.type==='terminal.frame')).toBe(true);
    controller.child.stdin.write(JSON.stringify({type:'terminal.input',text:'stty size > after.txt\r'})+'\n');
    await expect.poll(()=>readFile(join(directory,'after.txt'),'utf8').catch(()=>''),{timeout:5000}).toMatch(/30\s+100/);
    const competitor=terminal('control',target,80,20);await competitor.closed;expect(competitor.frames.some(f=>f.type==='terminal.frame')).toBe(false);expect(competitor.frames).toContainEqual(expect.objectContaining({type:'terminal.closed',reason:expect.stringContaining('already has an attached client')}));
    controller.child.stdin.end(JSON.stringify({type:'terminal.release'})+'\n');await controller.closed;
    expect(observer.child.exitCode).toBeNull();expect(secondObserver.child.exitCode).toBeNull();
  }finally{
    for(const child of clients)if(child.exitCode===null&&child.signalCode===null){const close=once(child,'close');child.kill('SIGTERM');await close;}
    if(server.exitCode===null&&server.signalCode===null){const deadline=setTimeout(()=>server.kill('SIGTERM'),2000);try{await rpc('server.stop');}catch{}await serverClosed;clearTimeout(deadline);}
    await rm(directory,{recursive:true,force:true});
  }
},25000);
