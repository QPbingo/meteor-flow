import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  createFile, failure, lockExclusive, makeDirectory, openDirectory, openLock, openRead,
  processDetails, processStart, removeDirectory, requirePlatform, statAt, unlinkAt, type FileStat,
} from './native.js';

export type FileSnapshot = {
  data: Buffer;
  sha256: string;
  size: number;
  identity: { dev: string; ino: string; size: string; mtimeNs: string; ctimeNs: string };
};

type Directory = { fd: number; stat: FileStat; name: string };
type DirectoryChain = { absolute: string; entries: Directory[]; fd: number };
const TYPE_MASK = 0o170000n;
const REGULAR = 0o100000n;
const DIRECTORY = 0o040000n;

function validPath(value: string): void {
  if (typeof value !== 'string' || !value || value.includes('\0')) {
    throw failure('UNSAFE_PATH', 'Path must be a nonempty string without NUL');
  }
}

function components(relativePath: string): string[] {
  validPath(relativePath);
  const parts = relativePath.split('/');
  if (path.isAbsolute(relativePath) || parts.some(part => part === '' || part === '.' || part === '..')) {
    throw failure('UNSAFE_PATH', 'Only relative paths with ordinary components are allowed');
  }
  return parts;
}

function sameNode(a: FileStat, b: FileStat): boolean {
  return a.dev === b.dev && a.ino === b.ino && (a.mode & TYPE_MASK) === (b.mode & TYPE_MASK);
}

