import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it } from 'vitest';

const enabled = process.env.METEOR_FLOW_PERFORMANCE === '1';
const diagnostic = process.env.METEOR_FLOW_PERFORMANCE_DIAGNOSTIC;
const durationMs = Number(process.env.METEOR_FLOW_PERFORMANCE_DURATION_MS ?? 30000);
if (![30000,90000].includes(durationMs)) throw new Error('Performance duration must be 30000 or explicit 90000');
const extendedDiagnosis = durationMs === 90000;
if (diagnostic && !['writes-only','terminals-only'].includes(diagnostic)) throw new Error('Unknown performance diagnosis mode');
if ((diagnostic || extendedDiagnosis) && !process.env.METEOR_FLOW_PERFORMANCE_EVIDENCE) throw new Error('Diagnosis requires a separate evidence directory');
if (extendedDiagnosis && diagnostic) throw new Error('The 90-second diagnosis keeps the complete workload');
const withTerminals = diagnostic !== 'writes-only';
const withTaskWrites = diagnostic !== 'terminals-only';
const MiB = 1024*1024;
const evidenceDirectory = process.env.METEOR_FLOW_PERFORMANCE_EVIDENCE ?? resolve('tasks/001-local-agent-console/verification-runs/20261007-implementation-preflight');
type Socket = EventEmitter & { close():void; terminate():void; readyState:number };
const WebSocket = createRequire(new URL('../../apps/server/package.json',import.meta.url))('ws') as new (url:string, options:{headers:Record<string,string>}) => Socket;
type Sample = { elapsedMs:number; rss:number; heapUsed:number; external:number; arrayBuffers:number };
type Ready = { address:string; dataDir:string; projectId:string; bindingIds:string[]; pid:number; startedAt:number };
const percentile = (numbers:number[], fraction:number) => [...numbers].sort((a,b)=>a-b)[Math.max(0,Math.ceil(numbers.length*fraction)-1)]!;

function message(child:ChildProcess, type:string):Promise<Record<string,any>> {
  return new Promise((resolve,reject) => {
    const timeout = setTimeout(() => finish(new Error(`Service ${type} IPC timeout`)),10000);
    const receive = (value:Record<string,any>) => { if (value.type === type) finish(undefined,value); };
    const exit = () => finish(new Error(`Service exited before ${type}`));
    const finish = (error?:Error,value?:Record<string,any>) => {
      clearTimeout(timeout);child.off('message',receive);child.off('exit',exit);error ? reject(error) : resolve(value!);
    };
    child.on('message',receive);child.once('exit',exit);
  });
}
function slope(samples:Sample[]):number {
  const xMean = samples.reduce((sum,sample)=>sum+sample.elapsedMs/1000,0)/samples.length;
  const yMean = samples.reduce((sum,sample)=>sum+sample.rss/MiB,0)/samples.length;
  return samples.reduce((sum,sample)=>sum+(sample.elapsedMs/1000-xMean)*(sample.rss/MiB-yMean),0)/
    samples.reduce((sum,sample)=>sum+(sample.elapsedMs/1000-xMean)**2,0);
}

