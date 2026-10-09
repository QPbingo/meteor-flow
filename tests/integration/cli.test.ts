import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('CLI rejects duplicate data/session owners and releases locks on shutdown (V26)',async()=>{
  const directory=await mkdtemp('/tmp/mf-cli-');const children:ChildProcess[]=[];
  const session=`mf-lock-${randomUUID().slice(0,8)}`;const other=`mf-lock-${randomUUID().slice(0,8)}`;
  const first=join(directory,'data');const alias=join(directory,'alias');await mkdir(first);await symlink(first,alias);await mkdir(join(directory,'other'));
  function start(dataDir:string,name:string){
    const child=spawn(process.execPath,[resolve('apps/server/dist/cli/main.js'),'serve','--session',name,'--data-dir',dataDir,'--port','0','--herdr','/usr/bin/false'],{stdio:['ignore','pipe','pipe']});children.push(child);
    let stderr='';child.stderr!.on('data',data=>{stderr+=String(data);});
    const closed=once(child,'close');
    const ready=new Promise<void>((resolve,reject)=>{child.stdout!.on('data',data=>{if(String(data).includes('Meteor Flow 已启动'))resolve();});child.once('error',reject);child.once('exit',code=>reject(new Error(`CLI exited ${code}: ${stderr}`)));});
    // Some calls expect refusal; preserve errors without an unhandled rejection.
    void ready.catch(()=>{});return {child,ready,closed,error:()=>stderr};
  }
  try{
    const owner=start(first,session);await owner.ready;
    const duplicate=start(alias,other);expect((await duplicate.closed)[0]).toBe(1);expect(duplicate.error()).toContain('flock');
    const sameSession=start(join(directory,'other'),session);expect((await sameSession.closed)[0]).toBe(1);expect(sameSession.error()).toContain('flock');
    owner.child.kill('SIGTERM');expect((await owner.closed)[0]).toBe(0);
    const replacement=start(first,session);await replacement.ready;replacement.child.kill('SIGTERM');expect((await replacement.closed)[0]).toBe(0);
  }finally{
    for(const child of children)if(child.exitCode===null&&child.signalCode===null){const close=once(child,'close');child.kill('SIGKILL');await close;}
    for(const name of [session,other])await rm(join(homedir(),'.meteor-flow/session-locks',`${createHash('sha256').update(name).digest('hex')}.lock`),{force:true});
    await rm(directory,{recursive:true,force:true});
  }
},15000);

it('exits after the HTTP listener opens but authentication bootstrap persistence fails',async()=>{
  const directory=await mkdtemp('/tmp/mf-cli-bootstrap-');
  const session=`mf-bootstrap-${randomUUID().slice(0,8)}`;
  await mkdir(join(directory,'open.json'));
  const child=spawn(process.execPath,[resolve('apps/server/dist/cli/main.js'),'serve','--session',session,'--data-dir',directory,'--port','0','--herdr','/usr/bin/false'],{stdio:['ignore','pipe','pipe']});
  let stderr='';let stdout='';child.stderr!.on('data',data=>{stderr+=String(data);});child.stdout!.on('data',data=>{stdout+=String(data);});
  const closed=once(child,'close');
  try{
    await expect.poll(()=>stderr,{timeout:5000}).toContain('EISDIR');
    await expect.poll(()=>child.exitCode,{timeout:3000}).toBe(1);
    expect((await closed)[0]).toBe(1);
    expect(stdout).not.toContain('Meteor Flow 已启动');
  }finally{
    if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed;}
    await rm(join(homedir(),'.meteor-flow/session-locks',`${createHash('sha256').update(session).digest('hex')}.lock`),{force:true});
    await rm(directory,{recursive:true,force:true});
  }
},10000);
