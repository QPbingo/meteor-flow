# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/e2e/web-server.spec.ts >> browser creates project, confirms agent, completes a file task and reads durable evidence
- Location: tests/e2e/web-server.spec.ts:13:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('全局调度已暂停。已开始的执行继续运行；在调度设置中核对后恢复。', { exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText('全局调度已暂停。已开始的执行继续运行；在调度设置中核对后恢复。', { exact: true }) with timeout 5000ms
  - waiting for getByText('全局调度已暂停。已开始的执行继续运行；在调度设置中核对后恢复。', { exact: true })

```

```yaml
- link "跳到主要内容":
  - /url: "#main"
- complementary:
  - strong: Meteor Flow
  - paragraph: 本地 Agent 控制台
  - text: 当前项目
  - combobox "当前项目":
    - option "尚无项目" [selected]
  - button "创建项目"
  - navigation "主导航":
    - button "任务"
    - button "Agent"
  - text: HERDR SESSION
  - strong: meteor-flow-web-e2e
  - button "选择 / 切换会话"
  - text: herdr 0.9.3
- banner:
  - strong: 本地连接正常
  - text: 最后观测 10/07 10:29:45 并行上限 2
  - button "调度设置"
  - button "暂停调度"
- main:
  - heading "建立你的第一个项目" [level=2]
  - paragraph: 按会话 → 项目 → Agent → 任务开始。项目用于归属工作目录、输入与执行结果。
  - button "选择 herdr 会话"
  - button "创建项目"
- contentinfo: 任务由本地服务管理。关闭此页面不会取消执行。
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | import { mkdtemp, mkdir, readFile, writeFile, rename, rm, realpath } from 'node:fs/promises';
  3   | import { tmpdir } from 'node:os';
  4   | import { join, resolve } from 'node:path';
  5   | import { DatabaseSync } from 'node:sqlite';
  6   | import { randomUUID } from 'node:crypto';
  7   | import { AgentConsole } from '../../apps/server/dist/application/console.js';
  8   | import { createServer } from '../../apps/server/dist/http/server.js';
  9   | import { FakeHerdr } from '../fixtures/fake-herdr.js';
  10  | 
  11  | // Real UI + HTTP + scheduler + worker database + collector/filesystem.
  12  | // Only the external herdr/agent boundary is simulated; this is not real-agent E2E.
  13  | test('browser creates project, confirms agent, completes a file task and reads durable evidence', async ({ page }) => {
  14  |   test.setTimeout(45000);
  15  |   const root = await realpath(await mkdtemp(join(tmpdir(), 'meteor-flow-web-e2e-')));
  16  |   const dataDir = join(root, 'data'); const projectDir = join(root, 'project'); const cwd = join(projectDir, 'agent');
  17  |   await mkdir(dataDir); await mkdir(cwd, { recursive: true });
  18  |   const fake = new FakeHerdr({ session: 'meteor-flow-web-e2e', agents: [{ terminalId: 'terminal-one', cwd, type: 'codex' }] });
  19  |   const service = new AgentConsole({ dataDir, session: fake.session, executable: '/unused-herdr', portFactory: () => fake, pollMs: 100, minFreeBytes: 0 });
  20  |   let http: Awaited<ReturnType<typeof createServer>> | undefined;
  21  |   try {
  22  |     await service.open();
  23  |     http = await createServer(service, { port: 0, webRoot: resolve('apps/web/dist'), listSessions: async () => [{ name: fake.session, socketPath: '/isolated-test-only.sock' }] });
  24  |     const entry = JSON.parse(await readFile(join(dataDir, 'open.json'), 'utf8')) as { url: string };
  25  |     await page.goto(entry.url);
  26  |     await expect(page.getByRole('heading', { name: '建立你的第一个项目' })).toBeVisible();
  27  |     // Remove polling from this interval: the next visible update must come through SSE.
  28  |     await page.clock.install();
  29  |     await page.clock.pauseAt(new Date(Date.now() + 100));
  30  |     const started = performance.now();
  31  |     await service.settings({ operation_id: randomUUID(), paused: true, concurrency: 2 });
> 32  |     await expect(page.getByText('全局调度已暂停。已开始的执行继续运行；在调度设置中核对后恢复。', { exact: true })).toBeVisible();
      |                                                                                      ^ Error: expect(locator).toBeVisible() failed
  33  |     const latency = performance.now() - started;
  34  |     expect(latency).toBeLessThan(1000);
  35  |     await writeFile('tasks/001-local-agent-console/verification-runs/20261007-implementation-preflight/web-sse-latency.json', JSON.stringify({ scope: 'real Console/SQLite/HTTP SSE + browser, fake herdr boundary', latencyMs: latency, pollingClockPaused: true, samples: 1, note: '单次功能测量，不是 p95 性能结论' }, null, 2));
  36  |     await service.settings({ operation_id: randomUUID(), paused: false, concurrency: 2 });
  37  |     await page.clock.resume();
  38  |     expect(new URL(page.url()).hash).toBe('');
  39  |     await page.getByRole('button', { name: '创建项目', exact: true }).first().click();
  40  |     let dialog = page.getByRole('dialog');
  41  |     await dialog.getByLabel('项目名称').fill('浏览器集成项目');
  42  |     await dialog.getByLabel('项目根目录').fill(projectDir);
  43  |     // Lose an actual successful server response, then retry the same UI operation.
  44  |     await page.route('**/api/v1/projects', async route => { const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort('failed'); }, { times: 1 });
  45  |     await dialog.getByRole('button', { name: '创建项目', exact: true }).click();
  46  |     await expect(dialog.getByRole('alert')).toContainText('操作结果尚未确认');
  47  |     await page.reload();
  48  |     await page.getByRole('button', { name: '创建项目', exact: true }).first().click();
  49  |     await dialog.getByLabel('项目名称').fill('浏览器集成项目');
  50  |     await dialog.getByLabel('项目根目录').fill(projectDir);
  51  |     await dialog.getByRole('button', { name: '创建项目', exact: true }).click();
  52  |     await expect(dialog).toHaveCount(0);
  53  |     expect(service.store.state.projects).toHaveLength(1);
  54  |     await page.getByRole('button', { name: 'Agent', exact: true }).click();
  55  |     await page.getByRole('button', { name: '以观察模式接入' }).click();
  56  |     await expect.poll(() => service.store.state.bindings.length).toBe(1);
  57  |     expect(service.store.state.bindings[0].mode).toBe('observe');
  58  |     await page.getByRole('button', { name: '确认接入', exact: true }).click();
  59  |     dialog = page.getByRole('dialog');
  60  |     await dialog.getByLabel('我已核对目录、项目及独立会话归属，且当前没有未完成工作').check();
  61  |     await dialog.getByLabel('此 Agent 可接受任务，并能按约定结果协议提交摘要及产物').check();
  62  |     await dialog.getByRole('button', { name: '确认接入', exact: true }).click();
  63  |     await expect(dialog).toHaveCount(0);
  64  |     await page.getByRole('button', { name: '自动调度', exact: true }).click();
  65  |     await page.getByRole('button', { name: '确认启用自动调度' }).click();
  66  |     await expect(page.getByRole('dialog')).toHaveCount(0);
  67  |     expect(service.store.state.bindings[0].mode).toBe('automatic');
  68  |     await page.getByRole('button', { name: '任务', exact: true }).click();
  69  |     await page.getByRole('button', { name: '新建任务', exact: true }).click();
  70  |     dialog = page.getByRole('dialog');
  71  |     await dialog.getByLabel('任务名称').fill('交付隔离测试报告');
  72  |     await dialog.getByLabel('任务说明').fill('生成一份 report.txt，并提交明确结果。');
  73  |     await dialog.getByText('结果要求与额外输出范围', { exact: true }).click();
  74  |     await dialog.getByLabel('必要产物', { exact: true }).fill('report.txt');
  75  |     await dialog.getByRole('button', { name: '创建任务', exact: true }).click();
  76  |     await expect(dialog).toHaveCount(0);
  77  |     await expect.poll(() => fake.prompts.length).toBe(1);
  78  |     const task = service.store.state.tasks[0];
  79  |     await expect.poll(() => service.store.state.attempts[0]?.dispatch).toBe('submitted');
  80  |     const attemptId = service.store.state.attempts[0].id;
  81  |     fake.setStatus('terminal-one', 'working', true);
  82  |     await expect.poll(() => service.store.state.attempts[0].seenActivity).toBe(true);
  83  |     const input = JSON.parse(await readFile(join(cwd, '.meteor-flow', 'runs', attemptId, 'input.json'), 'utf8'));
  84  |     expect(input.title).toBe(task.title);
  85  |     await writeFile(join(cwd, 'report.txt'), '隔离浏览器测试的归档证据\n');
  86  |     await writeFile(join(cwd, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=', 'base64'));
  87  |     await writeFile(join(cwd, 'report.md'), '# 归档 Markdown\n安全摘要\n![远程图片](https://invalid.example/image.png)\n<script>window.bad=true</script>');
  88  |     await writeFile(join(cwd, 'report.json'), '{"answer":42,"message":"隔离归档"}');
  89  |     const resultDir = join(cwd, '.meteor-flow', 'runs', attemptId);
  90  |     await writeFile(join(resultDir, 'result.tmp'), JSON.stringify({ protocol: 'meteor-flow.result/v1', task_id: task.id, attempt_id: attemptId, outcome: 'succeeded', summary: '已交付测试报告。', artifacts: ['report.txt', 'pixel.png', 'report.md', 'report.json'].map(path => ({ root_id: 'workdir', path, label: path })) }));
  91  |     await rename(join(resultDir, 'result.tmp'), join(resultDir, 'result.json'));
  92  |     fake.setStatus('terminal-one', 'idle', true);
  93  |     await expect.poll(() => service.store.state.tasks[0].phase, { timeout: 15000 }).toBe('succeeded');
  94  |     await page.getByRole('button', { name: '交付隔离测试报告', exact: true }).click();
  95  |     await page.getByRole('tab', { name: '结果与产物' }).click();
  96  |     await expect(page.getByRole('tabpanel')).toContainText('已交付测试报告。');
  97  |     await page.getByRole('button', { name: 'report.txt', exact: true }).click();
  98  |     await expect(page.getByRole('dialog').locator('pre')).toContainText('隔离浏览器测试的归档证据');
  99  |     await page.getByRole('button', { name: '关闭对话框' }).click();
  100 |     const external: string[] = []; const csp: string[] = [];
  101 |     page.on('request', request => { if (request.url().startsWith('https://invalid.example/')) external.push(request.url()); });
  102 |     page.on('console', message => { if (/Content Security Policy|violates.*directive/i.test(message.text())) csp.push(message.text()); });
  103 |     await page.getByRole('button', { name: 'pixel.png', exact: true }).click();
  104 |     const image = page.getByRole('dialog').getByRole('img', { name: 'pixel.png', exact: true });
  105 |     await expect(image).toBeVisible();
  106 |     await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1);
  107 |     const imageUrl = await image.getAttribute('src');
  108 |     expect(imageUrl).toMatch(/^blob:http:\/\/127\.0\.0\.1:/);
  109 |     expect(csp).toEqual([]);
  110 |     await page.getByRole('button', { name: '关闭对话框' }).click();
  111 |     expect(await page.evaluate(async url => { try { await fetch(url!); return false; } catch { return true; } }, imageUrl)).toBe(true);
  112 |     await page.getByRole('button', { name: 'report.md', exact: true }).click();
  113 |     await expect(page.getByRole('dialog').getByRole('heading', { name: '归档 Markdown' })).toBeVisible();
  114 |     await expect(page.getByRole('dialog').locator('.markdown img, .markdown script')).toHaveCount(0);
  115 |     expect(external).toEqual([]);
  116 |     await page.getByRole('button', { name: '关闭对话框' }).click();
  117 |     await page.getByRole('button', { name: 'report.json', exact: true }).click();
  118 |     await expect(page.getByRole('dialog').locator('pre')).toHaveText('{\n  "answer": 42,\n  "message": "隔离归档"\n}');
  119 |     await page.getByRole('button', { name: '关闭对话框' }).click();
  120 |     await page.reload();
  121 |     await expect(page.getByRole('region', { name: '任务详情' })).toContainText('已成功');
  122 |     const db = new DatabaseSync(join(dataDir, 'meteor-flow.sqlite'), { readOnly: true });
  123 |     try {
  124 |       expect(db.prepare('SELECT count(*) AS count FROM projects').get()?.count).toBe(1);
  125 |       expect(db.prepare('SELECT count(*) AS count FROM tasks').get()?.count).toBe(1);
  126 |       const stored = db.prepare('SELECT data FROM attempts WHERE id=?').get(attemptId);
  127 |       expect(JSON.parse(String(stored?.data))).toMatchObject({ taskId: task.id, phase: 'succeeded', occupies: false });
  128 |       expect(db.prepare('SELECT task_id,attempt_id FROM artifacts').get()).toMatchObject({ task_id: task.id, attempt_id: attemptId });
  129 |     } finally { db.close(); }
  130 |     expect(fake.prompts).toHaveLength(1);
  131 |     await page.screenshot({ path: 'tasks/001-local-agent-console/verification-runs/20261007-implementation-preflight/web-real-service.png', fullPage: true });
  132 |   } finally {
```