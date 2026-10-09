import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fork, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acquireLock, canonicalDirectory, createRunDirectory, directoriesOverlap, isProcessDescendant, processIdentity, safeCopy, safeRead } from '../src/index.js';
import * as native from '../src/native.js';

let temp: string;
let source: string;
let output: string;

beforeEach(() => {
  temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'meteor-posix-test-')));
  source = path.join(temp, 'source');
  output = path.join(temp, 'output');
  fs.mkdirSync(source);
  fs.mkdirSync(output);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(temp, { recursive: true, force: true });
});

function fixture(data: string | Buffer = 'stable artifact'): string {
  fs.mkdirSync(path.join(source, 'nested'));
  const file = path.join(source, 'nested', 'result');
  fs.writeFileSync(file, data);
  return file;
}

// The real syscall runs; mutate real files at the first read boundary. No
// production hooks, timing guesses, or simulated file contents are involved.
function afterFirstRead(action: () => void): void {
  const read = fs.readSync;
  let ran = false;
  vi.spyOn(fs, 'readSync').mockImplementation((...args: Parameters<typeof fs.readSync>) => {
    const count = read(...args);
    if (count > 0 && !ran) { ran = true; action(); }
    return count;
  });
}

describe('safe file collection', () => {
  it('rejects an authorized root replaced by a symlink before reading or creating a run', () => {
    const frozen=canonicalDirectory(source);
    fs.writeFileSync(path.join(output,'secret'),'outside');
    fs.renameSync(source,`${source}-old`);
    fs.symlinkSync(output,source);
    expect(()=>safeRead(frozen,'secret',100)).toThrow();
    expect(()=>createRunDirectory(frozen,randomUUID())).toThrow();
    expect(fs.existsSync(path.join(output,'.meteor-flow'))).toBe(false);
  });
  it('rejects a destination parent symlink without writing outside staging', () => {
    fixture();
    const alias=path.join(temp,'destination-alias');
    fs.symlinkSync(output,alias);
    expect(()=>safeCopy(source,'nested/result',path.join(alias,'copied'),100)).toThrow();
    expect(fs.existsSync(path.join(output,'copied'))).toBe(false);
  });
  it('reads nested bytes with SHA-256 and exact bigint identities', () => {
    const file = fixture(Buffer.from([0, 1, 255, 42]));
    const result = safeRead(source, 'nested/result', 4);
    const stat = fs.statSync(file, { bigint: true });
    expect(result.data).toEqual(Buffer.from([0, 1, 255, 42]));
    expect(result.sha256).toBe(createHash('sha256').update(result.data).digest('hex'));
    expect(result.identity).toEqual(Object.fromEntries(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].map(key =>
      [key, stat[key as keyof typeof stat].toString()])));
    expect(result.size).toBe(4);
  });

  it('reads and copies empty files at the exact zero-byte quota', () => {
    fixture('');
    expect(safeRead(source, 'nested/result', 0).data.length).toBe(0);
    const snapshot = safeCopy(source, 'nested/result', path.join(output, 'copy'), 0);
    expect(snapshot.size).toBe(0);
    expect(fs.readFileSync(path.join(output, 'copy'))).toEqual(Buffer.alloc(0));
  });

  it.each(['../outside', '/etc/passwd', 'nested/../result', 'nested//result', './result', 'nested/result\0suffix', ''])
  ('rejects unsafe relative path %j', relative => {
    fixture();
    expect(() => safeRead(source, relative, 1024)).toThrow();
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])
  ('rejects invalid quota %j', limit => {
    fixture();
    expect(() => safeRead(source, 'nested/result', limit)).toThrow(/limit/i);
  });

  it('enforces file quota before returning or leaving staging bytes', () => {
    fixture('12345');
    expect(() => safeRead(source, 'nested/result', 4)).toThrow(/limit/i);
    expect(() => safeCopy(source, 'nested/result', path.join(output, 'copy'), 4)).toThrow(/limit/i);
    expect(fs.readdirSync(output)).toEqual([]);
    expect(safeRead(source, 'nested/result', 5).data.toString()).toBe('12345');
  });

  it('rejects leaf and intermediate symlinks, hard links, and directories', () => {
    const file = fixture();
    fs.symlinkSync(file, path.join(source, 'symlink'));
    fs.symlinkSync(path.join(source, 'nested'), path.join(source, 'dirlink'));
    expect(() => safeRead(source, 'symlink', 1024)).toThrow();
    expect(() => safeRead(source, 'dirlink/result', 1024)).toThrow();
    expect(() => safeRead(source, 'nested', 1024)).toThrow();
    fs.linkSync(file, path.join(source, 'hardlink'));
    expect(() => safeRead(source, 'hardlink', 1024)).toThrow(/single link/);
    expect(() => safeRead(source, 'nested/result', 1024)).toThrow(/single link/);
  });

  it('rejects FIFO without a writer and continues serving valid files', () => {
    fixture();
    const fifo = path.join(source, 'fifo');
    const result = spawnSync('/usr/bin/mkfifo', [fifo], { timeout: 2000 });
    expect(result.status).toBe(0);
    expect(() => safeRead(source, 'fifo', 1024)).toThrow(/regular/);
    expect(() => safeRead(source, 'fifo/file', 1024)).toThrow();
    expect(safeRead(source, 'nested/result', 1024).data.toString()).toBe('stable artifact');
  });

  it('rejects a regular leaf swapped to a writerless FIFO after its nofollow precheck', () => {
    const file = fixture();
    const statAt = native.statAt;
    let changed = false;
    vi.spyOn(native, 'statAt').mockImplementation((parent, name) => {
      const stat = statAt(parent, name);
      if (!changed && name === 'result') {
        changed = true;
        fs.unlinkSync(file);
        expect(spawnSync('/usr/bin/mkfifo', [file], { timeout: 2000 }).status).toBe(0);
      }
      return stat;
    });
    expect(() => safeRead(source, 'nested/result', 1024)).toThrow(/regular/);
    expect(changed).toBe(true);
  });

  it('rejects an opened parent replaced by FIFO before the first file read', () => {
    fixture();
    const statAt = native.statAt;
    let changed = false;
    vi.spyOn(native, 'statAt').mockImplementation((parent, name) => {
      const stat = statAt(parent, name);
      if (!changed && name === 'result') {
        changed = true;
        fs.renameSync(path.join(source, 'nested'), path.join(temp, 'moved'));
        expect(spawnSync('/usr/bin/mkfifo', [path.join(source, 'nested')], { timeout: 2000 }).status).toBe(0);
      }
      return stat;
    });
    expect(() => safeRead(source, 'nested/result', 1024)).toThrow();
    expect(changed).toBe(true);
  });

  it('copies in bounded blocks, preserves hash, and creates a private file', () => {
    const data = Buffer.alloc(200_000, 19);
    fixture(data);
    const dest = path.join(output, 'copy');
    const result = safeCopy(source, 'nested/result', dest, data.length);
    expect(fs.readFileSync(dest)).toEqual(data);
    expect(result.sha256).toBe(createHash('sha256').update(data).digest('hex'));
    expect(fs.statSync(dest).mode & 0o777).toBe(0o600);
    expect(result).not.toHaveProperty('data');
    expect(() => safeCopy(source, 'nested/result', dest, data.length)).toThrow();
    expect(fs.readFileSync(dest)).toEqual(data);
  });

  it('never follows or deletes an existing destination symlink', () => {
    fixture();
    const outside = path.join(temp, 'outside');
    fs.writeFileSync(outside, 'untouched');
    const dest = path.join(output, 'copy');
    fs.symlinkSync(outside, dest);
    expect(() => safeCopy(source, 'nested/result', dest, 1024)).toThrow();
    expect(fs.readFileSync(outside, 'utf8')).toBe('untouched');
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(true);
  });

  it('rejects same-size source mutation after reading begins', () => {
    const file = fixture(Buffer.alloc(200_000, 1));
    afterFirstRead(() => fs.writeFileSync(file, Buffer.alloc(200_000, 2)));
    expect(() => safeRead(source, 'nested/result', 300_000)).toThrow(/changed/i);
  });

  it('rejects growth beyond quota during reading and removes staging', () => {
    const file = fixture(Buffer.alloc(100_000, 1));
    afterFirstRead(() => fs.appendFileSync(file, Buffer.alloc(100_000, 2)));
    expect(() => safeCopy(source, 'nested/result', path.join(output, 'copy'), 100_000)).toThrow(/limit/i);
    expect(fs.readdirSync(output)).toEqual([]);
  });

  it('rejects source deletion after opening and removes staging', () => {
    const file = fixture(Buffer.alloc(100_000, 1));
    afterFirstRead(() => fs.unlinkSync(file));
    expect(() => safeCopy(source, 'nested/result', path.join(output, 'copy'), 100_000)).toThrow();
    expect(fs.readdirSync(output)).toEqual([]);
  });

  it('rejects a moved parent replaced by an outside symlink', () => {
    fixture(Buffer.alloc(100_000, 1));
    const outside = path.join(temp, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'result'), 'outside secret');
    afterFirstRead(() => {
      fs.renameSync(path.join(source, 'nested'), path.join(temp, 'moved'));
      fs.symlinkSync(outside, path.join(source, 'nested'));
    });
    expect(() => safeCopy(source, 'nested/result', path.join(output, 'copy'), 100_000)).toThrow();
    expect(fs.readdirSync(output)).toEqual([]);
    expect(fs.readFileSync(path.join(outside, 'result'), 'utf8')).toBe('outside secret');
  });

  it('rejects replacement of the authorized root while a file is open', () => {
    fixture(Buffer.alloc(100_000, 1));
    afterFirstRead(() => {
      fs.renameSync(source, path.join(temp, 'old-root'));
      fs.mkdirSync(source);
      fs.mkdirSync(path.join(source, 'nested'));
      fs.writeFileSync(path.join(source, 'nested', 'result'), 'replacement');
    });
    expect(() => safeRead(source, 'nested/result', 100_000)).toThrow(/changed/i);
  });

  it('removes only its own staging file on disk failure and allows a later retry', () => {
    fixture();
    const original = fs.writeSync;
    vi.spyOn(fs, 'writeSync').mockImplementation(() => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); });
    expect(() => safeCopy(source, 'nested/result', path.join(output, 'copy'), 1024)).toThrow(/disk full/);
    expect(fs.readdirSync(output)).toEqual([]);
    vi.mocked(fs.writeSync).mockRestore();
    expect(fs.writeSync).toBe(original);
    expect(safeCopy(source, 'nested/result', path.join(output, 'copy'), 1024).size).toBe(15);
  });

  it('closes all tracked descriptors after a failed collection', () => {
    fixture();
    const stat = fs.fstatSync;
    const opened = new Set<number>();
    vi.spyOn(fs, 'fstatSync').mockImplementation((...args: Parameters<typeof fs.fstatSync>) => {
      opened.add(args[0]);
      return stat(...args);
    });
    expect(() => safeRead(source, 'nested/missing', 1024)).toThrow();
    vi.mocked(fs.fstatSync).mockRestore();
    expect(opened.size).toBeGreaterThan(0);
    for (const fd of opened) expect(() => fs.fstatSync(fd)).toThrow();
  });
});

