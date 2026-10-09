import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';
import { expect, it } from 'vitest';
import { createServer as createViteServer } from '../../apps/web/node_modules/vite/dist/node/index.js';
import { AgentConsole } from '../../apps/server/dist/application/console.js';
import { createServer } from '../../apps/server/dist/http/server.js';
import { FakeHerdr } from '../fixtures/fake-herdr.js';
import type { Binding } from '@meteor-flow/contracts';

async function unusedPort() {
  const server = createNetServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing port');
  await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done())); return address.port;
}
async function http(url: string, headers: Record<string, string>, method = 'GET') {
  return await new Promise<{ status: number; body: string }>((done, fail) => {
    const req = request(url, { headers, method }, response => {
      let body = ''; response.on('data', data => { body += String(data); });
      response.on('end', () => done({ status: response.statusCode!, body }));
    });
    req.on('upgrade', (_response, socket) => { socket.destroy(); done({ status: 101, body: '' }); });
    req.on('error', fail); req.setTimeout(5000, () => req.destroy(new Error('test HTTP deadline'))); req.end();
  });
}
const live = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function cleanupFixtureProcesses(fixture: Awaited<ReturnType<typeof devFixture>>, extra: number[] = []) {
  const rows = await fixture.rows();
  const pids = new Set([...extra, ...rows.flatMap(row => [row.pid, row.workerPid].filter((pid): pid is number => typeof pid === 'number'))]);
  for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; } }
}
async function descendants(parent: number) {
  const { stdout } = await promisify(execFile)('/bin/ps', ['-axo', 'pid=,ppid=']);
  const processes = stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
  const own = new Set([parent]);
  for (let previous = 0; previous !== own.size;) {
    previous = own.size;
    for (const [pid, ppid] of processes) if (ppid && own.has(ppid) && pid) own.add(pid);
  }
  own.delete(parent); return [...own];
}

