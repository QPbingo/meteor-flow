import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Binding } from '@meteor-flow/contracts';
import { AgentConsole } from '../../apps/server/dist/application/console.js';
import { guardAgentInput, screenBlocker } from './helpers/agent-test-screen.js';

const claudeUpdateNotice = '                                                                       Update available! Run: brew upgrade claude-code';

it('allows the observed passive Claude Homebrew notice without hiding adjacent blockers', async () => {
  expect(screenBlocker(`› Ready\n${claudeUpdateNotice}`)).toBeNull();
  let sent = 0;
  const guard = guardAgentInput({ async prompt(_target: string, _text: string) { sent++; } }, async () => `› Ready\n${claudeUpdateNotice}`, () => { throw new Error('passive notice blocked'); });
  await guard.port.prompt('isolated-terminal', 'fixed task');
  expect(sent).toBe(1);
  for (const interactive of ['1. Update now\n2. Skip', 'Updating Codex via brew upgrade --cask codex...', 'Do you want to proceed?', 'Trust this project?']) {
    expect(screenBlocker(`${claudeUpdateNotice}\n${interactive}`)).not.toBeNull();
  }
  expect(screenBlocker(`${claudeUpdateNotice} — Update now?`)).toContain('software update');
  expect(screenBlocker('Update available! Run: brew upgrade codex')).toContain('software update');
});
import { FakeHerdr, gate } from '../fixtures/fake-herdr.js';

it.each([
  ['Update available! 0.160.1 → 0.161.0\n1. Update now\n2. Skip', 'software update'],
  ['Updating Codex via brew upgrade --cask codex...\nAuto-updating Homebrew...', 'software update'],
  ['Updating via homebrew…', 'software update'],
  ['Updating…', 'software update'],
  ['沙箱阻止了执行（sandbox_apply: Operation not permitted），尚未创建 hello.txt。', 'execution sandbox'],
  ['Error: Cannot use the shared background server: This session requires api_key_model_discovery to be disabled.', 'shared background server'],
  ['Do you trust the contents of this folder?\n1. Yes\n2. No', 'directory trust'],
  ['Would you like to run the following command?\n1. Yes, proceed\n2. No', 'tool permission'],
  ['Sign in with ChatGPT to continue', 'interactive login'],
])('blocks a non-task screen before any prompt is sent: %s', (screen, expected) => {
  expect(screenBlocker(screen)).toContain(expected);
});

it('does not treat an echoed task permission instruction or ordinary ready prompt as an approval request', () => {
  expect(screenBlocker('Create only hello.txt containing meteor-flow-real-agent-ok. If any permission is needed, stop and wait for the human.\n› Implement a feature')).toBeNull();
});

it.each(['Update available! Update now', 'Updating via homebrew…', 'Updating…', 'Would you like to run the following command?'])(
  'sends no task when a non-task screen appears at the actual input boundary: %s', async screen => {
    const reading = gate(); const release = gate(); const sent: string[] = []; const blocks: string[] = [];
    const guarded = guardAgentInput({ prompt: async (_target: string, text: string) => { sent.push(text); } }, async target => {
      expect(target).toBe('isolated-terminal'); reading.release(); await release.promise; return screen;
    }, reason => blocks.push(reason));
    const submission = expect(guarded.port.prompt('isolated-terminal', 'fixed task')).rejects.toThrow();
    await reading.promise; expect(sent).toEqual([]); release.release(); await submission;
    await expect(guarded.port.prompt('isolated-terminal', 'must not retry')).rejects.toThrow();
    expect(sent).toEqual([]); expect(blocks).toHaveLength(1);
  },
);

it('keeps the input gate closed when monitoring stops a pending screen read', async () => {
  const reading = gate(); const release = gate(); let sent = 0;
  const guarded = guardAgentInput({ prompt: async (_target: string, _text: string) => { sent++; } }, async () => {
    reading.release(); await release.promise; return '› Implement a feature';
  }, () => {});
  const submission = expect(guarded.port.prompt('isolated-terminal', 'fixed task')).rejects.toThrow('permission');
  await reading.promise; guarded.stop('tool permission detected'); release.release(); await submission;
  expect(sent).toBe(0);
});

it('fails closed on a screen read failure and sends exactly once on a ready screen', async () => {
  const sent: string[] = [];
  const ready = guardAgentInput({ prompt: async (_target: string, text: string) => { sent.push(text); } }, async () => '› Implement a feature', () => {});
  await ready.port.prompt('isolated-terminal', 'fixed task'); expect(sent).toEqual(['fixed task']);
  const failed = guardAgentInput({ prompt: async (_target: string, _text: string) => { sent.push('unexpected'); } }, async () => { throw new Error('pane unavailable'); }, () => {});
  await expect(failed.port.prompt('isolated-terminal', 'fixed task')).rejects.toThrow('pane unavailable');
  expect(failed.blockedReason).toContain('cannot verify'); expect(sent).toEqual(['fixed task']);
});

it.each(['Update available! Update now', 'Would you like to run the following command?'])(
  'blocks an already queued real application task before external input: %s', async screen => {
    const directory = await realpath(await mkdtemp('/tmp/mf-guard-'));
    const cwd = join(directory, 'project'); await mkdir(cwd); await mkdir(join(directory, 'data'));
    const reading = gate(); const release = gate();
    const fake = new FakeHerdr({ agents: [{ terminalId: 'isolated-terminal', cwd }] });
    const guard = guardAgentInput(fake, async target => {
      expect(target).toBe('isolated-terminal'); reading.release(); await release.promise; return screen;
    }, () => {});
    const app = new AgentConsole({ dataDir: join(directory, 'data'), session: fake.session, executable: 'unused', portFactory: () => guard.port, pollMs: 25, minFreeBytes: 0 });
    try {
      await app.open();
      const project = await app.createProject({ operation_id: randomUUID(), name: 'input gate', root: cwd });
      const binding = await app.attach({ operation_id: randomUUID(), projectId: project.id, terminalId: 'isolated-terminal', label: 'isolated test' }) as Binding;
      await app.bindingAction(binding.id, { operation_id: randomUUID(), action: 'confirm', evidence: 'isolated fake boundary' });
      await app.bindingAction(binding.id, { operation_id: randomUUID(), action: 'automatic' });
      expect(screenBlocker('› Implement a feature')).toBeNull();
      await app.saveTask({ operation_id: randomUUID(), projectId: project.id, bindingId: binding.id, title: 'fixed task', instructions: 'Create hello.txt', dependencies: [], requiredArtifacts: ['hello.txt'], outputRoots: [] });
      await reading.promise;
      expect(app.store.state.attempts).toHaveLength(1);
      expect(app.store.state.attempts[0]?.dispatch).toBe('intent');
      release.release();
      await expect.poll(() => app.store.state.attempts[0]?.phase).toBe('needs_confirmation');
      expect(fake.prompts).toEqual([]); expect(fake.interrupts).toEqual([]);
      expect(guard.blockedReason).toBeTruthy();
    } finally { release.release(); await app.close(); await rm(directory, { recursive: true, force: true }); }
  },
);