function sameFile(a: FileStat, b: FileStat): boolean {
  return sameNode(a, b) && a.nlink === b.nlink && a.size === b.size &&
    a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

function requireSame(a: FileStat, b: FileStat): void {
  if (!sameFile(a, b)) throw failure('FILE_CHANGED', 'File changed during collection');
}

function regular(stat: FileStat): void {
  if ((stat.mode & TYPE_MASK) !== REGULAR || stat.nlink !== 1n) {
    throw failure('UNSAFE_FILE', 'Only regular files with a single link are allowed');
  }
}

function closeChain(chain: DirectoryChain): void {
  for (const entry of chain.entries.toReversed()) fs.closeSync(entry.fd);
}

function appendDirectory(chain: DirectoryChain, name: string): void {
  const fd = openDirectory(chain.fd, name);
  try {
    const stat = fs.fstatSync(fd, { bigint: true });
    if ((stat.mode & TYPE_MASK) !== DIRECTORY) throw failure('UNSAFE_PATH', 'Not a directory');
    chain.entries.push({ fd, stat, name });
    chain.fd = fd;
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

function openAbsoluteDirectory(absolute: string): DirectoryChain {
  validPath(absolute);
  if (!path.isAbsolute(absolute) || path.normalize(absolute) !== absolute) {
    throw failure('UNSAFE_PATH', 'A frozen absolute canonical directory is required');
  }
  // Darwin AT_FDCWD. The only absolute open is the fixed filesystem root.
  const rootfd = openDirectory(-2, '/');
  const chain: DirectoryChain = { absolute, entries: [], fd: rootfd };
  try {
    chain.entries.push({ fd: rootfd, stat: fs.fstatSync(rootfd, { bigint: true }), name: '/' });
    for (const name of absolute.split('/').filter(Boolean)) appendDirectory(chain, name);
    return chain;
  } catch (error) {
    // The root fstat itself may fail, before it enters entries.
    if (!chain.entries.length) fs.closeSync(rootfd);
    else closeChain(chain);
    throw error;
  }
}

function verifyChain(chain: DirectoryChain): void {
  const current = openAbsoluteDirectory(chain.absolute);
  try {
    if (current.entries.length !== chain.entries.length || current.entries.some((entry, i) =>
      !sameNode(entry.stat, chain.entries[i]!.stat))) {
      throw failure('FILE_CHANGED', 'Directory path changed during collection');
    }
  } finally {
    closeChain(current);
  }
}

/** Resolve an authorized root once; persist this canonical value in its binding. */
export function canonicalDirectory(directory: string): string {
  requirePlatform();
  validPath(directory);
  const absolute = fs.realpathSync.native(directory);
  const chain = openAbsoluteDirectory(absolute);
  try {
    verifyChain(chain);
    if (fs.realpathSync.native(directory) !== absolute) throw failure('FILE_CHANGED', 'Directory changed');
    return absolute;
  } finally {
    closeChain(chain);
  }
}

export function directoriesOverlap(a: string, b: string): boolean {
  const first = canonicalDirectory(a);
  const second = canonicalDirectory(b);
  const firstStat = fs.statSync(first, { bigint: true });
  const secondStat = fs.statSync(second, { bigint: true });
  const contains = (parent: string, child: string) => child === parent || child.startsWith(parent === '/' ? '/' : `${parent}/`);
  return sameNode(firstStat, secondStat) || contains(first, second) || contains(second, first);
}

/** Reserve one attempt's private directory without overwriting an earlier run. */
export function createRunDirectory(root: string, attemptId: string): string {
  if (typeof attemptId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attemptId)) {
    throw failure('UNSAFE_PATH', 'Attempt ID must be a UUID');
  }
  const chain = openAbsoluteDirectory(root);
  let leafParent: number | undefined;
  let created: FileStat | undefined;
  let completed = false;
  try {
    for (const name of ['.meteor-flow', 'runs']) {
      verifyChain(chain);
      makeDirectory(chain.fd, name, true);
      appendDirectory(chain, name);
      chain.absolute = path.join(chain.absolute, name);
    }
    verifyChain(chain);
    leafParent = chain.fd;
    makeDirectory(leafParent, attemptId, false);
    created = statAt(leafParent, attemptId);
    appendDirectory(chain, attemptId);
    chain.absolute = path.join(chain.absolute, attemptId);
    if (!sameNode(created, fs.fstatSync(chain.fd, { bigint: true }))) throw failure('FILE_CHANGED', 'Run directory changed');
    verifyChain(chain);
    fs.fsyncSync(chain.fd);
    fs.fsyncSync(leafParent);
    completed = true;
    return chain.absolute;
  } finally {
    try {
      if (!completed && created && leafParent !== undefined) {
        try { if (sameNode(created, statAt(leafParent, attemptId))) removeDirectory(leafParent, attemptId); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
    } finally { closeChain(chain); }
  }
}

function sourceParent(root: string, relativePath: string): { chain: DirectoryChain; leaf: string } {
  const parts = components(relativePath);
  // Authorization canonicalizes once. Re-resolving here would turn a replaced
  // root symlink into a new, implicitly authorized source.
  const canonical = root;
  const chain = openAbsoluteDirectory(canonical);
  try {
    for (const part of parts.slice(0, -1)) appendDirectory(chain, part);
    chain.absolute = path.join(canonical, ...parts.slice(0, -1));
    verifyChain(chain);
    return { chain, leaf: parts.at(-1)! };
  } catch (error) {
    closeChain(chain);
    throw error;
  }
}

function collect(root: string, relativePath: string, maxBytes: number, consume: (chunk: Buffer) => void): Omit<FileSnapshot, 'data'> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw failure('INVALID_LIMIT', 'File limit must be a nonnegative safe integer');
  }
  const { chain, leaf } = sourceParent(root, relativePath);
  let fd: number | undefined;
  try {
    const before = statAt(chain.fd, leaf);
    regular(before);
    if (before.size > BigInt(maxBytes)) throw failure('FILE_TOO_LARGE', 'File exceeds collection limit');
    fd = openRead(chain.fd, leaf);
    const opened = fs.fstatSync(fd, { bigint: true });
    regular(opened);
    requireSame(before, opened);
    verifyChain(chain);
    requireSame(opened, statAt(chain.fd, leaf));
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let size = 0;
    while (true) {
      // Read at most one byte beyond the limit, and never deliver that byte.
      const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, maxBytes - size + 1), null);
      if (!count) break;
      size += count;
      if (size > maxBytes) throw failure('FILE_TOO_LARGE', 'File exceeds collection limit');
      const chunk = buffer.subarray(0, count);
      hash.update(chunk);
      consume(chunk);
    }
    requireSame(opened, fs.fstatSync(fd, { bigint: true }));
    requireSame(opened, statAt(chain.fd, leaf));
    verifyChain(chain);
    if (BigInt(size) !== opened.size) throw failure('FILE_CHANGED', 'File length changed during collection');
    return {
      size, sha256: hash.digest('hex'),
      identity: {
        dev: opened.dev.toString(), ino: opened.ino.toString(), size: opened.size.toString(),
        mtimeNs: opened.mtimeNs.toString(), ctimeNs: opened.ctimeNs.toString(),
      },
    };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    closeChain(chain);
  }
}

/** Synchronous and bounded: run only in the supervised collection subprocess. */
export function safeRead(root: string, relativePath: string, maxBytes: number): FileSnapshot {
  const chunks: Buffer[] = [];
  const snapshot = collect(root, relativePath, maxBytes, chunk => chunks.push(Buffer.from(chunk)));
  return { ...snapshot, data: Buffer.concat(chunks, snapshot.size) };
}

