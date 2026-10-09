import { test, expect, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { ConsoleSnapshot, CreateTask } from '@meteor-flow/contracts';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

// Deliberately simulated API evidence. Real server / herdr E2E is reported separately.
let server: Server;
let base: string;
const evidence = process.env.METEOR_FLOW_E2E_EVIDENCE ?? 'test-results/evidence';
test.beforeAll(async () => {
  const root = resolve('apps/web/dist');
  server = createServer(async (request, response) => {
    const path = resolve(root, `.${new URL(request.url!, 'http://127.0.0.1').pathname}`);
    if (path !== root && !path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    const file = path === root || !extname(path) ? resolve(root, 'index.html') : path;
    try { response.setHeader('content-type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' } as Record<string, string>)[extname(file)] ?? 'application/octet-stream'); response.end(await readFile(file)); }
    catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing isolated test port');
  base = `http://127.0.0.1:${address.port}`;
  await mkdir(evidence, { recursive: true });
});
test.afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

function fixture(): ConsoleSnapshot {
  return {
    projects: [{ id: 'p1', name: '检索实验', root: '/tmp/meteor-web-project', archived: false, createdAt: 1 }, { id: 'p2', name: '独立项目', root: '/tmp/meteor-web-other', archived: false, createdAt: 1 }],
    bindings: [{ id: 'b1', projectId: 'p1', session: 'test', terminalId: 'term1', label: '文档助手', type: 'codex', cwd: '/tmp/meteor-web-project/agent', fingerprint: 'fingerprint-one', agentSession: 'agent-session-one', mode: 'automatic', confirmed: true, managed: true, paused: false, reason: '', revision: 1, observation: { terminalId: 'term1', paneId: 'pane1', type: 'codex', status: 'idle', cwd: '/tmp/meteor-web-project/agent', agentSession: 'agent-session-one', pid: 10, processStart: 'start', sequence: 1, launchPending: false, interactiveReady: true, fingerprint: 'fingerprint-one', observedAt: Date.now() } }],
    tasks: [{ id: 't1', projectId: 'p1', bindingId: 'b1', title: '整理实验结果', instructions: '核对证据并整理结果', dependencies: [], requiredArtifacts: [], outputRoots: [], revision: 1, createdAt: Date.now(), order: 1, archived: false, currentAttemptId: null, phase: 'queued', reason: '等待依赖核对' }],
    attempts: [], artifacts: [], events: [], starts: [], jobs: [], discoveries: [],
    settings: { paused: true, concurrency: 2, session: 'test', revision: 1 },
    health: { storage: true, connected: true, version: '0.9.0', error: null, lastObservation: Date.now() }, generation: 'test-generation',
  };
}
async function api(page: Page, state = fixture()) {
  const writes: { path: string; body: Record<string, unknown>; csrf: string | undefined }[] = [];
  const control = { offline: false, failNextWrite: false, delayWrite: false, releaseWrite: () => {} };
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/auth') return route.fulfill({ json: { authenticated: true, csrf: 'test-csrf' } });
    if (url.pathname === '/api/v1/bootstrap') return route.fulfill({ json: { csrf: 'test-csrf' } });
    if (url.pathname === '/api/v1/events') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: snapshot\ndata: {"protocol":"meteor-flow.events/v1","type":"snapshot","sequence":0}\n\n' });
    if (url.pathname === '/api/v1/state') return control.offline ? route.abort('failed') : route.fulfill({ json: state });
    if (url.pathname === '/api/v1/sessions') return route.fulfill({ json: { sessions: [{ name: 'test', socketPath: '/tmp/web-only.sock' }] } });
    if (route.request().method() !== 'GET') {
      const body = route.request().postDataJSON();
      writes.push({ path: url.pathname, body, csrf: route.request().headers()['x-csrf-token'] });
      if (control.delayWrite) await new Promise<void>(resolve => { control.releaseWrite = resolve; });
      if (control.failNextWrite) { control.failNextWrite = false; return route.abort('failed'); }
      if (url.pathname === '/api/v1/tasks') {
        const { operation_id: _operation, ...fields } = body as CreateTask;
        state.tasks.push({ ...fields, id: 't-created', revision: 1, createdAt: Date.now(), order: 2, archived: false, currentAttemptId: null, phase: 'queued', reason: '模拟服务已保存' });
      }
      return route.fulfill({ json: { id: 'accepted' } });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'UNKNOWN', message: '未提供模拟接口' } } });
  });
  return { writes, state, control };
}