// Opt-in, real isolated DB/HTTP/WS/CLI; herdr only is simulated. Build first.
it.runIf(enabled)(`1000 history tasks and two 1 MiB/s terminals for ${durationMs/1000} seconds keep local operations responsive`, async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(),'meteor-performance-')));
  const trigger = join(directory,'start.json');
  const samples:Sample[] = [];
  const sampleErrors:string[] = [];
  const outputSamples:Array<{elapsedMs:number;bytes:number[]}> = [];
  const sockets:Socket[] = [];
  let stderr = '';
  const report:Record<string,any> = {
    kind:diagnostic || extendedDiagnosis ? 'isolated-performance-diagnosis' : 'isolated-performance-test',diagnostic:diagnostic??(extendedDiagnosis ? 'continuous-90-seconds' : null),
    workerTelemetry:!!diagnostic || extendedDiagnosis || process.env.METEOR_FLOW_PERFORMANCE_TELEMETRY === '1',date:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,
    externalBoundary:'FakeHerdr; no model or user session',status:'running',historyTasks:1000,
    targets:{listP95Ms:200,operationP95Ms:500,streams:withTerminals ? 2 : 0,taskWrites:withTaskWrites,bytesPerSecondPerStream:MiB,durationMs},
    memoryMethod:{scope:'service process including SQLite worker; excludes clients and CLI children',warmupSeconds:10,
      maxPostWarmupSlopeMiBPerSecond:1,maxRetainedGrowthMiB:32,
      windows:extendedDiagnosis ? ['10–90 seconds','60–90 seconds'] : ['10–30 seconds'],
      acceptanceWindow:extendedDiagnosis ? '60–90 seconds for duration diagnosis only; original 30-second failures stay open' : '10–30 seconds',
      proofLimit:'finite observation; not an infinite-duration memory-leak proof'},
  };
  const server = fork(new URL('../fixtures/performance-server.ts',import.meta.url),[directory],{
    execPath:process.execPath,execArgv:['--import','tsx'],stdio:['ignore','ignore','pipe','ipc'],
    env:{...process.env,METEOR_PERFORMANCE_START_FILE:trigger,...(extendedDiagnosis ? {METEOR_FLOW_PERFORMANCE_TELEMETRY:'1'} : {})},
  });
  server.stderr?.on('data',chunk => { stderr = (stderr+String(chunk)).slice(-8192); });
  server.on('message',(value:Record<string,any>) => {
    if (value.type === 'sample') samples.push(value as Sample);
    if (value.type === 'sample-error') sampleErrors.push(value.message);
  });
  const serverExit = once(server,'exit');
  let outputTimer:NodeJS.Timeout|undefined;
  try {
    const ready = await message(server,'ready') as Ready;
    const entry = JSON.parse(await readFile(join(ready.dataDir,'open.json'),'utf8'));
    const token = new URLSearchParams(new URL(entry.url).hash.slice(1)).get('token');
    const auth = await fetch(`${ready.address}/api/v1/auth/bootstrap`,{method:'POST',headers:{origin:ready.address,'content-type':'application/json'},body:JSON.stringify({token}),signal:AbortSignal.timeout(5000)});
    expect(auth.status).toBe(200);
    const cookie = auth.headers.get('set-cookie')!.split(';')[0]!;
    const {csrf} = await auth.json() as {csrf:string};
    const headers = {cookie,origin:ready.address,'content-type':'application/json','x-csrf-token':csrf};
    const readLatencies:number[] = [];
    for (let i=0;i<100;i++) {
      const start = performance.now();
      const response = await fetch(`${ready.address}/api/v1/tasks?offset=${i%20*50}&limit=50`,{headers,signal:AbortSignal.timeout(5000)});
      const body = await response.json() as {tasks:unknown[];total:number};
      readLatencies.push(performance.now()-start);expect(response.status).toBe(200);expect(body.tasks).toHaveLength(50);expect(body.total).toBe(1000);
    }
    report.list = {samples:readLatencies,p95Ms:percentile(readLatencies,0.95),maxMs:Math.max(...readLatencies)};
    const totals = [0,0];
    const done:Array<Record<string,any>|null> = [null,null];
    const donePromises:Promise<void>[] = [];
    const socketErrors:string[] = [];
    for (const [index,bindingId] of (withTerminals ? ready.bindingIds : []).entries()) {
      const socket = new WebSocket(`${ready.address.replace('http:','ws:')}/api/v1/terminals/${bindingId}?csrf=${csrf}`,{headers});
      sockets.push(socket);
      let readyResolve!:()=>void;let doneResolve!:()=>void;
      const receivedReady = new Promise<void>(resolve => { readyResolve=resolve; });
      donePromises.push(new Promise<void>(resolve => { doneResolve=resolve; }));
      socket.on('error',error => socketErrors.push(String(error)));
      socket.on('message',bytes => {
        const frame = JSON.parse(String(bytes));
        if (frame.protocol !== 'meteor-flow.terminal/v1') { socketErrors.push('missing output protocol');return; }
        if (frame.type === 'error') { socketErrors.push(frame.message);return; }
        if (frame.type !== 'output') return;
        if (frame.data.startsWith('PERF_READY:')) readyResolve();
        else if (frame.data.startsWith('PERF_DONE:')) { done[index]=JSON.parse(frame.data.slice('PERF_DONE:'.length));doneResolve(); }
        else totals[index] += Buffer.byteLength(frame.data);
      });
      await once(socket,'open');
      let timeout:NodeJS.Timeout|undefined;
      try { await Promise.race([receivedReady,new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Terminal ready timeout')),5000);})]); }
      finally { clearTimeout(timeout); }
    }
    const startAt = Date.now()+200;
    await writeFile(trigger,JSON.stringify({startAt,durationMs,bytesPerSecond:MiB}),{flag:'wx',mode:0o600});
    await delay(Math.max(0,startAt-Date.now()));
    const loadStart = performance.now();
    // Align both process monotonic clocks through their epoch-relative origins;
    // using the previous 1-second sample would shift the declared windows.
    const serverLoadStart = performance.timeOrigin+loadStart-ready.startedAt;
    report.memoryMethod.workloadStartServerElapsedMs = serverLoadStart;
    outputTimer = setInterval(()=>outputSamples.push({elapsedMs:performance.now()-loadStart,bytes:[...totals]}),1000);
    const operations:Array<{kind:string;ms:number;taskId:string}> = [];
    while (performance.now()-loadStart < durationMs) {
      if (!withTaskWrites) { await delay(250);continue; }
      const createStart = performance.now();
      const created = await fetch(`${ready.address}/api/v1/tasks`,{method:'POST',headers,body:JSON.stringify({
        operation_id:randomUUID(),projectId:ready.projectId,bindingId:ready.bindingIds[Math.floor(operations.length/2)%2],title:'Responsive operation',
        instructions:'Benchmark only; never dispatch',dependencies:[],requiredArtifacts:[],outputRoots:[],
      }),signal:AbortSignal.timeout(5000)});
      const task = await created.json() as {id:string;phase:string};
      operations.push({kind:'create',ms:performance.now()-createStart,taskId:task.id});expect(created.status).toBe(200);expect(task.phase).toBe('queued');
      const cancelStart = performance.now();
      const cancelled = await fetch(`${ready.address}/api/v1/tasks/${task.id}/actions`,{method:'POST',headers,
        body:JSON.stringify({operation_id:randomUUID(),action:'cancel'}),signal:AbortSignal.timeout(5000)});
      const result = await cancelled.json() as {phase:string};
      operations.push({kind:'cancel',ms:performance.now()-cancelStart,taskId:task.id});expect(cancelled.status).toBe(200);expect(result.phase).toBe('cancelled');
      await delay(250); // Workload cadence only; completion uses actual CLI DONE frames.
    }
    let completeTimeout:NodeJS.Timeout|undefined;
    try { await Promise.race([Promise.all(donePromises),new Promise<never>((_,reject)=>{completeTimeout=setTimeout(()=>reject(new Error('Terminal flood completion timeout')),5000);})]); }
    finally { clearTimeout(completeTimeout); }
    clearInterval(outputTimer);outputTimer=undefined;
    outputSamples.push({elapsedMs:performance.now()-loadStart,bytes:[...totals]});
    const loadedSamples = samples.filter(sample => sample.elapsedMs >= serverLoadStart+10000 && sample.elapsedMs <= serverLoadStart+durationMs);
    const initialWindow = loadedSamples.slice(0,5);
    const finalWindow = loadedSamples.slice(-5);
    const retainedMiB = (percentile(finalWindow.map(sample=>sample.rss),0.5)-percentile(initialWindow.map(sample=>sample.rss),0.5))/MiB;
    const growthSlope = slope(loadedSamples);
    const finalSamples = samples.filter(sample => sample.elapsedMs >= serverLoadStart+durationMs-30000 && sample.elapsedMs <= serverLoadStart+durationMs);
    const finalGrowth = (percentile(finalSamples.slice(-5).map(sample=>sample.rss),0.5)-percentile(finalSamples.slice(0,5).map(sample=>sample.rss),0.5))/MiB;
    const finalSlope = slope(finalSamples);
    report.operations = {samples:operations,p95Ms:percentile(operations.map(op=>op.ms),0.95),maxMs:Math.max(...operations.map(op=>op.ms)),count:operations.length};
    report.output = {totals,cli:done,samples:outputSamples};
    report.memory = {samples,postWarmupSamples:loadedSamples.length,slopeMiBPerSecond:growthSlope,retainedGrowthMiB:retainedMiB,peakRssMiB:Math.max(...samples.map(sample=>sample.rss))/MiB};
    if (extendedDiagnosis) report.memory.windows = [
      {fromSeconds:10,toSeconds:90,samples:loadedSamples.length,slopeMiBPerSecond:growthSlope,retainedGrowthMiB:retainedMiB,withinOriginalNumericalLimits:growthSlope<=1&&retainedMiB<=32},
      {fromSeconds:60,toSeconds:90,samples:finalSamples.length,slopeMiBPerSecond:finalSlope,retainedGrowthMiB:finalGrowth,withinOriginalNumericalLimits:finalSlope<=1&&finalGrowth<=32},
    ];
    report.socketErrors = socketErrors;
    report.sampleErrors = sampleErrors;
    // Record measurements before asserting thresholds, so a failed target is evidence.
    report.status = 'measured';
    await mkdir(evidenceDirectory,{recursive:true});await writeFile(join(evidenceDirectory,'perf.json'),JSON.stringify(report,null,2));
    expect(socketErrors).toEqual([]);
    expect(sampleErrors).toEqual([]);
    expect(report.list.p95Ms).toBeLessThan(200);
    if (withTaskWrites) {
      expect(report.operations.p95Ms).toBeLessThan(500);
      expect(operations.length).toBeGreaterThanOrEqual(100);
    } else expect(operations).toEqual([]);
    expect(totals).toEqual(withTerminals ? [durationMs/1000*MiB,durationMs/1000*MiB] : [0,0]);
    for (const stream of (withTerminals ? done : [])) {
      expect(stream!.bytes).toBe(durationMs/1000*MiB);
      expect(stream!.durationMs).toBeGreaterThanOrEqual(durationMs-100);
      expect(stream!.durationMs).toBeLessThan(durationMs+1000);
    }
    expect(loadedSamples.length).toBeGreaterThanOrEqual(durationMs/1000-12);
    expect(extendedDiagnosis ? finalSlope : growthSlope).toBeLessThanOrEqual(1);
    expect(extendedDiagnosis ? finalGrowth : retainedMiB).toBeLessThanOrEqual(32);
    report.status = 'passed';
    console.info(JSON.stringify({listP95Ms:report.list.p95Ms,operationP95Ms:report.operations.p95Ms,operations:operations.length,
      outputBytes:totals,rssSlopeMiBPerSecond:growthSlope,retainedGrowthMiB:retainedMiB,peakRssMiB:report.memory.peakRssMiB,...(extendedDiagnosis ? {windows:report.memory.windows} : {})}));
  } catch (error) {
    report.status='failed';report.error=error instanceof Error ? error.message : String(error);throw error;
  } finally {
    clearInterval(outputTimer);
    for (const socket of sockets) socket.terminate();
    try {
      if (server.connected) {
        const stopped = message(server,'stopped');server.send({type:'close'});
        const shutdown = await stopped;report.shutdown=shutdown;expect(shutdown.prompts).toBe(0);
        await serverExit;
      }
    } finally {
      if (server.exitCode === null && server.signalCode === null) { server.kill('SIGKILL');await serverExit; }
      report.stderr=stderr;report.memorySamples=samples;report.outputSamples=outputSamples;
      await mkdir(evidenceDirectory,{recursive:true});await writeFile(join(evidenceDirectory,'perf.json'),JSON.stringify(report,null,2));
      await rm(directory,{recursive:true,force:true});
    }
  }
},durationMs+30000);