/** Create a new private staging file; existing destinations are never overwritten. */
export function safeCopy(root: string, relativePath: string, destination: string, maxBytes: number): Omit<FileSnapshot, 'data'> {
  validPath(destination);
  const absolute = path.resolve(destination);
  const parent = path.dirname(absolute);
  const leaf = path.basename(absolute);
  components(leaf);
  const chain = openAbsoluteDirectory(parent);
  let fd: number | undefined;
  let created: FileStat | undefined;
  let completed = false;
  try {
    fd = createFile(chain.fd, leaf);
    created = fs.fstatSync(fd, { bigint: true });
    regular(created);
    const output = fd;
    const snapshot = collect(root, relativePath, maxBytes, chunk => {
      let offset = 0;
      while (offset < chunk.length) {
        const count = fs.writeSync(output, chunk, offset, chunk.length - offset);
        if (count <= 0) throw failure('WRITE_FAILED', 'Staging write made no progress');
        offset += count;
      }
    });
    fs.fsyncSync(fd);
    const final = fs.fstatSync(fd, { bigint: true });
    regular(final);
    if (!sameNode(created, final) || final.size !== BigInt(snapshot.size)) throw failure('FILE_CHANGED', 'Staging changed');
    requireSame(final, statAt(chain.fd, leaf));
    verifyChain(chain);
    fs.fsyncSync(chain.fd);
    completed = true;
    return snapshot;
  } finally {
    try {
      if (!completed && created) {
        // Never remove a replacement created by another actor.
        try { if (sameNode(created, statAt(chain.fd, leaf))) unlinkAt(chain.fd, leaf); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      closeChain(chain);
    }
  }
}

/** Keep this handle in the service main process for the entire service lifetime. */
export function acquireLock(lockPath: string): { release(): void } {
  validPath(lockPath);
  const absolute = path.resolve(lockPath);
  const parent = canonicalDirectory(path.dirname(absolute));
  const leaf = path.basename(absolute);
  components(leaf);
  const chain = openAbsoluteDirectory(parent);
  let fd: number | undefined;
  try {
    fd = openLock(chain.fd, leaf);
    const stat = fs.fstatSync(fd, { bigint: true });
    regular(stat);
    lockExclusive(fd);
    requireSame(stat, statAt(chain.fd, leaf));
    verifyChain(chain);
    const held = fd;
    fd = undefined;
    let released = false;
    return { release() {
      if (released) return;
      released = true;
      fs.closeSync(held);
    } };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    closeChain(chain);
  }
}

/** Read-only PID/start-time evidence; an unavailable identity is never guessed. */
export function processIdentity(pid: number): string | null {
  requirePlatform();
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 2_147_483_647) return null;
  try {
    const before = processStart(pid);
    if (!before) return null;
    const result = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'pid=', '-o', 'lstart='], {
      encoding: 'utf8', timeout: 2_000, maxBuffer: 4096, env: { LC_ALL: 'C', LANG: 'C' },
    });
    if (result.error || result.status !== 0) return null;
    const match = /^(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})$/.exec(result.stdout.trim());
    // The PID may exit and be reused while ps runs. Do not return evidence
    // from two different processes, or rely on ps's seconds-only precision.
    return match && Number(match[1]) === pid && processStart(pid) === before ? `${pid}:${before}` : null;
  } catch {
    return null;
  }
}

/** A bounded, rechecked live parent chain. Unavailable/reparented/reused
 * processes never count as evidence that an unrelated foreground PID is safe. */
export function isProcessDescendant(pid:number,ancestor:number,ancestorIdentity:string):boolean{
  requirePlatform();
  if(!Number.isSafeInteger(pid)||pid<=0||pid>2147483647||pid===ancestor)return false;
  const chain:Array<{pid:number;start:string;parent:number}>=[];
  const visited=new Set<number>();
  try{
    let current=pid;
    while(current!==ancestor){
      if(current<=1||visited.has(current)||chain.length>=64)return false;
      visited.add(current);const details=processDetails(current);if(!details)return false;
      chain.push({pid:current,...details});current=details.parent;
    }
    if(`${ancestor}:${processStart(ancestor)}`!==ancestorIdentity)return false;
    return chain.every(entry=>{const after=processDetails(entry.pid);return after?.start===entry.start&&after.parent===entry.parent;});
  }catch{return false;}
}