test('bootstrap fragment is removed and project filters remain URL-restorable', async ({ page }) => {
  await api(page);
  await page.goto(`${base}/?project=p1&q=整理#token=single-use-test`);
  await expect(page.getByRole('heading', { name: '任务', exact: true })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  await expect(page.getByLabel('搜索任务')).toHaveValue('整理');
  await page.getByLabel('当前项目').selectOption('p2');
  await expect(page.getByRole('button', { name: '整理实验结果' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('当前项目')).toHaveValue('p2');
  await expect(page.getByLabel('搜索任务')).toHaveValue('整理');
});

test('ambiguous task submit preserves fields and reuses operation ID with one accepted task', async ({ page }) => {
  const model = await api(page);
  await page.goto(base);
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('任务名称').fill('待确认响应的任务');
  await dialog.getByLabel('任务说明').fill('用于响应丢失的前端恢复验证');
  model.control.failNextWrite = true;
  await dialog.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('操作结果尚未确认');
  await expect(dialog.getByLabel('任务名称')).toHaveValue('待确认响应的任务');
  const saved = await page.evaluate(() => sessionStorage.getItem('meteor-flow.pending-operations.v1'));
  expect(Object.values(JSON.parse(saved!))).toEqual([model.writes[0].body.operation_id]);
  expect(saved).not.toContain('用于响应丢失');
  await page.reload();
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await dialog.getByLabel('任务名称').fill('待确认响应的任务');
  await dialog.getByLabel('任务说明').fill('用于响应丢失的前端恢复验证');
  await dialog.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: '待确认响应的任务', exact: true })).toBeVisible();
  expect(model.writes).toHaveLength(2);
  expect(model.writes[0].body.operation_id).toBe(model.writes[1].body.operation_id);
  expect(model.writes[0].csrf).toBe('test-csrf');
  expect(model.state.tasks.filter(task => task.id === 't-created')).toHaveLength(1);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('meteor-flow.pending-operations.v1') ?? '{}'))).toEqual({});
});

test('pending writes cannot duplicate and state failure preserves snapshot while disabling writes', async ({ page }) => {
  const model = await api(page);
  await page.goto(base);
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('任务名称').fill('单次操作');
  await dialog.getByLabel('任务说明').fill('并发点击不重复提交');
  model.control.delayWrite = true;
  await dialog.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '正在提交…' })).toBeDisabled();
  await expect.poll(() => model.writes.length).toBe(1);
  model.control.releaseWrite();
  await expect(dialog).toHaveCount(0);
  model.control.offline = true;
  await expect(page.getByText('状态已过期', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '整理实验结果', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '新建任务', exact: true })).toBeDisabled();
  model.control.offline = false;
  await page.getByRole('button', { name: '重新读取状态' }).click();
  await expect(page.getByRole('button', { name: '新建任务', exact: true })).toBeEnabled();
});

