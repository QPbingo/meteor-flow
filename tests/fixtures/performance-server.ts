import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import type { Worker } from 'node:worker_threads';
import type { Binding, Project, Task } from '@meteor-flow/contracts';
import { AgentConsole } from '../../apps/server/dist/application/console.js';
import { Repository } from '../../apps/server/dist/storage/database.js';
import { createServer } from '../../apps/server/dist/http/server.js';
import { FakeHerdr } from './fake-herdr.js';

// Separate service process: RSS excludes benchmark HTTP/WS clients and Vitest.
const directory = process.argv[2];
if (!directory) throw new Error('Pass the isolated benchmark directory');
const dataDir = join(directory,'data');
const work = join(directory,'work');
const one = join(work,'one');
const two = join(work,'two');
await mkdir(dataDir);await mkdir(one,{recursive:true});await mkdir(two);
const fake = new FakeHerdr({session:'meteor-flow-performance',agents:[{terminalId:'flood-one',cwd:one},{terminalId:'flood-two',cwd:two}]});
const databaseFile = join(dataDir,'meteor-flow.sqlite');
const repository = await Repository.open(databaseFile,fake.session);
let project:Project;
const bindings:Binding[] = [];
try {
  project = repository.execute({type:'project.create',data:{name:'Performance fixture',root:work}}).result as Project;
  for (const observation of fake.agents.values()) {
    const binding:Binding = {
      id:`binding-${bindings.length+1}`,projectId:project.id,session:fake.session,terminalId:observation.terminalId,
      label:observation.terminalId,type:observation.type,cwd:observation.cwd,fingerprint:observation.fingerprint,
      agentSession:observation.agentSession,mode:'observe',confirmed:false,managed:false,paused:true,reason:'Performance observation only',revision:1,observation,
    };
    repository.execute({type:'binding.create',data:binding});bindings.push(binding);
  }
  repository.execute({type:'settings',paused:true,concurrency:2});
} finally { repository.close(); }
// Schema and parent rows were created by the real Repository. Seed the 1000
// historical cancelled tasks in one isolated transaction before its writer starts.
const Database = createRequire(new URL('../../apps/server/package.json',import.meta.url))('better-sqlite3');
const database = new Database(databaseFile);
try {
  database.pragma('foreign_keys = ON');
  const insert = database.prepare('INSERT INTO tasks(id,project_id,binding_id,data) VALUES(?,?,?,?)');
  database.transaction(() => {
    for (let i=0;i<1000;i++) {
      const task:Task = {
        id:`historical-${i}`,projectId:project.id,bindingId:bindings[i%2]!.id,title:`Historical task ${i}`,instructions:'Completed benchmark history',
        dependencies:[],requiredArtifacts:[],outputRoots:[],revision:2,createdAt:Date.now()-1000*(1000-i),order:i+1,archived:false,
        currentAttemptId:null,phase:'cancelled',reason:'Cancelled before dispatch',
      };
      insert.run(task.id,task.projectId,task.bindingId,JSON.stringify(task));
    }
  })();
} finally { database.close(); }
const service = new AgentConsole({dataDir,session:fake.session,executable:resolve('tests/fixtures/terminal-flood.mjs'),portFactory:()=>fake});
await service.open();
const http = await createServer(service,{port:0,listSessions:async()=>[]});
const started = performance.now();
// [DEBUG-perf-20261007] Test-only instrumentation, enabled for the two
// single-variable diagnosis runs. Never installs a hook in the product worker.
let samplingWorker = false;
const sampling = setInterval(() => {
  const memory = process.memoryUsage();
  if (!process.env.METEOR_FLOW_PERFORMANCE_DIAGNOSTIC && process.env.METEOR_FLOW_PERFORMANCE_TELEMETRY !== '1') {
    process.send?.({type:'sample',elapsedMs:performance.now()-started,...memory});return;
  }
  if (samplingWorker) return;
  samplingWorker = true;
  const worker = Reflect.get(service.store,'worker') as Worker|null;
  void (async () => {
    try {
      const workerHeap = worker ? await worker.getHeapStatistics() : null;
      const mainHeap = getHeapStatistics();
      process.send?.({type:'sample',elapsedMs:performance.now()-started,...memory,workerHeap,mainHeap,
        tasks:service.store.state.tasks.length,operations:service.store.state.operations.length,
        // Diagnostic residual, not an exact native allocator measurement: RSS
        // also includes code, stacks, mapped files and unused resident pages.
        rssOutsideReportedHeapAndExternal:workerHeap ? memory.rss-memory.heapTotal-memory.external-workerHeap.total_heap_size-workerHeap.external_memory : null});
    } catch (error) { if (!closing) process.send?.({type:'sample-error',message:String(error)}); }
    finally { samplingWorker=false; }
  })();
},1000);
let closing = false;
const shutdown = async () => {
  if (closing) return;closing=true;clearInterval(sampling);
  await http.app.close();await service.close();
  process.send?.({type:'stopped',tasks:service.store.state.tasks.length,prompts:fake.prompts.length});
  process.disconnect();
};
process.on('message',message => { if ((message as {type:string}).type === 'close') void shutdown().catch(error => { console.error(error);process.exit(1); }); });
process.on('disconnect',() => { void shutdown().catch(() => process.exit(1)); });
process.send?.({type:'ready',address:http.address,dataDir,projectId:project.id,bindingIds:bindings.map(binding=>binding.id),pid:process.pid,
  startedAt:performance.timeOrigin+started});
