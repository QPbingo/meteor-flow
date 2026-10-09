import { parentPort, workerData } from 'node:worker_threads';
import { existsSync, writeFileSync } from 'node:fs';
import { Repository } from '../../apps/server/dist/storage/database.js';

const { file, session, generation } = workerData;
const repository = await Repository.open(file, session);
const marker = `${file}.committed`;
parentPort.on('message', message => {
  if (message.generation !== generation) return;
  const reply = repository.execute(message.command, message.operation);
  if (message.operation?.id === 'drop-reply' && !existsSync(marker)) {
    writeFileSync(marker, 'committed', { flag: 'wx' });
    // Simulates a committed transaction whose acknowledgement never reaches the owner.
    return;
  }
  parentPort.postMessage({ generation, id: message.id, ok: true, ...reply });
});
parentPort.postMessage({ generation, ready: true, state: repository.read() });
