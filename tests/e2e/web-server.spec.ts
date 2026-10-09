import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rename, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { AgentConsole } from '../../apps/server/dist/application/console.js';
import { createServer } from '../../apps/server/dist/http/server.js';
import { FakeHerdr } from '../fixtures/fake-herdr.js';
const evidence = process.env.METEOR_FLOW_E2E_EVIDENCE ?? 'test-results/evidence';

// Real UI + HTTP + scheduler + worker database + collector/filesystem.
// Only the external herdr/agent boundary is simulated; this is not real-agent E2E.
test('browser creates project, confirms agent, completes a file task and reads durable evidence', async ({ page }) => {
  test.setTimeout(45000);
  await mkdir(evidence, { recursive: true });
  const root = await realpath(await mkdtemp(join(tmpdir(), 'meteor-flow-web-e2e-')));
  const dataDir = join(root, 'data'); const projectDir = join(root, 'project'); const cwd = join(projectDir, 'agent');
  await mkdir(dataDir); await mkdir(cwd, { recursive: true });
  const fake = new FakeHerdr({ session: 'meteor-flow-web-e2e', agents: [{ terminalId: 'terminal-one', cwd, type: 'codex' }] });
  const service = new AgentConsole({ dataDir, session: fake.session, executable: '/unused-herdr', portFactory: () => fake, pollMs: 100, minFreeBytes: 0 });
  let http: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    await service.open();
    http = await createServer(service, { port: 0, webRoot: resolve('apps/web/dist'), listSessions: async () => [{ name: fake.session, socketPath: '/isolated-test-only.sock' }] });
    const entry = JSON.parse(await readFile(join(dataDir, 'open.json'), 'utf8')) as { url: string };
    await page.addInitScript(() => {
      const interval = window.setInterval;
      window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => interval(handler, timeout === 1000 ? 60000 : timeout, ...args)) as typeof window.setInterval;
      const Source = window.EventSource;
      window.EventSource = class extends Source {
        constructor(url: string | URL, options?: EventSourceInit) {
          super(url, options);
          this.addEventListener('snapshot', () => { document.documentElement.dataset.testSseSnapshot = 'received'; });
          this.addEventListener('change', event => { document.documentElement.dataset.testSseSequence = String(JSON.parse(event.data).sequence); });
        }
      };
    });
    await page.goto(entry.url);
    await expect(page.getByRole('heading', { name: '建立你的第一个项目' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.testSseSnapshot)).toBe('received');
    // Polling is disabled during sampling. Measure an upper bound starting
    // before commit and ending after the matching UI has crossed a paint frame.
    const samples: Array<{ latencyMs: number; sequence: number; paused: boolean }> = [];
    for (let index = 0; index < 30; index++) {
      const paused = index % 2 === 0;
      const started = performance.now();
      await service.settings({ operation_id: randomUUID(), paused, concurrency: 2 });
      const sequence = service.store.state.events.at(-1)!.seq;
      await expect(page.getByRole('button', { name: paused ? '全局已暂停' : '暂停调度', exact: true })).toBeVisible();
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      expect(Number(await page.evaluate(() => document.documentElement.dataset.testSseSequence))).toBeGreaterThanOrEqual(sequence);
      samples.push({ latencyMs: performance.now() - started, sequence, paused });
    }
    const p95Ms = samples.map(row => row.latencyMs).sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1]!;
    await writeFile(join(evidence, 'web-sse-latency.json'), JSON.stringify({ scope: 'real Console/SQLite/HTTP SSE + browser, fake herdr boundary; unloaded local service', p95Ms, samples, pollingIntervalOverriddenToMs: 60000, note: '30次交替状态：命令调用前到匹配UI可见并经过绘制帧，包含持久化耗时，是落库到可见耗时的保守上界；非双终端负载下的UI性能结论' }, null, 2));
    expect(p95Ms).toBeLessThan(1000);
    expect(new URL(page.url()).hash).toBe('');
    await page.getByRole('button', { name: '创建项目', exact: true }).first().click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('项目名称').fill('浏览器集成项目');
    await dialog.getByLabel('项目根目录').fill(join(root, 'does-not-exist'));
    await dialog.getByRole('button', { name: '创建项目', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('此目录不存在。请先创建目录，或填写现有目录的绝对路径');
    await expect(dialog.getByLabel('项目名称')).toHaveValue('浏览器集成项目');
    await expect(dialog.getByLabel('项目根目录')).toHaveValue(join(root, 'does-not-exist'));
    expect(service.store.state.projects).toHaveLength(0);
    await dialog.getByLabel('项目根目录').fill(projectDir);
    // Lose an actual successful server response, then retry the same UI operation.
    await page.route('**/api/v1/projects', async route => { const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort('failed'); }, { times: 1 });
    await dialog.getByRole('button', { name: '创建项目', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('操作结果尚未确认');
    await page.reload();
    await page.getByRole('button', { name: '创建项目', exact: true }).first().click();
    await dialog.getByLabel('项目名称').fill('浏览器集成项目');
    await dialog.getByLabel('项目根目录').fill(projectDir);
    await dialog.getByRole('button', { name: '创建项目', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(service.store.state.projects).toHaveLength(1);
    await page.getByRole('button', { name: 'Agent', exact: true }).click();
    await page.getByRole('button', { name: '以观察模式接入' }).click();
    await expect.poll(() => service.store.state.bindings.length).toBe(1);
    expect(service.store.state.bindings[0].mode).toBe('observe');
    await page.getByRole('button', { name: '确认接入', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('我已核对目录、项目及独立会话归属，且当前没有未完成工作').check();
    await dialog.getByLabel('此 Agent 可接受任务，并能按约定结果协议提交摘要及产物').check();
    await dialog.getByRole('button', { name: '确认接入', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: '自动调度', exact: true }).click();
    await page.getByRole('button', { name: '确认启用自动调度' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(service.store.state.bindings[0].mode).toBe('automatic');
    await page.getByRole('button', { name: '任务', exact: true }).click();
    await page.getByRole('button', { name: '新建任务', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('任务名称').fill('交付隔离测试报告');
    await dialog.getByLabel('任务说明').fill('生成一份 report.txt，并提交明确结果。');
    await dialog.getByText('结果要求与额外输出范围', { exact: true }).click();
    await dialog.getByLabel('必要产物', { exact: true }).fill('report.txt');
    await dialog.getByRole('button', { name: '创建任务', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => fake.prompts.length).toBe(1);
    const task = service.store.state.tasks[0];
    await expect.poll(() => service.store.state.attempts[0]?.dispatch).toBe('submitted');
    const attemptId = service.store.state.attempts[0].id;
    fake.setStatus('terminal-one', 'working', true);
    await expect.poll(() => service.store.state.attempts[0].seenActivity).toBe(true);
    const input = JSON.parse(await readFile(join(cwd, '.meteor-flow', 'runs', attemptId, 'input.json'), 'utf8'));
    expect(input.title).toBe(task.title);
    await writeFile(join(cwd, 'report.txt'), '隔离浏览器测试的归档证据\n');
    await writeFile(join(cwd, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=', 'base64'));
    await mkdir(join(cwd, 'docs'));
    await writeFile(join(cwd, 'docs/report.md'), '# 归档 Markdown\n\n安全摘要\n\n![内嵌归档图片](../pixel.png)\n\n![远程图片](https://invalid.example/image.png)\n\n[主动打开文档](https://invalid.example/docs)\n\n[脚本链接](javascript:alert%281%29) [数据链接](data:text/html,unsafe) [文件链接](file:///tmp/secret) [自定义协议](custom:unsafe)\n\n<img src="https://invalid.example/raw.png" onerror="window.bad=true"><a href="https://invalid.example/raw">原始HTML链接</a><script>window.bad=true</script>');
    await writeFile(join(cwd, 'report.json'), '{"answer":42,"message":"隔离归档"}');
    const resultDir = join(cwd, '.meteor-flow', 'runs', attemptId);
    await writeFile(join(resultDir, 'result.tmp'), JSON.stringify({ protocol: 'meteor-flow.result/v1', task_id: task.id, attempt_id: attemptId, outcome: 'succeeded', summary: '已交付测试报告。\n\n![归档结果图片](pixel.png)', artifacts: ['report.txt', 'pixel.png', 'docs/report.md', 'report.json'].map(path => ({ root_id: 'workdir', path, label: path })) }));
    await rename(join(resultDir, 'result.tmp'), join(resultDir, 'result.json'));
    fake.setStatus('terminal-one', 'idle', true);
    await expect.poll(() => service.store.state.tasks[0].phase, { timeout: 15000 }).toBe('succeeded');
    await page.getByRole('button', { name: '交付隔离测试报告', exact: true }).click();
    await page.getByRole('tab', { name: '结果与产物' }).click();
    await expect(page.getByRole('tabpanel')).toContainText('已交付测试报告。');
    await expect.poll(() => page.getByRole('img', { name: '归档结果图片' }).evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1);
    await page.getByRole('button', { name: 'report.txt', exact: true }).click();
    await expect(page.getByRole('dialog').locator('pre')).toContainText('隔离浏览器测试的归档证据');
    await page.getByRole('button', { name: '关闭对话框' }).click();
    const external: string[] = []; const csp: string[] = [];
    page.on('request', request => { if (request.url().startsWith('https://invalid.example/')) external.push(request.url()); });
    page.on('console', message => { if (/Content Security Policy|violates.*directive/i.test(message.text())) csp.push(message.text()); });
    await page.getByRole('button', { name: 'pixel.png', exact: true }).click();
    const image = page.getByRole('dialog').getByRole('img', { name: 'pixel.png', exact: true });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1);
    const imageUrl = await image.getAttribute('src');
    expect(imageUrl).toMatch(/^blob:http:\/\/127\.0\.0\.1:/);
    expect(csp).toEqual([]);
    await page.screenshot({ path: join(evidence, 'web-refinement-image-preview.png') });
    await page.getByRole('button', { name: '关闭对话框' }).click();
    await expect(page.getByRole('button', { name: 'pixel.png', exact: true })).toBeFocused();
    expect(await page.evaluate(async url => { try { await fetch(url!); return false; } catch { return true; } }, imageUrl)).toBe(true);
    await page.getByRole('button', { name: 'docs/report.md', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: '归档 Markdown' })).toBeVisible();
    const inlineImage = page.getByRole('dialog').getByRole('img', { name: '内嵌归档图片' });
    await expect.poll(() => inlineImage.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1);
    const inlineUrl = await inlineImage.getAttribute('src');
    expect(inlineUrl).toMatch(/^blob:http:\/\/127\.0\.0\.1:/);
    const link = page.getByRole('dialog').getByRole('link', { name: '主动打开文档' });
    await expect(link).toHaveAttribute('href', 'https://invalid.example/docs');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
    await expect(page.getByRole('dialog').locator('.markdown a')).toHaveCount(1);
    await expect(page.getByRole('dialog').locator('.markdown img')).toHaveCount(1);
    await expect(page.getByRole('dialog').locator('.markdown script, .markdown [onerror]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as Window & { bad?: boolean }).bad)).toBeUndefined();
    expect(external).toEqual([]);
    await page.screenshot({ path: join(evidence, 'web-f01-markdown.png') });
    // The destination is intercepted locally; no real external connection is made.
    await page.context().route('https://invalid.example/docs', route => route.fulfill({ contentType: 'text/plain', body: 'explicit click only' }));
    const opened = page.waitForEvent('popup');
    await link.click();
    const destination = await opened;
    await destination.waitForLoadState();
    expect(destination.url()).toBe('https://invalid.example/docs');
    expect(await destination.evaluate(() => window.opener)).toBeNull();
    await destination.close();
    await page.getByRole('button', { name: '关闭对话框' }).click();
    expect(await page.evaluate(async url => { try { await fetch(url!); return false; } catch { return true; } }, inlineUrl)).toBe(true);
    await page.getByRole('button', { name: 'report.json', exact: true }).click();
    await expect(page.getByRole('dialog').locator('pre')).toHaveText('{\n  "answer": 42,\n  "message": "隔离归档"\n}');
    await page.getByRole('button', { name: '关闭对话框' }).click();
    await page.reload();
    await expect(page.getByRole('region', { name: '任务详情' })).toContainText('已成功');
    const db = new DatabaseSync(join(dataDir, 'meteor-flow.sqlite'), { readOnly: true });
    try {
      expect(db.prepare('SELECT count(*) AS count FROM projects').get()?.count).toBe(1);
      expect(db.prepare('SELECT count(*) AS count FROM tasks').get()?.count).toBe(1);
      const stored = db.prepare('SELECT data FROM attempts WHERE id=?').get(attemptId);
      expect(JSON.parse(String(stored?.data))).toMatchObject({ taskId: task.id, phase: 'succeeded', occupies: false });
      expect(db.prepare('SELECT task_id,attempt_id FROM artifacts').get()).toMatchObject({ task_id: task.id, attempt_id: attemptId });
    } finally { db.close(); }
    expect(fake.prompts).toHaveLength(1);
    await page.screenshot({ path: join(evidence, 'web-real-service.png'), fullPage: true });
  } finally {
    await http?.app.close(); await service.close(); await rm(root, { recursive: true, force: true });
  }
});
