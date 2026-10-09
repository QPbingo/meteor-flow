# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/e2e/web-console.spec.ts >> terminal observes without resize, takes a token lease and never replays input after disconnect
- Location: tests/e2e/web-console.spec.ts:142:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.xterm-rows')
Expected substring: "PARSER_SAFE"
Received string:    "test terminal "
Timeout: 5000ms

Call log:
  - Expect "toContainText" locator('.xterm-rows') with timeout 5000ms
  - waiting for locator('.xterm-rows')
    14 × locator resolved to <div class="xterm-rows" aria-hidden="true">…</div>
       - unexpected value "test terminal "

```

# Test source

```ts
  64  | test('bootstrap fragment is removed and project filters remain URL-restorable', async ({ page }) => {
  65  |   await api(page);
  66  |   await page.goto(`${base}/?project=p1&q=整理#token=single-use-test`);
  67  |   await expect(page.getByRole('heading', { name: '任务', exact: true })).toBeVisible();
  68  |   expect(new URL(page.url()).hash).toBe('');
  69  |   await expect(page.getByLabel('搜索任务')).toHaveValue('整理');
  70  |   await page.getByLabel('当前项目').selectOption('p2');
  71  |   await expect(page.getByRole('button', { name: '整理实验结果' })).toHaveCount(0);
  72  |   await page.reload();
  73  |   await expect(page.getByLabel('当前项目')).toHaveValue('p2');
  74  |   await expect(page.getByLabel('搜索任务')).toHaveValue('整理');
  75  | });
  76  | 
  77  | test('ambiguous task submit preserves fields and reuses operation ID with one accepted task', async ({ page }) => {
  78  |   const model = await api(page);
  79  |   await page.goto(base);
  80  |   await page.getByRole('button', { name: '新建任务', exact: true }).click();
  81  |   const dialog = page.getByRole('dialog');
  82  |   await dialog.getByLabel('任务名称').fill('待确认响应的任务');
  83  |   await dialog.getByLabel('任务说明').fill('用于响应丢失的前端恢复验证');
  84  |   model.control.failNextWrite = true;
  85  |   await dialog.getByRole('button', { name: '创建任务', exact: true }).click();
  86  |   await expect(dialog.getByRole('alert')).toContainText('操作结果尚未确认');
  87  |   await expect(dialog.getByLabel('任务名称')).toHaveValue('待确认响应的任务');
  88  |   const saved = await page.evaluate(() => sessionStorage.getItem('meteor-flow.pending-operations.v1'));
  89  |   expect(Object.values(JSON.parse(saved!))).toEqual([model.writes[0].body.operation_id]);
  90  |   expect(saved).not.toContain('用于响应丢失');
  91  |   await page.reload();
  92  |   await page.getByRole('button', { name: '新建任务', exact: true }).click();
  93  |   await dialog.getByLabel('任务名称').fill('待确认响应的任务');
  94  |   await dialog.getByLabel('任务说明').fill('用于响应丢失的前端恢复验证');
  95  |   await dialog.getByRole('button', { name: '创建任务', exact: true }).click();
  96  |   await expect(dialog).toHaveCount(0);
  97  |   await expect(page.getByRole('button', { name: '待确认响应的任务', exact: true })).toBeVisible();
  98  |   expect(model.writes).toHaveLength(2);
  99  |   expect(model.writes[0].body.operation_id).toBe(model.writes[1].body.operation_id);
  100 |   expect(model.writes[0].csrf).toBe('test-csrf');
  101 |   expect(model.state.tasks.filter(task => task.id === 't-created')).toHaveLength(1);
  102 |   expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('meteor-flow.pending-operations.v1') ?? '{}'))).toEqual({});
  103 | });
  104 | 
  105 | test('pending writes cannot duplicate and state failure preserves snapshot while disabling writes', async ({ page }) => {
  106 |   const model = await api(page);
  107 |   await page.goto(base);
  108 |   await page.getByRole('button', { name: '新建任务', exact: true }).click();
  109 |   const dialog = page.getByRole('dialog');
  110 |   await dialog.getByLabel('任务名称').fill('单次操作');
  111 |   await dialog.getByLabel('任务说明').fill('并发点击不重复提交');
  112 |   model.control.delayWrite = true;
  113 |   await dialog.getByRole('button', { name: '创建任务', exact: true }).click();
  114 |   await expect(dialog.getByRole('button', { name: '正在提交…' })).toBeDisabled();
  115 |   await expect.poll(() => model.writes.length).toBe(1);
  116 |   model.control.releaseWrite();
  117 |   await expect(dialog).toHaveCount(0);
  118 |   model.control.offline = true;
  119 |   await expect(page.getByText('状态已过期', { exact: true })).toBeVisible();
  120 |   await expect(page.getByRole('button', { name: '整理实验结果', exact: true })).toBeVisible();
  121 |   await expect(page.getByRole('button', { name: '新建任务', exact: true })).toBeDisabled();
  122 |   model.control.offline = false;
  123 |   await page.getByRole('button', { name: '重新读取状态' }).click();
  124 |   await expect(page.getByRole('button', { name: '新建任务', exact: true })).toBeEnabled();
  125 | });
  126 | 
  127 | test('details keep attempt ownership and strip active Markdown and remote resources', async ({ page }) => {
  128 |   const state = fixture();
  129 |   state.tasks[0].phase = 'succeeded'; state.tasks[0].currentAttemptId = 'a2';
  130 |   for (const number of [1, 2]) state.attempts.push({ id: `a${number}`, taskId: 't1', bindingId: 'b1', number, phase: 'succeeded', reason: '', occupies: false, createdAt: number, submittedAt: number, endedAt: number, fingerprint: 'fingerprint-one', identity: { pid: 10, processStart: 'start', cwd: '/tmp/meteor-web-project/agent', agentSession: 'agent-session-one', type: 'codex' }, baselineSeq: 1, seenActivity: true, dispatch: 'submitted', cancelRequested: false, cancelAcceptedAt: null, attentionSince: null, remindedAt: null, input: { title: `执行 ${number}`, instructions: `第 ${number} 版冻结输入`, roots: [], requiredArtifacts: [], dependencies: [] }, result: { protocol: 'meteor-flow.result/v1', task_id: 't1', attempt_id: `a${number}`, outcome: 'succeeded', summary: `结果 ${number}\n<script>window.bad=1</script>\n![remote](https://invalid.example/track.png)\n<a href="javascript:alert(1)">danger</a>`, artifacts: [] }, resultHash: null, archiveId: null, source: 'agent', manualEvidence: null });
  131 |   await api(page, state);
  132 |   await page.goto(`${base}/?task=t1`);
  133 |   await page.getByRole('tab', { name: '结果与产物' }).click();
  134 |   await expect(page.getByRole('tabpanel')).toContainText('结果 2');
  135 |   await expect(page.locator('.markdown img, .markdown script, .markdown a')).toHaveCount(0);
  136 |   await page.getByLabel('执行尝试').selectOption('a1');
  137 |   await expect(page.getByRole('tabpanel')).toContainText('结果 1');
  138 |   await page.getByRole('tab', { name: '冻结输入' }).click();
  139 |   await expect(page.getByRole('tabpanel')).toContainText('第 1 版冻结输入');
  140 | });
  141 | 
  142 | test('terminal observes without resize, takes a token lease and never replays input after disconnect', async ({ page }) => {
  143 |   await api(page);
  144 |   const frames: Record<string, unknown>[] = [];
  145 |   let peer: { send: (data: string) => void; close: () => void } | undefined;
  146 |   await page.routeWebSocket('**/api/v1/terminal/**', ws => {
  147 |     peer = ws;
  148 |     ws.onMessage(message => {
  149 |       const frame = JSON.parse(String(message)); frames.push(frame);
  150 |       if (frame.action === 'take') ws.send(JSON.stringify({ protocol: 'meteor-flow.terminal/v1', type: 'state', mode: 'control', token: 'lease-token', epoch: 3, message: '控制已授予，调度暂停' }));
  151 |     });
  152 |     ws.send(JSON.stringify({ protocol: 'meteor-flow.terminal/v1', type: 'state', mode: 'observe', epoch: 3, message: '只读观察' }));
  153 |     ws.send(JSON.stringify({ protocol: 'meteor-flow.terminal/v1', type: 'output', data: 'test terminal\r\n' }));
  154 |   });
  155 |   await page.goto(`${base}/?view=agents&terminal=b1`);
  156 |   await expect(page.getByRole('heading', { name: '文档助手 · 只读观察' })).toBeVisible();
  157 |   await expect(page.getByRole('button', { name: '接管输入' })).toBeEnabled();
  158 |   await page.setViewportSize({ width: 1100, height: 780 });
  159 |   expect(frames).toHaveLength(0);
  160 |   await page.getByRole('button', { name: '接管输入' }).click();
  161 |   await page.getByRole('button', { name: '确认接管' }).click();
  162 |   await expect(page.getByRole('heading', { name: '文档助手 · 输入控制中' })).toBeVisible();
  163 |   peer!.send(JSON.stringify({ protocol: 'meteor-flow.terminal/v1', type: 'output', data: '\u001b[6n\u001b[?6n\u001b[c\u001b[>c\u001b[18t\u001b[?1$p\u001bP$qm\u001b\\\u001b]10;?\u0007\u001b]52;c;c2VjcmV0\u0007\u001b]8;;https://invalid.example\u001b\\link\u001b]8;;\u001b\\\r\nPARSER_SAFE' }));
> 164 |   await expect(page.locator('.xterm-rows')).toContainText('PARSER_SAFE');
      |                                             ^ Error: expect(locator).toContainText(expected) failed
  165 |   expect(frames.filter(frame => frame.action === 'input')).toHaveLength(0);
  166 |   const input = page.locator('.xterm-helper-textarea');
  167 |   await input.focus(); await page.keyboard.type('echo test');
  168 |   await expect.poll(() => frames.filter(frame => frame.action === 'input').length).toBeGreaterThan(0);
  169 |   expect(frames.filter(frame => ['input','resize'].includes(String(frame.action))).every(frame => frame.token === 'lease-token' && frame.epoch === 3)).toBe(true);
  170 |   expect(frames.filter(frame => frame.action === 'input').map(frame => frame.text).join('')).toBe('echo test');
  171 |   peer!.close();
  172 |   await expect(page.getByRole('heading', { name: '文档助手 · 只读观察' })).toBeVisible();
  173 |   const count = frames.length;
  174 |   await page.keyboard.type('never replay');
  175 |   expect(frames.length).toBe(count);
  176 |   await page.getByRole('button', { name: '重新连接', exact: true }).click();
  177 |   await expect(page.getByRole('button', { name: '接管输入' })).toBeEnabled();
  178 |   expect(frames.length).toBe(count);
  179 |   peer!.send(JSON.stringify({ protocol: 'meteor-flow.terminal/v1', type: 'output', data: '界'.repeat(400000) }));
  180 |   await expect(page.getByText(/终端输出超过页面缓冲上限/)).toBeVisible();
  181 |   await expect(page.getByRole('button', { name: '接管输入' })).toBeDisabled();
  182 | });
  183 | 
  184 | test('storage outage exposes explicit emergency interrupt without changing task ownership', async ({ page }) => {
  185 |   const state = fixture(); state.health.storage = false; state.health.error = '隔离测试：存储不可写';
  186 |   await api(page, state);
  187 |   let interrupts = 0;
  188 |   await page.route('**/api/v1/bindings/b1/emergency-interrupt', async route => {
  189 |     interrupts++;
  190 |     expect(route.request().headers()['x-csrf-token']).toBe('test-csrf');
  191 |     await route.fulfill({ json: { persisted: false, message: '紧急中断未持久化，不解除占用' } });
  192 |   });
  193 |   await page.goto(`${base}/?view=agents`);
  194 |   await expect(page.getByRole('button', { name: '恢复存储' })).toBeVisible();
  195 |   await page.getByRole('button', { name: '紧急中断（未持久化）' }).click();
  196 |   await expect(page.getByRole('dialog')).toContainText('不解除执行占用');
  197 |   expect(interrupts).toBe(0);
  198 |   await page.getByRole('button', { name: '确认紧急中断' }).click();
  199 |   await expect(page.getByRole('dialog')).toHaveCount(0);
  200 |   await expect(page.getByText('紧急中断未持久化，不解除占用', { exact: true })).toBeVisible();
  201 |   expect(interrupts).toBe(1);
  202 |   expect(state.tasks[0].phase).toBe('queued');
  203 | });
  204 | 
  205 | test('forms have keyboard focus and layout survives narrow viewport and 200 percent text', async ({ page }) => {
  206 |   await api(page);
  207 |   await page.setViewportSize({ width: 1440, height: 980 });
  208 |   await page.goto(base);
  209 |   await expect(page.getByRole('button', { name: '整理实验结果' })).toBeVisible();
  210 |   await page.screenshot({ path: `${evidence}/web-desktop.png`, fullPage: true });
  211 |   await page.getByRole('button', { name: '新建任务', exact: true }).click();
  212 |   await expect(page.getByRole('dialog')).toBeVisible();
  213 |   await expect(page.getByLabel('任务名称')).toBeFocused();
  214 |   await page.keyboard.press('Escape');
  215 |   await expect(page.getByRole('dialog')).toHaveCount(0);
  216 |   const trigger = page.getByRole('button', { name: '新建任务', exact: true });
  217 |   await expect(trigger).toBeFocused();
  218 |   for (const close of ['取消', '关闭对话框']) {
  219 |     await trigger.click();
  220 |     await page.getByRole('dialog').getByRole('button', { name: close, exact: true }).click();
  221 |     await expect(page.getByRole('dialog')).toHaveCount(0);
  222 |     await expect(trigger).toBeFocused();
  223 |   }
  224 |   await trigger.click();
  225 |   await page.getByLabel('任务名称').fill('焦点恢复检查');
  226 |   await page.getByLabel('任务说明').fill('成功提交后回到新建按钮');
  227 |   await page.getByRole('dialog').getByRole('button', { name: '创建任务', exact: true }).click();
  228 |   await expect(page.getByRole('dialog')).toHaveCount(0);
  229 |   await expect(trigger).toBeFocused();
  230 |   await page.setViewportSize({ width: 390, height: 844 });
  231 |   await page.getByRole('button', { name: '整理实验结果', exact: true }).click();
  232 |   const heading = page.getByRole('heading', { name: '整理实验结果', exact: true });
  233 |   await expect(heading).toBeFocused();
  234 |   const bounds = await heading.boundingBox();
  235 |   expect(bounds!.y).toBeGreaterThanOrEqual(0);
  236 |   expect(bounds!.y + bounds!.height).toBeLessThan(844);
  237 |   await page.getByRole('button', { name: '关闭任务详情' }).click();
  238 |   await expect(page.getByRole('button', { name: '整理实验结果', exact: true })).toBeFocused();
  239 |   await page.screenshot({ path: `${evidence}/web-narrow.png`, fullPage: true });
  240 |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  241 |   await page.setViewportSize({ width: 1440, height: 980 });
  242 |   await page.addStyleTag({ content: 'html { font-size: 28px !important }' });
  243 |   await page.screenshot({ path: `${evidence}/web-text-200.png`, fullPage: true });
  244 |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  245 | });
  246 | 
  247 | test('terminal rejects unknown protocol and malformed control without granting input', async ({ page }) => {
  248 |   await api(page);
  249 |   const frames: unknown[] = [];
  250 |   let peer: { send: (data: string) => void } | undefined;
  251 |   await page.routeWebSocket('**/api/v1/terminal/**', ws => {
  252 |     peer = ws; ws.onMessage(message => frames.push(JSON.parse(String(message))));
  253 |     ws.send(JSON.stringify({ protocol: 'meteor-flow.terminal/v1', type: 'state', mode: 'observe', epoch: 0, message: '观察' }));
  254 |   });
  255 |   await page.goto(`${base}/?view=agents&terminal=b1`);
  256 |   await expect(page.getByRole('button', { name: '接管输入' })).toBeEnabled();
  257 |   peer!.send(JSON.stringify({ protocol: 'meteor-flow.terminal/v2', type: 'state', mode: 'control', token: 'wrong', epoch: 1, message: '不可授予' }));
  258 |   await expect(page.getByText(/终端消息版本或字段不受支持/)).toBeVisible();
  259 |   await expect(page.getByRole('heading', { name: '文档助手 · 只读观察' })).toBeVisible();
  260 |   expect(frames).toHaveLength(0);
  261 |   await page.getByRole('button', { name: '重新连接', exact: true }).click();
  262 |   await expect(page.getByRole('button', { name: '接管输入' })).toBeEnabled();
  263 |   peer!.send(JSON.stringify({ protocol: 'meteor-flow.terminal/v1', type: 'state', mode: 'control', token: '', epoch: 0, message: '不可授予' }));
  264 |   await expect(page.getByRole('button', { name: '接管输入' })).toBeDisabled();
```