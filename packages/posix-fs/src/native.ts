import fs from 'node:fs';
import { getSystemErrorName } from 'node:util';
import koffi from 'koffi';

export function failure(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

export function requirePlatform(): void {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw failure('UNSUPPORTED_PLATFORM', 'POSIX file safety is verified only on macOS arm64');
  }
}

// Darwin arm64 ABI, from the platform SDK sys/stat.h and sys/fcntl.h.
// No caller can select the library, symbol, flags, or pointer layout.
function loadNative() {
  requirePlatform();
  const lib = koffi.load('/usr/lib/libSystem.B.dylib');
  const timespec = koffi.struct({ sec: 'int64_t', nsec: 'int64_t' });
  const stat = koffi.struct({
    dev: 'int32_t', mode: 'uint16_t', nlink: 'uint16_t', ino: 'uint64_t',
    uid: 'uint32_t', gid: 'uint32_t', rdev: 'int32_t',
    atime: timespec, mtime: timespec, ctime: timespec, birthtime: timespec,
    size: 'int64_t', blocks: 'int64_t', blksize: 'int32_t', flags: 'uint32_t',
    gen: 'uint32_t', lspare: 'int32_t', qspare: koffi.array('int64_t', 2),
  });
  return {
    openat: lib.func('int openat(int dirfd, const char *path, int flags, ...)'),
    fstatat: lib.func('fstatat', 'int', ['int', 'str', koffi.out(koffi.pointer(stat)), 'int']),
    flock: lib.func('int flock(int fd, int operation)'),
    fcntl: lib.func('int fcntl(int fd, int command, ...)'),
    unlinkat: lib.func('int unlinkat(int dirfd, const char *path, int flags)'),
    mkdirat: lib.func('int mkdirat(int dirfd, const char *path, uint32_t mode)'),
    pidinfo: lib.func('int proc_pidinfo(int pid, int flavor, uint64_t arg, void *buffer, int buffersize)'),
  };
}

let native: ReturnType<typeof loadNative> | undefined;
function api() { return native ??= loadNative(); }
function checked(result: number, operation: string): number {
  if (result < 0) {
    const errno = koffi.errno();
    throw Object.assign(failure(getSystemErrorName(-errno), `${operation} failed`), { errno });
  }
  return result;
}

const CLOEXEC = 0x01000000;
const DIRECTORY = fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW | CLOEXEC;
const LEAF = fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK | CLOEXEC;

function open(dirfd: number, name: string, flags: number, create = false): number {
  const fn = api().openat;
  const fd = checked(create ? fn(dirfd, name, flags, 'uint32_t', 0o600) : fn(dirfd, name, flags), 'openat');
  try {
    if ((checked(api().fcntl(fd, 1), 'fcntl F_GETFD') & 1) !== 1) {
      throw failure('CLOEXEC_UNAVAILABLE', 'File descriptor is not close-on-exec');
    }
    return fd;
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

export const openDirectory = (parent: number, name: string) => open(parent, name, DIRECTORY);
export const openRead = (parent: number, name: string) => open(parent, name, LEAF | fs.constants.O_RDONLY);
export const createFile = (parent: number, name: string) =>
  open(parent, name, LEAF | fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, true);
export const openLock = (parent: number, name: string) =>
  open(parent, name, LEAF | fs.constants.O_RDWR | fs.constants.O_CREAT, true);

export type FileStat = {
  dev: bigint; ino: bigint; mode: bigint; nlink: bigint; size: bigint;
  mtimeNs: bigint; ctimeNs: bigint;
};

type NativeInteger = number | bigint;
type NativeStat = {
  dev: NativeInteger; ino: NativeInteger; mode: NativeInteger; nlink: NativeInteger; size: NativeInteger;
  mtime: { sec: NativeInteger; nsec: NativeInteger }; ctime: { sec: NativeInteger; nsec: NativeInteger };
};

export function statAt(parent: number, name: string): FileStat {
  const out: NativeStat = { dev: 0, ino: 0, mode: 0, nlink: 0, size: 0, mtime: { sec: 0, nsec: 0 }, ctime: { sec: 0, nsec: 0 } };
  checked(api().fstatat(parent, name, out, 0x20), 'fstatat'); // AT_SYMLINK_NOFOLLOW
  return {
    dev: BigInt.asUintN(32, BigInt(out.dev)), ino: BigInt(out.ino), mode: BigInt(out.mode),
    nlink: BigInt(out.nlink), size: BigInt(out.size),
    mtimeNs: BigInt(out.mtime.sec) * 1_000_000_000n + BigInt(out.mtime.nsec),
    ctimeNs: BigInt(out.ctime.sec) * 1_000_000_000n + BigInt(out.ctime.nsec),
  };
}

export function lockExclusive(fd: number): void {
  checked(api().flock(fd, 2 | 4), 'flock'); // LOCK_EX | LOCK_NB
}

export function unlinkAt(parent: number, name: string): void {
  checked(api().unlinkat(parent, name, 0), 'unlinkat');
}

export function makeDirectory(parent: number, name: string, allowExisting: boolean): void {
  try { checked(api().mkdirat(parent, name, 0o700), 'mkdirat'); }
  catch (error) {
    if (!allowExisting || (error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

export function removeDirectory(parent: number, name: string): void {
  checked(api().unlinkat(parent, name, 0x80), 'unlinkat directory'); // AT_REMOVEDIR
}

export function processDetails(pid:number):{start:string;parent:number}|null{
  // Fixed Darwin arm64 proc_bsdinfo layout, sys/proc_info.h. This query is
  // read-only; microseconds distinguish starts that ps renders in one second.
  const info = Buffer.alloc(136);
  if (api().pidinfo(pid, 3, 0, info, info.length) !== info.length || info.readUInt32LE(12) !== pid) return null;
  const seconds = info.readBigUInt64LE(120);
  const microseconds = info.readBigUInt64LE(128);
  if (seconds === 0n || microseconds >= 1_000_000n) return null;
  return {start:`${seconds}:${microseconds}`,parent:info.readUInt32LE(16)};
}

export function processStart(pid:number):string|null{return processDetails(pid)?.start??null;}