test('details keep attempt ownership and strip active Markdown and remote resources', async ({ page }) => {
  const state = fixture();
  state.tasks[0].phase = 'succeeded'; state.tasks[0].currentAttemptId = 'a2';
  for (const number of [1, 2]) state.attempts.push({ id: `a${number}`, taskId: 't1', bindingId: 'b1', number, phase: 'succeeded', reason: '', occupies: false, createdAt: number, submittedAt: number, endedAt: number, fingerprint: 'fingerprint-one', identity: { pid: 10, processStart: 'start', cwd: '/tmp/meteor-web-project/agent', agentSession: 'agent-session-one', type: 'codex' }, baselineSeq: 1, seenActivity: true, dispatch: 'submitted', cancelRequested: false, cancelAcceptedAt: null, attentionSince: null, remindedAt: null, input: { title: `执行 ${number}`, instructions: `第 ${number} 版冻结输入`, roots: [], requiredArtifacts: [], dependencies: [] }, result: { protocol: 'meteor-flow.result/v1', task_id: 't1', attempt_id: `a${number}`, outcome: 'succeeded', summary: `结果 ${number}\n<script>window.bad=1</script>\n![remote](https://invalid.example/track.png)\n<a href="javascript:alert(1)">danger</a>`, artifacts: [] }, resultHash: null, archiveId: null, source: 'agent', manualEvidence: null });
  await api(page, state);
  await page.goto(`${base}/?task=t1`);
  await page.getByRole('tab', { name: '结果与产物' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('结果 2');
  await expect(page.locator('.markdown img, .markdown script, .markdown a')).toHaveCount(0);
  await page.getByLabel('执行尝试').selectOption('a1');
  await expect(page.getByRole('tabpanel')).toContainText('结果 1');
  await page.getByRole('tab', { name: '冻结输入' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('第 1 版冻结输入');
});

test('Markdown image mapping respects attempt, root, frozen IDs, MIME and size boundaries', async ({ page }) => {
  const state = fixture();
  state.tasks[0].phase = 'succeeded'; state.tasks[0].currentAttemptId = 'a2';
  const summary = '![current](current.png) ![ambiguous](same.png) ![old](old.png) ![foreign](foreign.png) ![oversize](large.png) ![wrong MIME](text.png) ![escaped](../../escape.png) ![remote](https://invalid.example/image.png)';
  state.attempts.push({ id: 'a2', taskId: 't1', bindingId: 'b1', number: 2, phase: 'succeeded', reason: '', occupies: false, createdAt: 2, submittedAt: 2, endedAt: 2, fingerprint: 'fingerprint-one', identity: { pid: 10, processStart: 'start', cwd: '/tmp/meteor-web-project/agent', agentSession: 'agent-session-one', type: 'codex' }, baselineSeq: 1, seenActivity: true, dispatch: 'submitted', cancelRequested: false, cancelAcceptedAt: null, attentionSince: null, remindedAt: null, input: { title: '冻结范围', instructions: '只读选定归档', roots: [], requiredArtifacts: [], dependencies: [{ taskId: 'upstream', attemptId: 'upstream-old', summary: '![frozen](old.png) ![not frozen](secret.png) ![changed hash](changed.png)', artifacts: [{ id: 'frozen-id', sha256: 'frozen-hash', file: 'input.bin' }, { id: 'changed-id', sha256: 'previous-hash', file: 'changed.bin' }] }] }, result: { protocol: 'meteor-flow.result/v1', task_id: 't1', attempt_id: 'a2', outcome: 'succeeded', summary, artifacts: [] }, resultHash: null, archiveId: null, source: 'agent', manualEvidence: null });
  const artifact = (id: string, sourcePath: string, extra: Partial<ConsoleSnapshot['artifacts'][number]> = {}) => ({ id, taskId: 't1', attemptId: 'a2', label: sourcePath, rootId: 'workdir', sourcePath, archiveId: 'archive', file: `${id}.bin`, sha256: 'hash', size: 68, ...extra });
  state.artifacts.push(artifact('current-id', 'current.png'), artifact('ambiguous-one', 'same.png'), artifact('ambiguous-two', 'same.png', { rootId: 'reports' }), artifact('old-id', 'old.png', { attemptId: 'a1' }), artifact('foreign-id', 'foreign.png', { taskId: 'other-task' }), artifact('large-id', 'large.png', { size: 20 * 1024 * 1024 + 1 }), artifact('text-id', 'text.png'), artifact('frozen-id', 'old.png', { taskId: 'upstream', attemptId: 'upstream-old', sha256: 'frozen-hash' }), artifact('secret-id', 'secret.png', { taskId: 'upstream', attemptId: 'upstream-old' }), artifact('changed-id', 'changed.png', { taskId: 'upstream', attemptId: 'upstream-old', sha256: 'changed-hash' }));
  const model = await api(page, state);
  const requests: string[] = [];
  await page.route('**/api/v1/artifacts/*/content', route => {
    const id = new URL(route.request().url()).pathname.split('/')[4]; requests.push(id);
    return route.fulfill(id === 'text-id' ? { contentType: 'text/plain', body: '<svg onload="window.bad=true"></svg>' } : { contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=', 'base64') });
  });
  await page.goto(`${base}/?task=t1`);
  await page.getByRole('tab', { name: '结果与产物' }).click();
  const image = page.getByRole('tabpanel').getByRole('img', { name: 'current', exact: true });
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1);
  await expect(page.getByRole('tabpanel').locator('.markdown img')).toHaveCount(1);
  expect(requests.sort()).toEqual(['current-id', 'text-id']);
  for (const alt of ['ambiguous', 'old', 'foreign', 'oversize', 'wrong MIME', 'escaped', 'remote']) await expect(page.getByRole('tabpanel').locator('.markdown')).toContainText(alt);
  const url = await image.getAttribute('src');
  model.state.tasks[0].reason = '快照校准后保留图片';
  await expect(page.getByText('快照校准后保留图片', { exact: true }).first()).toBeVisible();
  await expect(image).toHaveAttribute('src', url!);
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1);
  await page.getByRole('tab', { name: '冻结输入' }).click();
  await page.getByText('upstream · upstream-old', { exact: true }).click();
  await expect.poll(() => page.getByRole('img', { name: 'frozen', exact: true }).evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1);
  expect(requests.sort()).toEqual(['current-id', 'frozen-id', 'text-id']);
  await expect(page.getByRole('tabpanel').locator('.markdown')).toContainText('not frozen');
  await expect(page.getByRole('tabpanel').locator('.markdown')).toContainText('changed hash');
  expect(await page.evaluate(async url => { try { await fetch(url!); return false; } catch { return true; } }, url)).toBe(true);
});

test('terminal observes without resize, takes a token lease and never replays input after disconnect', async ({ page }) => {
  await api(page);
  const frames: Record<string, unknown>[] = [];
  let peer: { send: (data: string) => void; close: () => void } | undefined;
  await page.routeWebSocket('**/api/v1/terminal/**', ws => {
    peer = ws;
    ws.onMessage(message => {
      const frame = JSON.parse(String(message)); frames.push(frame);
      if (frame.action === 'take') ws.send(JSON.stringify({ protocol: 'meteor-flow.terminal/v1', type: 'state', mode: 'control', token: 'lease-token', epoch: 3, message: '控制已授予，调度暂停' }));
    });
    ws.send(JSON.stringify({ protocol: 'meteor-flow.terminal/v1', type: 'state', mode: 'observe', epoch: 3, message: '只读观察' }));
    ws.send(JSON.stringify({ protocol: 'meteor-flow.terminal/v1', type: 'output', data: 'test terminal\r\n' }));
  });
  await page.goto(`${base}/?view=agents&terminal=b1`);
  await expect(page.getByRole('heading', { name: '文档助手 · 只读观察' })).toBeVisible();
  await expect(page.getByRole('button', { name: '接管输入' })).toBeEnabled();
  await page.setViewportSize({ width: 1100, height: 780 });
  expect(frames).toHaveLength(0);
  await page.getByRole('button', { name: '接管输入' }).click();
  await page.getByRole('button', { name: '确认接管' }).click();
  await expect(page.getByRole('heading', { name: '文档助手 · 输入控制中' })).toBeVisible();
  // xterm intentionally defers DOM rendering outside the viewport.
  await page.locator('.terminal-host').scrollIntoViewIfNeeded();
  peer!.send(JSON.stringify({ protocol: 'meteor-flow.terminal/v1', type: 'output', data: '\u001b[6n\u001b[?6n\u001b[c\u001b[>c\u001b[18t\u001b[?1$p\u001bP$qm\u001b\\\u001b]10;?\u0007\u001b]52;c;c2VjcmV0\u0007\u001b]8;;https://invalid.example\u001b\\link\u001b]8;;\u001b\\\r\nPARSER_SAFE' }));
  await expect(page.locator('.xterm-rows')).toContainText('PARSER_SAFE');
  expect(frames.filter(frame => frame.action === 'input')).toHaveLength(0);
  const input = page.locator('.xterm-helper-textarea');
  await input.focus(); await page.keyboard.type('echo test');
  await expect.poll(() => frames.filter(frame => frame.action === 'input').length).toBeGreaterThan(0);
  expect(frames.filter(frame => ['input','resize'].includes(String(frame.action))).every(frame => frame.token === 'lease-token' && frame.epoch === 3)).toBe(true);
  expect(frames.filter(frame => frame.action === 'input').map(frame => frame.text).join('')).toBe('echo test');
  peer!.close();
  await expect(page.getByRole('heading', { name: '文档助手 · 只读观察' })).toBeVisible();
  const count = frames.length;
  await page.keyboard.type('never replay');
  expect(frames.length).toBe(count);
  await page.getByRole('button', { name: '重新连接', exact: true }).click();
  await expect(page.getByRole('button', { name: '接管输入' })).toBeEnabled();
  expect(frames.length).toBe(count);
  peer!.send(JSON.stringify({ protocol: 'meteor-flow.terminal/v1', type: 'output', data: '界'.repeat(400000) }));
  await expect(page.getByText(/终端输出超过页面缓冲上限/)).toBeVisible();
  await expect(page.getByRole('button', { name: '接管输入' })).toBeDisabled();
});

test('storage outage exposes explicit emergency interrupt without changing task ownership', async ({ page }) => {
  const state = fixture(); state.health.storage = false; state.health.error = '隔离测试：存储不可写';
  await api(page, state);
  let interrupts = 0;
  await page.route('**/api/v1/bindings/b1/emergency-interrupt', async route => {
    interrupts++;
    expect(route.request().headers()['x-csrf-token']).toBe('test-csrf');
    await route.fulfill({ json: { persisted: false, message: '紧急中断未持久化，不解除占用' } });
  });
  await page.goto(`${base}/?view=agents`);
  await expect(page.getByRole('button', { name: '恢复存储' })).toBeVisible();
  await page.getByRole('button', { name: '紧急中断（未持久化）' }).click();
  await expect(page.getByRole('dialog')).toContainText('不解除执行占用');
  expect(interrupts).toBe(0);
  await page.getByRole('button', { name: '确认紧急中断' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('紧急中断未持久化，不解除占用', { exact: true })).toBeVisible();
  expect(interrupts).toBe(1);
  expect(state.tasks[0].phase).toBe('queued');
});

test('forms have keyboard focus and layout survives narrow viewport and 200 percent text', async ({ page }) => {
  await api(page);
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto(base);
  await expect(page.getByRole('button', { name: '整理实验结果' })).toBeVisible();
  await page.screenshot({ path: `${evidence}/web-desktop.png`, fullPage: true });
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('任务名称')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const trigger = page.getByRole('button', { name: '新建任务', exact: true });
  await expect(trigger).toBeFocused();
  for (const close of ['取消', '关闭对话框']) {
    await trigger.click();
    await page.getByRole('dialog').getByRole('button', { name: close, exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  await trigger.click();
  await page.getByLabel('任务名称').fill('焦点恢复检查');
  await page.getByLabel('任务说明').fill('成功提交后回到新建按钮');
  await page.getByRole('dialog').getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '整理实验结果', exact: true }).click();
  const heading = page.getByRole('heading', { name: '整理实验结果', exact: true });
  await expect(heading).toBeFocused();
  const bounds = await heading.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThan(844);
  await page.screenshot({ path: `${evidence}/web-refinement-narrow-detail.png` });
  await writeFile(`${evidence}/web-refinement-focus.json`, JSON.stringify({ viewport: '390×844', selectedHeading: bounds, focusedHeading: await heading.evaluate(element => document.activeElement === element), modalReturnPaths: ['Escape', '取消', '关闭对话框', '成功提交'] }, null, 2));
  await page.getByRole('button', { name: '关闭任务详情' }).click();
  await expect(page.getByRole('button', { name: '整理实验结果', exact: true })).toBeFocused();
  await page.screenshot({ path: `${evidence}/web-narrow.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.addStyleTag({ content: 'html { font-size: 28px !important }' });
  await page.screenshot({ path: `${evidence}/web-text-200.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('terminal rejects unknown protocol and malformed control without granting input', async ({ page }) => {
  await api(page);
  const frames: unknown[] = [];
  let peer: { send: (data: string) => void } | undefined;
  await page.routeWebSocket('**/api/v1/terminal/**', ws => {
    peer = ws; ws.onMessage(message => frames.push(JSON.parse(String(message))));
    ws.send(JSON.stringify({ protocol: 'meteor-flow.terminal/v1', type: 'state', mode: 'observe', epoch: 0, message: '观察' }));
  });
  await page.goto(`${base}/?view=agents&terminal=b1`);
  await expect(page.getByRole('button', { name: '接管输入' })).toBeEnabled();
  peer!.send(JSON.stringify({ protocol: 'meteor-flow.terminal/v2', type: 'state', mode: 'control', token: 'wrong', epoch: 1, message: '不可授予' }));
  await expect(page.getByText(/终端消息版本或字段不受支持/)).toBeVisible();
  await expect(page.getByRole('heading', { name: '文档助手 · 只读观察' })).toBeVisible();
  expect(frames).toHaveLength(0);
  await page.getByRole('button', { name: '重新连接', exact: true }).click();
  await expect(page.getByRole('button', { name: '接管输入' })).toBeEnabled();
  peer!.send(JSON.stringify({ protocol: 'meteor-flow.terminal/v1', type: 'state', mode: 'control', token: '', epoch: 0, message: '不可授予' }));
  await expect(page.getByRole('button', { name: '接管输入' })).toBeDisabled();
  expect(frames).toHaveLength(0);
  for (const invalid of [
    { type: 'state', mode: 'control', token: 'missing-protocol', epoch: 1, message: 'missing' },
    { protocol: 'meteor-flow.terminal/v1', type: 'unrecognized', message: 'unknown' },
  ]) {
    await page.getByRole('button', { name: '重新连接', exact: true }).click();
    await expect(page.getByRole('button', { name: '接管输入' })).toBeEnabled();
    peer!.send(JSON.stringify(invalid));
    await expect(page.getByRole('button', { name: '接管输入' })).toBeDisabled();
    expect(frames).toHaveLength(0);
  }
  await page.getByRole('button', { name: '重新连接', exact: true }).click();
  await expect(page.getByRole('button', { name: '接管输入' })).toBeEnabled();
  peer!.send(JSON.stringify({ protocol: 'meteor-flow.terminal/v1', type: 'state', mode: 'observe', epoch: 4, message: '新的连接代' }));
  await expect(page.getByText(/新的连接代/)).toBeVisible();
  peer!.send(JSON.stringify({ protocol: 'meteor-flow.terminal/v1', type: 'state', mode: 'control', token: 'old', epoch: 3, message: '过期控制代' }));
  await expect(page.getByRole('button', { name: '接管输入' })).toBeDisabled();
  expect(frames).toHaveLength(0);
});

test('unknown event protocol closes stream while snapshot calibration remains usable', async ({ page }) => {
  await api(page);
  let requests = 0;
  await page.route('**/api/v1/events', route => { requests++; return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: snapshot\ndata: {"protocol":"meteor-flow.events/v9","type":"snapshot","sequence":0}\n\n' }); });
  await page.goto(base);
  await expect(page.getByText(/实时通知的协议版本或字段不受支持/)).toBeVisible();
  await expect(page.getByRole('button', { name: '新建任务', exact: true })).toBeEnabled();
  expect(requests).toBe(1);
});

test('narrow touch controls have 44px targets and the task table responds to a swipe', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  try {
    await api(page); await page.goto(base);
    const task = page.getByRole('button', { name: '整理实验结果', exact: true });
    await task.scrollIntoViewIfNeeded();
    expect((await task.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await task.tap();
    await expect(page.getByRole('heading', { name: '整理实验结果', exact: true })).toBeFocused();
    const close = page.getByRole('button', { name: '关闭任务详情' });
    const target = (await close.boundingBox())!;
    expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44);
    await close.tap();
    const table = page.locator('.table-wrap'); await table.scrollIntoViewIfNeeded();
    const bounds = (await table.boundingBox())!;
    const y = Math.min(800, bounds.y + bounds.height / 2);
    const session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 330, y }] });
    for (let x = 310; x >= 90; x -= 20) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => table.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    await session.detach();
  } finally { await context.close(); }
});

test('definitive rejection removes pending operation so a corrected operation can proceed', async ({ page }) => {
  await api(page);
  let operation: string | undefined;
  await page.route('**/api/v1/tasks', async route => { operation = route.request().postDataJSON().operation_id; await route.fulfill({ status: 409, json: { error: { code: 'BINDING', message: '所选 Agent 已变化，请重新核对。' } } }); });
  await page.goto(base);
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByLabel('任务名称').fill('拒绝的任务');
  await page.getByLabel('任务说明').fill('明确失败可清除标识');
  await page.getByRole('dialog').getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Agent 已变化');
  expect(operation).toBeTruthy();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('meteor-flow.pending-operations.v1') ?? '{}'))).toEqual({});
});