it('development proxy serves the browser with authenticated API/WS while rejecting foreign boundaries', async () => {
  const directory = await realpath(await mkdtemp('/tmp/mf-dev-proxy-'));
  const cwd = join(directory, 'project'); const dataDir = join(directory, 'data');
  await mkdir(cwd); await mkdir(dataDir);
  const fake = new FakeHerdr({ agents: [{ terminalId: 'dev-agent', cwd }] });
  const executable = resolve('tests/fixtures/terminal-cli.mjs'); await chmod(executable, 0o700);
  const service = new AgentConsole({ dataDir, session: fake.session, executable, portFactory: () => fake, pollMs: 1000000, minFreeBytes: 0 });
  await service.open();
  const backend = await createServer(service, { port: 0, webRoot: resolve('apps/web/dist') });
  const devPort = await unusedPort(); const devOrigin = `http://127.0.0.1:${devPort}`;
  const saved = [process.env.METEOR_FLOW_DEV_PORT, process.env.METEOR_FLOW_SERVER_PORT];
  process.env.METEOR_FLOW_DEV_PORT = String(devPort); process.env.METEOR_FLOW_SERVER_PORT = new URL(backend.address).port;
  let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let forwarded = 0;
  backend.app.server.prependListener('request', () => { forwarded++; });
  backend.app.server.prependListener('upgrade', () => { forwarded++; });
  try {
    vite = await createViteServer({ configFile: resolve('apps/web/vite.config.ts'), root: resolve('apps/web'), logLevel: 'error' }); await vite.listen();
    const entry = JSON.parse(await readFile(join(dataDir, 'open.json'), 'utf8')) as { url: string };
    browser = await chromium.launch({ headless: true }); const page = await browser.newPage();
    await page.goto(entry.url);
    await page.getByRole('heading', { name: '建立你的第一个项目' }).waitFor();
    await page.goto(devOrigin);
    await page.getByRole('heading', { name: '建立你的第一个项目' }).waitFor();
    await page.getByRole('button', { name: '创建项目', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('项目名称').fill('开发代理的持久化项目');
    await dialog.getByLabel('项目根目录').fill(cwd);
    await dialog.getByRole('button', { name: '创建项目', exact: true }).click();
    await expect.poll(() => service.store.state.projects.length).toBe(1);
    const db = new DatabaseSync(join(dataDir, 'meteor-flow.sqlite'), { readOnly: true });
    try { expect(db.prepare('SELECT count(*) AS n FROM projects').get()?.n).toBe(1); } finally { db.close(); }
    const binding = await service.attach({ operation_id: randomUUID(), projectId: service.store.state.projects[0]!.id, terminalId: 'dev-agent', label: '开发代理 Agent' }) as Binding;
    const auth = await page.evaluate(async () => await (await fetch('/api/v1/auth')).json()) as { authenticated: boolean; csrf: string };
    expect(auth.authenticated).toBe(true);
    const cookie = (await page.context().cookies()).map(row => `${row.name}=${row.value}`).join('; ');
    const route = `/api/v1/terminals/${binding.id}?csrf=${auth.csrf}`;
    const frame = await page.evaluate(async route => await new Promise<Record<string, unknown>>((done, fail) => {
      const socket = new WebSocket(location.origin.replace('http:', 'ws:') + route);
      const timeout = setTimeout(() => { socket.close(); fail(new Error('terminal frame deadline')); }, 5000);
      socket.onmessage = event => { const value = JSON.parse(event.data); if (value.type === 'output') { clearTimeout(timeout); socket.close(); done(value); } };
      socket.onerror = () => { clearTimeout(timeout); fail(new Error('terminal upgrade failed')); };
    }), route);
    expect(frame).toMatchObject({ type: 'output', protocol: 'meteor-flow.terminal/v1' });
    expect(frame.data).toContain('fixture terminal');
    await page.close(); // Stop background polling before asserting no rejected request was forwarded.
    const before = forwarded;
    const devHost = new URL(devOrigin).host;
    const badHeaders: Array<Record<string, string>> = [
      { host: 'foreign.invalid', origin: devOrigin },
      { host: devHost, origin: 'https://foreign.invalid' },
      { host: devHost, origin: 'null' },
      { host: devHost, origin: backend.address },
      { host: devHost, origin: devOrigin, 'sec-fetch-site': 'cross-site' },
    ];
    for (const headers of badHeaders) {
      expect((await http(`${devOrigin}/api/v1/state`, { ...headers, cookie })).status).toBe(403);
      expect((await http(`${devOrigin}${route}`, { ...headers, cookie, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '13' })).status).toBe(403);
    }
    expect((await http(`${devOrigin}/api/v1/projects`, { host: devHost, cookie }, 'POST')).status).toBe(403);
    expect((await http(`${devOrigin}${route}`, { host: devHost, cookie, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '13' })).status).toBe(403);
    expect(forwarded).toBe(before);
    expect((await http(`${devOrigin}/api/v1/state`, { host: devHost })).status).toBe(401);
    expect((await http(`${devOrigin}/api/v1/projects`, { host: devHost, cookie, origin: devOrigin }, 'POST')).status).toBe(403); // Original CSRF checks remain active.
    expect((await http(`${devOrigin}/`, { host: 'foreign.invalid' })).status).toBe(403);
    expect(fake.prompts).toEqual([]);
  } finally {
    await browser?.close(); await vite?.close(); await backend.app.close(); await service.close();
    for (const [index, name] of ['METEOR_FLOW_DEV_PORT', 'METEOR_FLOW_SERVER_PORT'].entries()) { if (saved[index] === undefined) delete process.env[name]; else process.env[name] = saved[index]; }
    await rm(directory, { recursive: true, force: true });
  }
}, 45000);

async function devFixture() {
  const directory = await realpath(await mkdtemp('/tmp/mf-dev-supervisor-'));
  await mkdir(join(directory, 'scripts')); await copyFile('scripts/dev.mjs', join(directory, 'scripts/dev.mjs'));
  await copyFile('tests/fixtures/dev-build.mjs', join(directory, 'fixture-build.mjs'));
  await copyFile('tests/fixtures/dev-server.mjs', join(directory, 'fixture-server.mjs'));
  await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module', scripts: { build: 'node fixture-build.mjs' } }));
  await writeFile(join(directory, 'pnpm-workspace.yaml'), 'packages: []\nverifyDepsBeforeRun: warn\n');
  await symlink(resolve('node_modules'), join(directory, 'node_modules'));
  for (const component of ['packages/contracts', 'packages/posix-fs', 'apps/server']) {
    await mkdir(join(directory, component, 'src'), { recursive: true });
    await writeFile(join(directory, component, 'src/marker.ts'), 'export const marker = 1;\n');
    await writeFile(join(directory, component, 'tsconfig.build.json'), JSON.stringify({ compilerOptions: { outDir: 'dist', skipLibCheck: true }, include: ['src/*.ts'] }));
  }
  await mkdir(join(directory, 'apps/web'), { recursive: true });
  await symlink(resolve('apps/web/node_modules'), join(directory, 'apps/web/node_modules'));
  await copyFile('apps/web/vite.config.ts', join(directory, 'apps/web/vite.config.ts'));
  await writeFile(join(directory, 'apps/web/index.html'), '<title>Isolated development fixture</title>');
  const log = join(directory, 'processes.jsonl'); await writeFile(log, '');
  // This intentionally minimal fixture shares installed tools, not the real workspace lockfile.
  // Prevent pnpm 11's automatic dependency reconciliation in the fixture.
  const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, pnpm_config_verify_deps_before_run: 'warn', METEOR_DEV_FIXTURE_LOG: log };
  const rows = async () => (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  return { directory, log, env, rows };
}

it('dev requires an explicit session and never starts services after a failed initial build', async () => {
  const fixture = await devFixture();
  try {
    for (const args of [[], ['--session', 'isolated-dev']]) {
      const child = spawn(process.execPath, ['scripts/dev.mjs', ...args], { cwd: fixture.directory, env: { ...fixture.env, METEOR_DEV_FIXTURE_BUILD_FAIL: '1' }, stdio: 'ignore' });
      const [code] = await once(child, 'close'); expect(code).toBe(1);
      const rows = await fixture.rows(); expect(rows.filter(row => row.kind === 'server')).toEqual([]);
      expect(rows.filter(row => row.kind === 'build')).toHaveLength(args.length ? 1 : 0);
    }
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
}, 15000);

it.each(['failed', 'interrupted'] as const)('reaps a resistant build descendant after the build is %s', async outcome => {
  const fixture = await devFixture();
  const child = spawn(process.execPath, ['scripts/dev.mjs', '--session', 'isolated-build-cleanup'], {
    cwd: fixture.directory,
    env: { ...fixture.env, METEOR_DEV_FIXTURE_BUILD_DESCENDANT: '1', METEOR_DEV_FIXTURE_BUILD_FAIL: outcome === 'failed' ? '1' : '0' },
    stdio: 'ignore',
  });
  const closed = once(child, 'close');
  try {
    await expect.poll(async () => (await fixture.rows()).some(row => row.kind === 'build-descendant-ready')).toBe(true);
    const descendant = (await fixture.rows()).find(row => row.kind === 'build-descendant-ready').pid;
    expect(live(descendant)).toBe(true);
    if (outcome === 'interrupted') child.kill('SIGTERM');
    expect((await closed)[0]).toBe(outcome === 'failed' ? 1 : 0);
    await expect.poll(() => live(descendant)).toBe(false);
    expect((await fixture.rows()).filter(row => row.kind === 'server')).toEqual([]);
  } finally {
    if (child.exitCode === null) { child.kill('SIGTERM'); await closed; }
    await cleanupFixtureProcesses(fixture);
    await rm(fixture.directory, { recursive: true, force: true });
  }
}, 15000);

it('dev builds first, forwards CLI options, restarts on child-code changes and reaps its process groups', async () => {
  const fixture = await devFixture(); const devPort = await unusedPort(); const serverPort = await unusedPort();
  const session = `isolated-${randomUUID()}`; const dataDir = join(fixture.directory, 'data dir');
  const child = spawn(process.execPath, ['scripts/dev.mjs', '--', '--session', session, '--data-dir', dataDir, '--herdr', '/unused-test-herdr', '--port', String(serverPort), '--dev-port', String(devPort)], { cwd: fixture.directory, env: fixture.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', data => { output += String(data); }); child.stderr.on('data', data => { output += String(data); });
  const closed = once(child, 'close');
  let pids: number[] = [];
  try {
    await expect.poll(async () => {
      if (child.exitCode !== null) throw new Error(output);
      return (await fixture.rows()).some(row => row.kind === 'server');
    }, { timeout: 15000 }).toBe(true);
    await expect.poll(async () => { try { return (await http(`http://127.0.0.1:${devPort}`, {})).body; } catch { return ''; } }).toContain('Isolated development fixture');
    expect((await fixture.rows())[0]!.kind).toBe('build');
    expect((await fixture.rows()).find(row => row.kind === 'server').args).toEqual(['serve', '--session', session, '--port', String(serverPort), '--data-dir', dataDir, '--herdr', '/unused-test-herdr']);
    await writeFile(join(fixture.directory, 'apps/server/dist/worker.txt'), 'updated child code');
    await expect.poll(async () => (await fixture.rows()).filter(row => row.kind === 'server').map(row => row.workerVersion), { timeout: 10000 }).toContain('updated child code');
    pids = await descendants(child.pid!); expect(pids.length).toBeGreaterThanOrEqual(6);
    child.kill('SIGTERM'); expect((await closed)[0], output).toBe(0);
    for (const pid of pids) await expect.poll(() => live(pid)).toBe(false);
    for (const row of (await fixture.rows()).filter(row => row.kind === 'server')) {
      await expect.poll(() => live(row.pid)).toBe(false); await expect.poll(() => live(row.workerPid)).toBe(false);
    }
    await expect(http(`http://127.0.0.1:${devPort}`, {})).rejects.toThrow();
  } finally {
    if (child.exitCode === null) { child.kill('SIGTERM'); await closed; }
    await cleanupFixtureProcesses(fixture, pids);
    await rm(fixture.directory, { recursive: true, force: true });
  }
}, 30000);
