import { spawn } from 'node:child_process';
import { acquireLock } from '../src/index.js';

try {
  const lock = acquireLock(process.argv[2]!);
  process.send?.({ type: 'locked' });
  process.on('message', (message: { command: string; socket?: string }) => {
    if (message.command === 'release') {
      lock.release();
      lock.release();
      process.send?.({ type: 'released' });
      process.disconnect();
    } else if (message.command === 'descendant') {
      const child = spawn(process.execPath, ['--input-type=module', '-e',
        'import net from "node:net"; const c=net.connect(process.argv[1]); c.on("connect",()=>c.write("ready")); c.on("data",()=>process.exit(0)); c.on("error",()=>process.exit(1));',
        message.socket!], { stdio: 'ignore' });
      child.on('error', error => { process.send?.({ type: 'error', message: error.message }); });
    }
  });
} catch (error) {
  process.send?.({ type: 'denied', code: (error as NodeJS.ErrnoException).code });
  process.disconnect();
}