describe('directory identity and overlap', () => {
  it('resolves aliases and detects equality, containment, and distinct prefixes', () => {
    fixture();
    const alias = path.join(temp, 'alias');
    fs.symlinkSync(source, alias);
    fs.mkdirSync(`${source}-other`);
    expect(canonicalDirectory(alias)).toBe(source);
    expect(directoriesOverlap(alias, source)).toBe(true);
    expect(directoriesOverlap(source, path.join(source, 'nested'))).toBe(true);
    expect(directoriesOverlap(path.join(source, 'nested'), source)).toBe(true);
    expect(directoriesOverlap(source, `${source}-other`)).toBe(false);
    expect(directoriesOverlap(source, '/')).toBe(true);
    expect(() => canonicalDirectory(path.join(source, 'nested', 'result'))).toThrow();
  });

  it('creates private attempt directories exclusively and preserves earlier contents', () => {
    const attempt = randomUUID();
    const directory = createRunDirectory(source, attempt);
    expect(directory).toBe(path.join(source, '.meteor-flow', 'runs', attempt));
    expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
    fs.writeFileSync(path.join(directory, 'input'), 'frozen');
    expect(() => createRunDirectory(source, attempt)).toThrow(/mkdirat/);
    expect(fs.readFileSync(path.join(directory, 'input'), 'utf8')).toBe('frozen');
    expect(createRunDirectory(source, randomUUID())).not.toBe(directory);
  });

  it('rejects traversal IDs and symlink internal directories', () => {
    expect(() => createRunDirectory(source, '../escape')).toThrow(/UUID/);
    fs.symlinkSync(output, path.join(source, '.meteor-flow'));
    expect(() => createRunDirectory(source, randomUUID())).toThrow();
    expect(fs.readdirSync(output)).toEqual([]);
    fs.unlinkSync(path.join(source, '.meteor-flow'));
    fs.mkdirSync(path.join(source, '.meteor-flow'));
    fs.symlinkSync(output, path.join(source, '.meteor-flow', 'runs'));
    expect(() => createRunDirectory(source, randomUUID())).toThrow();
    expect(fs.readdirSync(output)).toEqual([]);
  });

  it('rejects an existing regular file or symlink at the attempt name', () => {
    const attempt = randomUUID();
    const first = createRunDirectory(source, randomUUID());
    const collision = path.join(path.dirname(first), attempt);
    fs.writeFileSync(collision, 'keep');
    expect(() => createRunDirectory(source, attempt)).toThrow(/mkdirat/);
    expect(fs.readFileSync(collision, 'utf8')).toBe('keep');
    fs.unlinkSync(collision);
    fs.symlinkSync(output, collision);
    expect(() => createRunDirectory(source, attempt)).toThrow(/mkdirat/);
    expect(fs.lstatSync(collision).isSymbolicLink()).toBe(true);
  });

  it('rejects moved parents at directory creation and removes only the empty new run', () => {
    const attempt = randomUUID();
    const mkdir = native.makeDirectory;
    vi.spyOn(native, 'makeDirectory').mockImplementation((parent, name, existing) => {
      mkdir(parent, name, existing);
      if (name === attempt) {
        fs.renameSync(path.join(source, '.meteor-flow'), path.join(temp, 'moved'));
        fs.symlinkSync(output, path.join(source, '.meteor-flow'));
      }
    });
    expect(() => createRunDirectory(source, attempt)).toThrow();
    expect(fs.readdirSync(output)).toEqual([]);
    expect(fs.readdirSync(path.join(temp, 'moved', 'runs'))).toEqual([]);
  });
});

