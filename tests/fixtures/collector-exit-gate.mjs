import { watch, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

process.on('disconnect', () => process.exit(2));
process.once('message', request => {
  // A successful IPC message is deliberately sent while this writer still owns
  // open process/IPC resources. The test decides when it may actually exit.
  process.send({ ok: true, input: request.input }, () => {
    writeFileSync(join(request.staging, 'candidate-sent'), 'candidate');
    const watcher = watch(request.staging, () => {
      if (existsSync(join(request.staging, 'release'))) { watcher.close(); process.exit(0); }
    });
  });
});
process.send({ ready: true });
