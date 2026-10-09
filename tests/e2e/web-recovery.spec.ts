import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { Binding, Task } from '@meteor-flow/contracts';
import { AgentConsole } from '../../apps/server/dist/application/console.js';
import { createServer } from '../../apps/server/dist/http/server.js';
import { FakeHerdr } from '../fixtures/fake-herdr.js';

// Real browser, HTTP, SQLite and scheduler; external Agent behavior is controlled.
test('recovery UI preserves dependency edits, follows retries and records explicit manual recovery',async({page})=>{
  test.setTimeout(45000);
  const root=await realpath(await mkdtemp('/tmp/meteor-web-recovery-'));
  const dataDir=join(root,'data'),cwd=join(root,'work');await mkdir(dataDir);await mkdir(cwd);
  const fake=new FakeHerdr({agents:[{terminalId:'terminal-one',cwd}]});
  const service=new AgentConsole({dataDir,session:fake.session,executable:'/unused-herdr',portFactory:()=>fake,pollMs:1000000,minFreeBytes:0});
  let http:Awaited<ReturnType<typeof createServer>>|undefined;
  try{
    await service.open();
    const project=await service.createProject({operation_id:randomUUID(),name:'恢复测试',root});
    const binding=await service.attach({operation_id:randomUUID(),projectId:project.id,terminalId:'terminal-one',label:'测试 Agent'}) as Binding;
    await service.bindingAction(binding.id,{operation_id:randomUUID(),action:'confirm',evidence:'隔离测试目录和实例'});
    await service.bindingAction(binding.id,{operation_id:randomUUID(),action:'automatic'});
    const create=(title:string,dependencies:Task['dependencies']=[])=>service.saveTask({operation_id:randomUUID(),projectId:project.id,bindingId:binding.id,title,instructions:'恢复链路测试',dependencies,requiredArtifacts:[],outputRoots:[]}) as Promise<Task>;
    const upstream=await create('归档前置任务');
    await service.taskAction(upstream.id,{operation_id:randomUUID(),action:'cancel'});
    await service.taskAction(upstream.id,{operation_id:randomUUID(),action:'archive'});
    const dependent=await create('编辑依赖的任务',[{taskId:upstream.id,artifacts:[]}]);
    http=await createServer(service,{port:0,webRoot:resolve('apps/web/dist'),listSessions:async()=>[{name:fake.session,socketPath:'/isolated-recovery.sock'}]});
    const entry=JSON.parse(await readFile(join(dataDir,'open.json'),'utf8')) as {url:string};
    const url=new URL(entry.url);url.searchParams.set('task',dependent.id);await page.goto(url.toString());
    await page.getByRole('button',{name:'编辑任务',exact:true}).click();
    let dialog=page.getByRole('dialog');
    const dependency=dialog.getByRole('checkbox',{name:/归档前置任务（已归档）/});
    await expect(dependency).toBeChecked();await dependency.uncheck();
    await dialog.getByRole('button',{name:'保存修改'}).click();await expect(dialog).toHaveCount(0);
    expect(service.store.state.tasks.find(task=>task.id===dependent.id)!.dependencies).toEqual([]);
    // This filter is controlled by a React Router transition; wait for its URL and render commit.
    await page.getByLabel('已归档',{exact:true}).click();
    await expect(page).toHaveURL(/archived=1/);await expect(page.getByLabel('已归档',{exact:true})).toBeChecked();
    await page.getByRole('button',{name:'归档前置任务',exact:true}).click();
    await expect(page.getByRole('region',{name:'任务详情'}).getByRole('button',{name:'重试',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'复制任务',exact:true})).toBeVisible();
    await page.getByLabel('已归档',{exact:true}).click();await expect(page.getByLabel('已归档',{exact:true})).not.toBeChecked();
    await service.tick();const first=service.store.state.attempts.find(attempt=>attempt.taskId===dependent.id)!;
    await service.taskAction(dependent.id,{operation_id:randomUUID(),action:'record-conclusion',outcome:'failed',reason:'受控失败',evidence:'当前相同实例空闲',stopped:true});
    await page.getByRole('button',{name:'编辑依赖的任务',exact:true}).click();
    await expect(page.getByLabel('执行尝试',{exact:true})).toHaveValue(first.id);
    await page.getByRole('button',{name:'重试',exact:true}).click();
    await page.getByRole('button',{name:'确认重试任务',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
    await service.tick();const second=service.store.state.attempts.find(attempt=>attempt.taskId===dependent.id&&attempt.id!==first.id)!;
    expect(second).toBeTruthy();
    await expect(page.getByLabel('执行尝试',{exact:true})).toHaveValue(second.id);
    await expect(page.getByRole('tabpanel')).toContainText('仍保留占用');
    await page.getByLabel('执行尝试',{exact:true}).selectOption(first.id);
    fake.setStatus('terminal-one','working');await service.refresh();
    await expect(page.getByLabel('执行尝试',{exact:true})).toHaveValue(first.id);
    await page.getByLabel('执行尝试',{exact:true}).selectOption(second.id);
    fake.setStatus('terminal-one','idle');await service.refresh();
    await page.getByRole('button',{name:'补录结论',exact:true}).click();dialog=page.getByRole('dialog');
    await dialog.getByLabel('补录原因').fill('先保存排查结论');await dialog.getByLabel('证据与核对过程').fill('尚未核实所有执行活动，保留占用');
    await expect(dialog.getByRole('checkbox')).not.toBeChecked();
    await dialog.getByRole('button',{name:'确认人工补录结论',exact:true}).click();await expect(dialog).toHaveCount(0);
    expect(service.store.state.attempts.find(attempt=>attempt.id===second.id)).toMatchObject({source:'manual',occupies:true,phase:'needs_confirmation'});
    const newCwd=join(root,'unknown-start');fake.onStart=async()=>{throw new Error('controlled unknown startup');};
    const start=await service.start({operation_id:randomUUID(),projectId:project.id,type:'codex',cwd:newCwd,label:'待核对启动'});
    await expect.poll(()=>service.store.state.starts.find(row=>row.id===start.id)?.status).toBe('unknown');
    await page.getByRole('button',{name:'Agent',exact:true}).click();
    await page.getByRole('button',{name:'人工核对启动',exact:true}).click();dialog=page.getByRole('dialog');
    await dialog.getByLabel('启动核对证据').fill('原生窗格和进程均已核对，原启动未创建');
    await dialog.getByRole('button',{name:'保存核对并解除'}).click();
    await expect(dialog).toBeVisible();expect(service.store.state.starts[0]!.status).toBe('unknown');
    await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'保存核对并解除'}).click();await expect(dialog).toHaveCount(0);
    await expect(page.getByText('待核对启动 · 已由人工核对解除',{exact:true})).toBeVisible();
    expect(fake.starts).toHaveLength(1);expect(fake.interrupts).toEqual([]);
    await page.reload();await expect(page.getByText('待核对启动 · 已由人工核对解除',{exact:true})).toBeVisible();
    const db=new DatabaseSync(join(dataDir,'meteor-flow.sqlite'),{readOnly:true});
    try{
      const stored=JSON.parse(String(db.prepare('SELECT data FROM starts WHERE id=?').get(start.id)?.data));
      expect(stored).toMatchObject({status:'dismissed',resolution:{source:'manual',evidence:'原生窗格和进程均已核对，原启动未创建'}});
      expect(JSON.parse(String(db.prepare('SELECT data FROM attempts WHERE id=?').get(second.id)?.data))).toMatchObject({occupies:true,source:'manual'});
    }finally{db.close();}
    const evidence=process.env.METEOR_FLOW_E2E_EVIDENCE??'test-results/evidence';await mkdir(evidence,{recursive:true});
    await page.setViewportSize({width:390,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:join(evidence,'web-recovery-mobile.png'),fullPage:true});
  }finally{await http?.app.close();await service.close();await rm(root,{recursive:true,force:true});}
});