function childLock(lock: string): ChildProcess {
  return fork(new URL('./lock-process.ts', import.meta.url), [lock], {
    execPath: process.execPath, execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
}

async function message(child: ChildProcess): Promise<{ type: string; code?: string }> {
  const [value] = await once(child, 'message');
  return value;
}

describe('process locks and recovery identity', () => {
  it('holds one inode and makes release idempotent', () => {
    const lockPath = path.join(temp, 'service.lock');
    const held = acquireLock(lockPath);
    const ino = fs.statSync(lockPath, { bigint: true }).ino;
    expect(() => acquireLock(lockPath)).toThrow(/flock/);
    held.release();
    const next = acquireLock(lockPath);
    held.release();
    expect(() => acquireLock(lockPath)).toThrow(/flock/);
    next.release();
    expect(fs.statSync(lockPath, { bigint: true }).ino).toBe(ino);
  });

  it('refuses symlink and hardlink lock paths', () => {
    const target = path.join(temp, 'target');
    fs.writeFileSync(target, '');
    fs.symlinkSync(target, path.join(temp, 'symlink'));
    expect(() => acquireLock(path.join(temp, 'symlink'))).toThrow();
    fs.linkSync(target, path.join(temp, 'hardlink'));
    expect(() => acquireLock(path.join(temp, 'hardlink'))).toThrow(/single link/);
  });

  it('rejects a second process then allows it after explicit release', async () => {
    const lockPath = path.join(temp, 'service.lock');
    const held = acquireLock(lockPath);
    try {
      const rejected = childLock(lockPath);
      const rejectedExit = once(rejected, 'exit');
      expect((await message(rejected)).type).toBe('denied');
      await rejectedExit;
      held.release();
      const next = childLock(lockPath);
      const nextExit = once(next, 'exit');
      try {
        expect((await message(next)).type).toBe('locked');
        next.send({ command: 'release' });
        expect((await message(next)).type).toBe('released');
        await nextExit;
      } finally { if (next.exitCode === null) next.kill('SIGKILL'); }
    } finally { held.release(); }
  });

  it('releases on owner crash while its exec descendant is still alive', async () => {
    const lockPath = path.join(temp, 'service.lock');
    const socketPath = path.join(temp, 'child.sock');
    const server = net.createServer();
    server.listen(socketPath);
    await once(server, 'listening');
    const owner = childLock(lockPath);
    const ownerExit = once(owner, 'exit');
    let connection: net.Socket | undefined;
    try {
      expect((await message(owner)).type).toBe('locked');
      expect(() => acquireLock(lockPath)).toThrow(/flock/);
      const connected = once(server, 'connection');
      owner.send({ command: 'descendant', socket: socketPath });
      [connection] = await connected;
      expect(String((await once(connection!, 'data'))[0])).toBe('ready');
      owner.kill('SIGKILL');
      await ownerExit;
      expect(connection!.destroyed).toBe(false);
      const recovered = acquireLock(lockPath);
      recovered.release();
    } finally {
      if (owner.exitCode === null && owner.signalCode === null) { owner.kill('SIGKILL'); await ownerExit; }
      if (connection && !connection.destroyed) {
        const closed = once(connection, 'close');
        connection.write('exit');
        await closed;
      }
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('returns stable PID/start evidence and null for nonexistent or invalid PIDs', () => {
    const identity = processIdentity(process.pid);
    expect(identity).toMatch(new RegExp(`^${process.pid}:`));
    expect(processIdentity(process.pid)).toBe(identity);
    expect(processIdentity(2_147_483_647)).toBeNull();
    expect(processIdentity(-1)).toBeNull();
    expect(processIdentity(1.5)).toBeNull();
  });
});


it('proves live descendants and rejects unrelated, vanished or reused identities',async()=>{
  const child=spawn(process.execPath,['-e',"process.stdout.write('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});
  const closed=once(child,'close');
  try{
    await once(child.stdout!,'data');const identity=processIdentity(process.pid)!;
    expect(isProcessDescendant(child.pid!,process.pid,identity)).toBe(true);
    expect(isProcessDescendant(process.ppid,process.pid,identity)).toBe(false);
    expect(isProcessDescendant(child.pid!,process.pid,`${process.pid}:wrong`)).toBe(false);
    expect(isProcessDescendant(2147483647,process.pid,identity)).toBe(false);
    child.kill('SIGTERM');await closed;expect(isProcessDescendant(child.pid!,process.pid,identity)).toBe(false);
  }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;}
});

it('rejects a changed start identity anywhere in an observed ancestry chain',()=>{
  let calls=0;const mock=vi.spyOn(native,'processDetails').mockImplementation(pid=>({parent:process.pid,start:++calls===1?'first':'replacement'}));
  try{expect(isProcessDescendant(2147483646,process.pid,processIdentity(process.pid)!)).toBe(false);}finally{mock.mockRestore();}
});
