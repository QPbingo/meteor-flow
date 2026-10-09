#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const children = new Map();
let stopping = false;
let finish;
const stopped = new Promise(resolve => { finish = resolve; });

function signalGroup(child, signal) {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
function groupAlive(child) {
  if (!child.pid) return false;
  try { process.kill(-child.pid, 0); return true; } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true; // Existence is known; do not mistake it for an empty group.
    throw error;
  }
}
async function stop(code) {
  if (stopping) return stopped;
  stopping = true;
  process.exitCode = code;
  for (const child of children.keys()) signalGroup(child, 'SIGTERM');
  const remaining = () => [...children.keys()].filter(groupAlive);
  // A watcher can exit before its own children. Wait for the groups, not just their leaders.
  const deadline = Date.now() + 5000;
  while (remaining().length && Date.now() < deadline) await delay(50);
  for (const child of remaining()) signalGroup(child, 'SIGKILL');
  await Promise.all(children.values());
  finish();
}
function start(command, args, options = {}, required = true) {
  if (stopping) throw new Error('开发服务已停止');
  // Each command owns a process group, including compiler/runtime grandchildren.
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', detached: true, ...options });
  const closed = new Promise(resolve => {
    child.once('error', error => { process.stderr.write(`${error.message}\n`); void stop(1); });
    child.once('close', (code, signal) => {
      resolve(code ?? 1);
      if (required && !stopping) {
        process.stderr.write(`开发进程退出：${command} (${signal ?? code})\n`);
        void stop(1);
      }
    });
  });
  children.set(child, closed);
  return { child, closed };
}
function port(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error('开发端口必须是 1–65535 的整数');
  return number;
}

try {
  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    session: { type: 'string' }, 'data-dir': { type: 'string' }, herdr: { type: 'string' },
    port: { type: 'string' }, 'dev-port': { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    process.stdout.write('pnpm dev -- --session <会话> [--data-dir <路径>] [--herdr <绝对路径>] [--port 4317] [--dev-port 5173]\n先从服务打印的 4317 入口完成认证，再打开同主机名的 5173 开发页面。\n');
  } else {
    if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('请使用 Node.js 24（见 .node-version）');
    if (positionals.some(value => value !== '--')) throw new Error('开发命令只接受具名参数');
    if (!values.session || !/^[A-Za-z0-9._-]{1,64}$/.test(values.session) || ['.', '..'].includes(values.session)) throw new Error('请显式选择 herdr 会话：--session <name>');
    const serverPort = port(values.port, 4317); const devPort = port(values['dev-port'], 5173);
    if (serverPort === devPort) throw new Error('服务端口与开发页面端口不能相同');
    process.once('SIGINT', () => void stop(0));
    process.once('SIGTERM', () => void stop(0));
    const build = start('pnpm', ['build'], {}, false);
    const built = await build.closed;
    // A completed build leader may leave descendants; keep its group for stop().
    if (!groupAlive(build.child)) children.delete(build.child);
    if (built !== 0) throw new Error('初始构建失败，开发服务未启动');
    if (groupAlive(build.child)) throw new Error('初始构建遗留后台进程，开发服务未启动');
    if (!stopping) {
      for (const directory of ['packages/contracts', 'packages/posix-fs', 'apps/server']) {
        start(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(root, directory, 'tsconfig.build.json'), '--watch', '--preserveWatchOutput']);
      }
      const cliArgs = ['serve', '--session', values.session, '--port', String(serverPort)];
      for (const name of ['data-dir', 'herdr']) if (values[name]) cliArgs.push(`--${name}`, values[name]);
      // Explicit directories include worker/collector code loaded outside the main import graph.
      start(process.execPath, ['--watch', '--watch-preserve-output',
        '--watch-path', join(root, 'apps/server/dist'), '--watch-path', join(root, 'packages/contracts/dist'),
        '--watch-path', join(root, 'packages/posix-fs/dist'), join(root, 'apps/server/dist/cli/main.js'), ...cliArgs]);
      start(process.execPath, [join(root, 'apps/web/node_modules/vite/bin/vite.js')], {
        cwd: join(root, 'apps/web'),
        env: { ...process.env, METEOR_FLOW_SERVER_PORT: String(serverPort), METEOR_FLOW_DEV_PORT: String(devPort) },
      });
      process.stdout.write(`开发页面：http://127.0.0.1:${devPort}/\n请先打开服务打印的 http://127.0.0.1:${serverPort}/#token=… 入口完成认证。后端重启后重新认证。\n`);
      await stopped;
    }
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  await stop(1);
}
