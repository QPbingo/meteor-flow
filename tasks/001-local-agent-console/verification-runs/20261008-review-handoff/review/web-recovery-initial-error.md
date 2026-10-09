# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/e2e/web-recovery.spec.ts >> recovery UI preserves dependency edits, follows retries and records explicit manual recovery
- Location: tests/e2e/web-recovery.spec.ts:12:1

# Error details

```
Error: locator.check: Clicking the checkbox did not change its state
Call log:
  - waiting for getByLabel('已归档', { exact: true })
    - locator resolved to <input type="checkbox"/>
  - attempting click action
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - performing click action
    - click action done
    - waiting for scheduled navigations to finish
    - navigations have finished

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - link "跳到主要内容" [ref=e4] [cursor=pointer]:
    - /url: "#main"
  - complementary [ref=e5]:
    - strong [ref=e11]: Meteor Flow
    - paragraph [ref=e12]: 本地 Agent 控制台
    - generic [ref=e13]:
      - generic [ref=e14]: 当前项目
      - combobox "当前项目" [ref=e15]:
        - option "恢复测试" [selected]
      - button "创建项目" [ref=e16] [cursor=pointer]
    - navigation "主导航" [ref=e18]:
      - button "任务" [ref=e19] [cursor=pointer]
      - button "Agent" [ref=e23] [cursor=pointer]
    - generic [ref=e26]:
      - generic [ref=e27]: HERDR SESSION
      - strong [ref=e28]: meteor-flow-test-state
      - button "选择 / 切换会话" [ref=e29] [cursor=pointer]
      - generic [ref=e30]: herdr 0.9.3
    - generic [ref=e31]:
      - code [ref=e34]: /private/tmp/meteor-web-recovery-hfOYTG
      - button "归档当前项目" [ref=e35] [cursor=pointer]
  - generic [ref=e36]:
    - banner [ref=e37]:
      - generic [ref=e38]:
        - strong [ref=e40]: 本地连接正常
        - generic [ref=e41]: 最后观测 10/08 15:44:25
      - generic [ref=e42]:
        - generic [ref=e43]: 并行上限 2
        - button "调度设置" [ref=e44] [cursor=pointer]
        - button "暂停调度" [ref=e48] [cursor=pointer]
    - main [ref=e52]:
      - status [ref=e53]:
        - generic [ref=e54]: 服务端已接受操作，以下为最新可用状态。
        - button "关闭提示" [ref=e55] [cursor=pointer]
      - generic [ref=e56]:
        - generic [ref=e57]:
          - heading "任务" [level=1] [ref=e58]
          - paragraph [ref=e59]: 恢复测试 · 指定 Agent，按依赖与就绪状态推进。
        - button "新建任务" [ref=e60] [cursor=pointer]
      - generic [ref=e62]:
        - textbox "搜索任务" [ref=e67]:
          - /placeholder: 搜索任务、说明或等待原因
        - combobox "筛选任务状态" [ref=e68]:
          - option "全部状态" [selected]
          - option "待派发"
          - option "投递中"
          - option "执行中"
          - option "收集结果"
          - option "取消中"
          - option "待确认"
          - option "已成功"
          - option "已失败"
          - option "已取消"
        - generic [ref=e69] [cursor=pointer]:
          - checkbox "已归档" [active] [ref=e70]
          - text: 已归档
      - table [ref=e72]:
        - rowgroup [ref=e73]:
          - row [ref=e74]:
            - columnheader "任务 / 等待原因" [ref=e75]
            - columnheader "任务阶段" [ref=e76]
            - columnheader "指定 Agent" [ref=e77]
            - columnheader "前置任务" [ref=e78]
            - columnheader "创建时间" [ref=e79]
        - rowgroup [ref=e80]:
          - row [ref=e81]:
            - cell [ref=e82]:
              - button "编辑依赖的任务" [ref=e83] [cursor=pointer]
              - paragraph [ref=e84]: 等待调度
            - cell "待派发" [ref=e85]
            - cell "测试 Agent" [ref=e89]
            - cell "无依赖" [ref=e90]
            - cell "10/08 15:44:25" [ref=e91]
      - region "任务详情" [ref=e92]:
        - generic [ref=e93]:
          - generic [ref=e94]:
            - heading "编辑依赖的任务" [level=2] [ref=e95]
            - generic [ref=e96]:
              - generic [ref=e97]: 待派发
              - generic [ref=e100]: 任务详情 · 修订 2
          - button "关闭任务详情" [ref=e101] [cursor=pointer]
        - paragraph [ref=e105]: 等待调度
        - generic [ref=e106]:
          - button "编辑任务" [ref=e107] [cursor=pointer]
          - button "取消任务" [ref=e108] [cursor=pointer]
        - generic [ref=e109]:
          - generic [ref=e110]: 执行尝试
          - combobox "执行尝试" [ref=e111]:
            - option "尚未开始执行" [selected]
        - generic [ref=e112]:
          - tablist "任务详情标签" [ref=e113]:
            - tab "概览" [selected] [ref=e114] [cursor=pointer]
            - tab "冻结输入" [ref=e115] [cursor=pointer]
            - tab "终端" [ref=e116] [cursor=pointer]
            - tab "结果与产物" [ref=e117] [cursor=pointer]
            - tab "时间线" [ref=e118] [cursor=pointer]
          - tabpanel "概览" [ref=e119]:
            - generic [ref=e120]:
              - term [ref=e121]: 指定 Agent
              - definition [ref=e122]: 测试 Agent
              - term [ref=e123]: 任务标识
              - definition [ref=e124]:
                - code [ref=e125]: dc106fd9-c108-4704-8fe8-cbff288a014d
              - term [ref=e126]: 执行标识
              - definition [ref=e127]:
                - code [ref=e128]: 尚未分配
              - term [ref=e129]: 执行占用
              - definition [ref=e130]: 无当前占用
              - term [ref=e131]: 执行阶段
              - definition [ref=e132]: 尚未开始
              - term [ref=e133]: 执行说明
              - definition [ref=e134]: 无额外说明
              - term [ref=e135]: 创建 / 结束
              - definition [ref=e136]: 尚未确认 / 尚未确认
            - heading "任务说明" [level=3] [ref=e137]
            - paragraph [ref=e138]: 恢复链路测试
            - heading "前置任务" [level=3] [ref=e139]
            - paragraph [ref=e140]: 无前置任务
    - contentinfo [ref=e141]: 任务由本地服务管理。关闭此页面不会取消执行。
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | import { mkdtemp, mkdir, readFile, rm, realpath } from 'node:fs/promises';
  3  | import { join, resolve } from 'node:path';
  4  | import { randomUUID } from 'node:crypto';
  5  | import { DatabaseSync } from 'node:sqlite';
  6  | import type { Binding, Task } from '@meteor-flow/contracts';
  7  | import { AgentConsole } from '../../apps/server/dist/application/console.js';
  8  | import { createServer } from '../../apps/server/dist/http/server.js';
  9  | import { FakeHerdr } from '../fixtures/fake-herdr.js';
  10 | 
  11 | // Real browser, HTTP, SQLite and scheduler; external Agent behavior is controlled.
  12 | test('recovery UI preserves dependency edits, follows retries and records explicit manual recovery',async({page})=>{
  13 |   test.setTimeout(45000);
  14 |   const root=await realpath(await mkdtemp('/tmp/meteor-web-recovery-'));
  15 |   const dataDir=join(root,'data'),cwd=join(root,'work');await mkdir(dataDir);await mkdir(cwd);
  16 |   const fake=new FakeHerdr({agents:[{terminalId:'terminal-one',cwd}]});
  17 |   const service=new AgentConsole({dataDir,session:fake.session,executable:'/unused-herdr',portFactory:()=>fake,pollMs:1000000,minFreeBytes:0});
  18 |   let http:Awaited<ReturnType<typeof createServer>>|undefined;
  19 |   try{
  20 |     await service.open();
  21 |     const project=await service.createProject({operation_id:randomUUID(),name:'恢复测试',root});
  22 |     const binding=await service.attach({operation_id:randomUUID(),projectId:project.id,terminalId:'terminal-one',label:'测试 Agent'}) as Binding;
  23 |     await service.bindingAction(binding.id,{operation_id:randomUUID(),action:'confirm',evidence:'隔离测试目录和实例'});
  24 |     await service.bindingAction(binding.id,{operation_id:randomUUID(),action:'automatic'});
  25 |     const create=(title:string,dependencies:Task['dependencies']=[])=>service.saveTask({operation_id:randomUUID(),projectId:project.id,bindingId:binding.id,title,instructions:'恢复链路测试',dependencies,requiredArtifacts:[],outputRoots:[]}) as Promise<Task>;
  26 |     const upstream=await create('归档前置任务');
  27 |     await service.taskAction(upstream.id,{operation_id:randomUUID(),action:'cancel'});
  28 |     await service.taskAction(upstream.id,{operation_id:randomUUID(),action:'archive'});
  29 |     const dependent=await create('编辑依赖的任务',[{taskId:upstream.id,artifacts:[]}]);
  30 |     http=await createServer(service,{port:0,webRoot:resolve('apps/web/dist'),listSessions:async()=>[{name:fake.session,socketPath:'/isolated-recovery.sock'}]});
  31 |     const entry=JSON.parse(await readFile(join(dataDir,'open.json'),'utf8')) as {url:string};
  32 |     const url=new URL(entry.url);url.searchParams.set('task',dependent.id);await page.goto(url.toString());
  33 |     await page.getByRole('button',{name:'编辑任务',exact:true}).click();
  34 |     let dialog=page.getByRole('dialog');
  35 |     const dependency=dialog.getByRole('checkbox',{name:/归档前置任务（已归档）/});
  36 |     await expect(dependency).toBeChecked();await dependency.uncheck();
  37 |     await dialog.getByRole('button',{name:'保存修改'}).click();await expect(dialog).toHaveCount(0);
  38 |     expect(service.store.state.tasks.find(task=>task.id===dependent.id)!.dependencies).toEqual([]);
> 39 |     await page.getByLabel('已归档',{exact:true}).check();
     |                                               ^ Error: locator.check: Clicking the checkbox did not change its state
  40 |     await page.getByRole('button',{name:'归档前置任务',exact:true}).click();
  41 |     await expect(page.getByRole('region',{name:'任务详情'}).getByRole('button',{name:'重试',exact:true})).toHaveCount(0);
  42 |     await expect(page.getByRole('button',{name:'复制任务',exact:true})).toBeVisible();
  43 |     await page.getByLabel('已归档',{exact:true}).uncheck();
  44 |     await service.tick();const first=service.store.state.attempts.find(attempt=>attempt.taskId===dependent.id)!;
  45 |     await service.taskAction(dependent.id,{operation_id:randomUUID(),action:'record-conclusion',outcome:'failed',reason:'受控失败',evidence:'当前相同实例空闲',stopped:true});
  46 |     await page.getByRole('button',{name:'编辑依赖的任务',exact:true}).click();
  47 |     await expect(page.getByLabel('执行尝试',{exact:true})).toHaveValue(first.id);
  48 |     await page.getByRole('button',{name:'重试',exact:true}).click();
  49 |     await page.getByRole('button',{name:'确认重试任务',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  50 |     await service.tick();const second=service.store.state.attempts.find(attempt=>attempt.taskId===dependent.id&&attempt.id!==first.id)!;
  51 |     expect(second).toBeTruthy();
  52 |     await expect(page.getByLabel('执行尝试',{exact:true})).toHaveValue(second.id);
  53 |     await expect(page.getByRole('tabpanel')).toContainText('仍保留占用');
  54 |     await page.getByLabel('执行尝试',{exact:true}).selectOption(first.id);
  55 |     fake.setStatus('terminal-one','working');await service.refresh();
  56 |     await expect(page.getByLabel('执行尝试',{exact:true})).toHaveValue(first.id);
  57 |     await page.getByLabel('执行尝试',{exact:true}).selectOption(second.id);
  58 |     fake.setStatus('terminal-one','idle');await service.refresh();
  59 |     await page.getByRole('button',{name:'补录结论',exact:true}).click();dialog=page.getByRole('dialog');
  60 |     await dialog.getByLabel('补录原因').fill('先保存排查结论');await dialog.getByLabel('证据与核对过程').fill('尚未核实所有执行活动，保留占用');
  61 |     await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  62 |     await dialog.getByRole('button',{name:'确认人工补录结论',exact:true}).click();await expect(dialog).toHaveCount(0);
  63 |     expect(service.store.state.attempts.find(attempt=>attempt.id===second.id)).toMatchObject({source:'manual',occupies:true,phase:'needs_confirmation'});
  64 |     const newCwd=join(root,'unknown-start');fake.onStart=async()=>{throw new Error('controlled unknown startup');};
  65 |     const start=await service.start({operation_id:randomUUID(),projectId:project.id,type:'codex',cwd:newCwd,label:'待核对启动'});
  66 |     await expect.poll(()=>service.store.state.starts.find(row=>row.id===start.id)?.status).toBe('unknown');
  67 |     await page.getByRole('button',{name:'Agent',exact:true}).click();
  68 |     await page.getByRole('button',{name:'人工核对启动',exact:true}).click();dialog=page.getByRole('dialog');
  69 |     await dialog.getByLabel('启动核对证据').fill('原生窗格和进程均已核对，原启动未创建');
  70 |     await dialog.getByRole('button',{name:'保存核对并解除'}).click();
  71 |     await expect(dialog).toBeVisible();expect(service.store.state.starts[0]!.status).toBe('unknown');
  72 |     await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'保存核对并解除'}).click();await expect(dialog).toHaveCount(0);
  73 |     await expect(page.getByText('待核对启动 · 已由人工核对解除',{exact:true})).toBeVisible();
  74 |     expect(fake.starts).toHaveLength(1);expect(fake.interrupts).toEqual([]);
  75 |     await page.reload();await expect(page.getByText('待核对启动 · 已由人工核对解除',{exact:true})).toBeVisible();
  76 |     const db=new DatabaseSync(join(dataDir,'meteor-flow.sqlite'),{readOnly:true});
  77 |     try{
  78 |       const stored=JSON.parse(String(db.prepare('SELECT data FROM starts WHERE id=?').get(start.id)?.data));
  79 |       expect(stored).toMatchObject({status:'dismissed',resolution:{source:'manual',evidence:'原生窗格和进程均已核对，原启动未创建'}});
  80 |       expect(JSON.parse(String(db.prepare('SELECT data FROM attempts WHERE id=?').get(second.id)?.data))).toMatchObject({occupies:true,source:'manual'});
  81 |     }finally{db.close();}
  82 |     const evidence=process.env.METEOR_FLOW_E2E_EVIDENCE??'test-results/evidence';await mkdir(evidence,{recursive:true});
  83 |     await page.setViewportSize({width:390,height:844});
  84 |     expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  85 |     await page.screenshot({path:join(evidence,'web-recovery-mobile.png'),fullPage:true});
  86 |   }finally{await http?.app.close();await service.close();await rm(root,{recursive:true,force:true});}
  87 | });
  88 | 
```