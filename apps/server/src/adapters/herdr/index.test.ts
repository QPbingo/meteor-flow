import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Socket } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HerdrClient, HerdrError, listSessions, sessionSocketPath } from './index.js';

type Request = { id: string; method: string; params: Record<string, unknown> };
type Handler = (request: Request, socket: Socket) => void;
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

function respond(socket: Socket, request: Request, result: Record<string, unknown>): void {
  socket.write(JSON.stringify({ id: request.id, result }) + '\n');
}
function agent(paneId = 'w1:p1', overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { terminal_id: 'terminal-1', pane_id: paneId, agent: 'codex', agent_status: 'idle', state_change_seq: 8, cwd: '/tmp',
    agent_session: { source: 'hook', agent: 'codex', kind: 'id', value: 'session-1' }, ...overrides };
}
async function fixture(handler: Handler, timeoutMs = 500, codexHelp: () => Promise<string> = async () => '', codexExecutionPolicy?: 'workspace-write'): Promise<HerdrClient> {
  const directory = await mkdtemp('/tmp/mf-herdr-');
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    let buffer = '';
    socket.on('data', data => {
      buffer += data;
      const end = buffer.indexOf('\n');
      if (end >= 0) { const request: Request = JSON.parse(buffer.slice(0, end)); buffer = ''; handler(request, socket); }
    });
  });
  const path = join(directory, 'api.sock');
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(path, resolve));
  const client = new HerdrClient({ session: 'meteor-flow-test-fixture', socketPath: path, timeoutMs, codexHelp, codexExecutionPolicy });
  cleanup.push(async () => { client.close(); for (const socket of sockets) socket.destroy(); await new Promise<void>(r => server.close(() => r())); await rm(directory, { recursive: true, force: true }); });
  return client;
}
function basics(request: Request, socket: Socket): boolean {
  if (request.method === 'ping') { respond(socket, request, { type: 'pong', version: '0.9.3', protocol: 22 }); return true; }
  if (request.method === 'pane.process_info') {
    respond(socket, request, { type: 'pane_process_info', process_info: { pane_id: request.params.pane_id, foreground_processes: [{ pid: process.pid, name: 'codex' }] } });
    return true;
  }
  return false;
}
function shellReady(request:Request,socket:Socket){
  if(request.method==='pane.get'){respond(socket,request,{type:'pane_info',pane:{terminal_id:'new-terminal',pane_id:'w2:p1'}});return true;}
  if(request.method==='pane.process_info'){respond(socket,request,{type:'pane_process_info',process_info:{shell_pid:42,foreground_process_group_id:42,foreground_processes:[{pid:42,name:'zsh'}]}});return true;}
  return false;
}

describe('herdr NDJSON management adapter', () => {
  it.each<{ help: string; args?: string[]; policy?: 'workspace-write' }>([
    { help: 'Options:\n --no-daemon  Run without shared server\n -c, --config <key=value>', args: ['--no-daemon', '-c', 'check_for_update_on_startup=false'] },
    { help: 'Options:\n -c, --config <key=value>', args: undefined },
    { help: 'Options:\n --no-daemon\n --config <key=value>\n -s, --sandbox <mode>\n -a, --ask-for-approval <policy>', policy: 'workspace-write' as const, args: ['--no-daemon', '-c', 'check_for_update_on_startup=false', '--sandbox', 'workspace-write', '--ask-for-approval', 'on-request'] },
    { help: 'This old CLI does not support --no-daemon.\n -c, --config <key=value>', args: undefined },
  ])('uses only supported fixed Codex startup arguments: $help', async ({ help, args, policy }) => {
    const starts: Request[] = [];
    const client = await fixture((request, socket) => {
      if (shellReady(request, socket) || basics(request, socket)) return;
      if (request.method === 'workspace.create') respond(socket, request, { type: 'workspace_created', root_pane: { terminal_id: 'new-terminal', pane_id: 'w2:p1' } });
      else { starts.push(request); respond(socket, request, { type: 'agent_started', agent: { terminal_id: 'new-terminal' } }); }
    }, 500, async () => help, policy);
    await client.connect(); await client.start('codex', '/tmp');
    expect(starts).toHaveLength(1); expect(starts[0]!.params.args).toEqual(args);
  });

  it('does not create any external workspace when Codex capability discovery fails', async () => {
    const mutations: Request[] = [];
    const client = await fixture((request, socket) => { if (!basics(request, socket)) mutations.push(request); }, 500, async () => { throw new Error('help timeout'); });
    await client.connect();
    await expect(client.start('codex', '/tmp')).rejects.toMatchObject({ code: 'codex_capability_unavailable', uncertain: false });
    expect(mutations).toEqual([]);
  });

  it('rejects an explicit test execution policy when its flags are unavailable', async () => {
    const mutations: Request[] = [];
    const client = await fixture((request, socket) => { if (!basics(request, socket)) mutations.push(request); }, 500, async () => 'Options:\n --no-daemon\n --config <key=value>', 'workspace-write');
    await client.connect();
    await expect(client.start('codex', '/tmp')).rejects.toMatchObject({ code: 'codex_capability_unavailable', uncertain: false });
    expect(mutations).toEqual([]);
  });

  it('rejects a connection change during Codex discovery before creating any workspace', async () => {
    const mutations: Request[] = []; let entered!: () => void; let release!: () => void;
    const reading = new Promise<void>(r => { entered = r; }); const waiting = new Promise<void>(r => { release = r; });
    const client = await fixture((request, socket) => { if (!basics(request, socket)) mutations.push(request); }, 500, async () => { entered(); await waiting; return 'Options:\n --no-daemon\n --config <key=value>'; });
    await client.connect(); const result = expect(client.start('codex', '/tmp')).rejects.toMatchObject({ code: 'stale_generation' });
    await reading; client.close(); release(); await result; expect(mutations).toEqual([]);
  });

  it('exposes continuous instance evidence when an initially absent session becomes available', async () => {
    let row = agent('w1:p1', { agent_session: null });
    const client = await fixture((request, socket) => { if (!basics(request, socket)) respond(socket, request, { type: 'agent_list', agents: [row] }); });
    await client.connect(); const first = (await client.listAgents())[0]!;
    row = agent(); const later = (await client.listAgents())[0]!;
    expect(first.agentSession).toBeNull(); expect(later.agentSession).toBeTruthy();
    expect(first.instanceFingerprint).toBeTruthy(); expect(later.instanceFingerprint).toBe(first.instanceFingerprint);
    expect(later.fingerprint).not.toBe(first.fingerprint);
  });
  it('reads split UTF-8 frames and supports the 0.9.0 contract without completion_seq', async () => {
    const client = await fixture((request, socket) => {
      if (request.method === 'ping') {
        const data = Buffer.from(JSON.stringify({ id: request.id, result: { type: 'pong', version: '0.9.0', protocol: 22, note: '中文' } }) + '\n');
        const split = data.indexOf(Buffer.from('中')) + 1;
        socket.write(data.subarray(0, split)); setImmediate(() => socket.write(data.subarray(split))); return;
      }
      if (basics(request, socket)) return;
      respond(socket, request, { type: 'agent_list', agents: [agent()] });
    });
    expect(await client.connect()).toEqual({ version: '0.9.0', protocol: 22 });
    expect((await client.listAgents())[0]).toMatchObject({ sequence: 8, status: 'idle', launchPending: false, interactiveReady: false, pid: process.pid });
  });

  it.each([{ version: '0.9.3', protocol: 23 }, { version: '0.10.0', protocol: 22 }])('rejects unsupported server metadata %j', async metadata => {
    const client = await fixture((request, socket) => respond(socket, request, { type: 'pong', ...metadata }));
    await expect(client.connect()).rejects.toMatchObject({ code: 'unsupported_version' });
    await expect(client.prompt('terminal-1', 'test')).rejects.toMatchObject({ code: 'not_connected' });
  });

  it.each(['wrong-id', 'oversized', 'invalid-json', 'wrong-type'])('invalidates a %s reply', async kind => {
    const client = await fixture((request, socket) => {
      if (kind === 'wrong-id') socket.write(JSON.stringify({ id: 'other', result: { type: 'pong', version: '0.9.3', protocol: 22 } }) + '\n');
      if (kind === 'oversized') socket.write('x'.repeat(1024 * 1024 + 1));
      if (kind === 'invalid-json') socket.write('{bad}\n');
      if (kind === 'wrong-type') respond(socket, request, { type: 'ok' });
    });
    await expect(client.connect()).rejects.toBeInstanceOf(HerdrError);
    await expect(client.listAgents()).rejects.toMatchObject({ code: 'not_connected' });
  });

  it.each(['timeout', 'disconnect'])('does not replay prompt after %s and closes the observation generation', async fault => {
    let submissions = 0;
    const client = await fixture((request, socket) => {
      if (basics(request, socket)) return;
      if(request.method==='agent.list'){respond(socket,request,{type:'agent_list',agents:[agent()]});return;}
      if (request.method === 'agent.prompt') { submissions++; if (fault === 'disconnect') socket.destroy(); }
    }, 50);
    await client.connect();await client.listAgents();
    await expect(client.prompt('terminal-1', 'one submission')).rejects.toMatchObject({ uncertain: true });
    expect(submissions).toBe(1);
    await expect(client.prompt('terminal-1', 'cannot replay automatically')).rejects.toMatchObject({ code: 'not_connected' });
    expect(submissions).toBe(1);
  });

  it('sends one explicit Ctrl-C and does not claim the agent has stopped', async () => {
    const commands: Request[] = [];
    const client = await fixture((request, socket) => {
      if (basics(request, socket)) return;
      if(request.method==='agent.list'){respond(socket,request,{type:'agent_list',agents:[agent()]});return;}
      commands.push(request); respond(socket, request, { type: 'ok' });
    });
    await client.connect();await client.listAgents(); await client.interrupt('terminal-1');
    expect(commands.map(x => [x.method, x.params])).toEqual([['agent.send_keys', { target: 'w1:p1', keys: ['C-c'] }]]);
  });

  it('rejects a successful-looking prompt acknowledgement associated with another terminal', async () => {
    let submissions = 0;
    const client = await fixture((request, socket) => {
      if (basics(request, socket)) return;
      if(request.method==='agent.list'){respond(socket,request,{type:'agent_list',agents:[agent()]});return;}
      submissions++;
      respond(socket, request, { type: 'agent_prompted', agent: agent('w1:p1', { terminal_id: 'wrong-terminal' }) });
    });
    await client.connect();await client.listAgents();
    await expect(client.prompt('terminal-1', 'test')).rejects.toMatchObject({ code: 'invalid_response', uncertain: true, target: 'terminal-1' });
    await expect(client.listAgents()).rejects.toMatchObject({ code: 'not_connected' });
    expect(submissions).toBe(1);
  });

  it('invalidates incomplete observations instead of accepting guessed fields', async () => {
    const client = await fixture((request, socket) => {
      if (basics(request, socket)) return;
      respond(socket, request, { type: 'agent_list', agents: [{ agent: 'codex', agent_status: 'idle' }] });
    });
    await client.connect();
    await expect(client.listAgents()).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(client.listAgents()).rejects.toMatchObject({ code: 'not_connected' });
  });

  it('returns the new terminal only after one successful start acknowledgement', async () => {
    let starts = 0;
    const client = await fixture((request, socket) => {
      if(shellReady(request,socket))return;
      if (basics(request, socket)) return;
      if (request.method === 'workspace.create') respond(socket, request, { type: 'workspace_created', root_pane: { terminal_id: 'new-terminal', pane_id: 'w2:p1' } });
      else { starts++; expect(request.params.name).toMatch(/^[a-z][a-z0-9_-]{0,31}$/);respond(socket, request, { type: 'agent_started', agent: agent('w2:p1', { terminal_id: 'new-terminal' }) }); }
    });
    await client.connect();
    expect(await client.start('claude', '/tmp')).toEqual({ target: 'new-terminal' });
    expect(starts).toBe(1);
  });

  it('preserves known target after a single failed start, following creation of a separate shell', async () => {
    const commands: Request[] = [];
    const client = await fixture((request, socket) => {
      if(shellReady(request,socket))return;
      if (basics(request, socket)) return;
      commands.push(request);
      if (request.method === 'workspace.create') respond(socket, request, { type: 'workspace_created', root_pane: { terminal_id: 'new-terminal', pane_id: 'w2:p1' } });
      if (request.method === 'agent.start') socket.destroy();
    });
    await client.connect();
    await expect(client.start('codex', '/tmp')).rejects.toMatchObject({ target: 'new-terminal', uncertain: true });
    expect(commands.map(x => x.method)).toEqual(['workspace.create', 'agent.start']);
    expect(commands[0]!.params).toMatchObject({ cwd: '/private/tmp', focus: false });
    expect(commands[1]!.params).toMatchObject({ pane_id: 'w2:p1', kind: 'codex', timeout_ms: 60_000 });
  });

  it('waits for a new shell to finish initialization before making a single start call',async()=>{
    let reads=0;let starts=0;
    const client=await fixture((request,socket)=>{
      if(request.method==='pane.process_info'&&reads++===0){respond(socket,request,{type:'pane_process_info',process_info:{shell_pid:42,foreground_process_group_id:43,foreground_processes:[{pid:43,name:'init-tool'}]}});return;}
      if(shellReady(request,socket)||basics(request,socket))return;
      if(request.method==='workspace.create')respond(socket,request,{type:'workspace_created',root_pane:{terminal_id:'new-terminal',pane_id:'w2:p1'}});
      else if(request.method==='agent.start'){starts++;expect(reads).toBe(2);respond(socket,request,{type:'agent_started',agent:agent('w2:p1',{terminal_id:'new-terminal'})});}
    });
    await client.connect();await expect(client.start('codex','/tmp')).resolves.toEqual({target:'new-terminal'});expect(starts).toBe(1);
  });

  it('does not continue an old shell startup after reconnecting during the shell wait',async()=>{
    let firstRead!:()=>void;const read=new Promise<void>(resolve=>{firstRead=resolve;});let starts=0;
    const client=await fixture((request,socket)=>{
      if(request.method==='pane.process_info'){respond(socket,request,{type:'pane_process_info',process_info:{shell_pid:42,foreground_process_group_id:43,foreground_processes:[{pid:43,name:'initializing'}]}});firstRead();return;}
      if(shellReady(request,socket)||basics(request,socket))return;
      if(request.method==='workspace.create')respond(socket,request,{type:'workspace_created',root_pane:{terminal_id:'new-terminal',pane_id:'w2:p1'}});
      if(request.method==='agent.start')starts++;
    });
    await client.connect();const pending=expect(client.start('codex','/tmp')).rejects.toMatchObject({code:'stale_generation',target:'new-terminal'});
    await read;client.close();await client.connect();await pending;expect(starts).toBe(0);
  });

  it('requires a fresh same-generation snapshot and resolves movement to the current public pane',async()=>{
    let pane='w1:p1';const sent:string[]=[];
    const client=await fixture((request,socket)=>{
      if(basics(request,socket))return;
      if(request.method==='agent.list')respond(socket,request,{type:'agent_list',agents:[agent(pane)]});
      if(request.method==='agent.prompt'){sent.push(String(request.params.target));respond(socket,request,{type:'agent_prompted',agent:agent(pane)});}
    });
    await client.connect();await expect(client.prompt('terminal-1','missing snapshot')).rejects.toMatchObject({code:'stale_target'});expect(sent).toEqual([]);
    await client.listAgents();const now=Date.now();const clock=vi.spyOn(Date,'now').mockReturnValue(now+5001);
    try{await expect(client.prompt('terminal-1','expired snapshot')).rejects.toMatchObject({code:'stale_target'});expect(sent).toEqual([]);}finally{clock.mockRestore();}
    pane='w3:p2';await client.listAgents();await client.prompt('terminal-1','moved');expect(sent).toEqual(['w3:p2']);
    client.close();await client.connect();await expect(client.prompt('terminal-1','old generation')).rejects.toMatchObject({code:'stale_target'});expect(sent).toHaveLength(1);
  });

  it('keeps identity across pane movement but changes it for replacement, session and reconnect', async () => {
    let row = agent();
    const client = await fixture((request, socket) => { if (!basics(request, socket)) respond(socket, request, { type: 'agent_list', agents: [row] }); });
    await client.connect();
    const first = (await client.listAgents())[0]!;
    expect(first.processStart).toBeTruthy();
    row = agent('w2:p4');
    expect((await client.listAgents())[0]!.fingerprint).toBe(first.fingerprint);
    expect((await client.listAgents())[0]!.instanceFingerprint).toBe(first.instanceFingerprint);
    row = agent('w2:p4', { agent_session: { source: 'hook', agent: 'codex', kind: 'id', value: 'replacement' } });
    expect((await client.listAgents())[0]!.fingerprint).not.toBe(first.fingerprint);
    expect((await client.listAgents())[0]!.instanceFingerprint).toBe(first.instanceFingerprint);
    row = agent(); await client.connect();
    expect((await client.listAgents())[0]!.fingerprint).not.toBe(first.fingerprint);
    expect((await client.listAgents())[0]!.instanceFingerprint).not.toBe(first.instanceFingerprint);
  });

  it('leaves missing process evidence observation-only', async () => {
    const client = await fixture((request, socket) => {
      if (request.method === 'pane.process_info') return void respond(socket, request, { type: 'pane_process_info', process_info: { pane_id: request.params.pane_id } });
      if (!basics(request, socket)) respond(socket, request, { type: 'agent_list', agents: [agent()] });
    });
    await client.connect();
    expect((await client.listAgents())[0]).toMatchObject({ pid: null, processStart: null });
  });

  it('rejects an older concurrent snapshot after a newer snapshot was requested', async () => {
    let release!: () => void;
    let received!: () => void;
    const gate = new Promise<void>(r => { received = r; });
    let reads = 0;
    const client = await fixture((request, socket) => {
      if (basics(request, socket)) return;
      if (++reads === 1) { release = () => respond(socket, request, { type: 'agent_list', agents: [agent()] }); received(); }
      else respond(socket, request, { type: 'agent_list', agents: [agent('w2:p1')] });
    });
    await client.connect();
    const old = client.listAgents();
    const assertion = expect(old).rejects.toMatchObject({ code: 'stale_read' });
    await gate;
    expect((await client.listAgents())[0]!.paneId).toBe('w2:p1');
    release(); await assertion;
  });

  it('subscribes before calibration, follows moved panes and reports disconnect once', async () => {
    const order: string[] = [];
    const streams = new Map<string, Socket>();
    let pane = 'w1:p1';
    const client = await fixture((request, socket) => {
      if (basics(request, socket)) return;
      if (request.method === 'events.subscribe') {
        const subscriptions = request.params.subscriptions as Array<{ pane_id?: string }>;
        const target = subscriptions[0]?.pane_id ?? 'global';
        order.push(`ack:${target}`); streams.set(target, socket);
        respond(socket, request, { type: 'subscription_started' });
      } else { order.push('snapshot'); respond(socket, request, { type: 'agent_list', agents: [agent(pane)] }); }
    });
    await client.connect();
    let changes = 0;
    const reasons: string[] = [];
    let disconnected!: () => void;
    const loss = new Promise<void>(r => { disconnected = r; });
    await client.subscribe(() => { changes++; }, reason => { reasons.push(reason); disconnected(); });
    expect(order).toEqual(['ack:global', 'snapshot', 'ack:w1:p1', 'snapshot']);
    pane = 'w2:p1'; await client.listAgents();
    expect(order.slice(-3)).toEqual(['snapshot', 'ack:w2:p1', 'snapshot']);
    expect(changes).toBe(1);
    streams.get('global')!.destroy(); await loss;
    expect(reasons).toHaveLength(1);
    await expect(client.listAgents()).rejects.toMatchObject({ code: 'not_connected' });
  });

  it('rejects in-flight responses when a caller closes the client', async () => {
    let received!: () => void;
    const gate = new Promise<void>(r => { received = r; });
    const client = await fixture((request, socket) => { if (!basics(request, socket)) received(); });
    await client.connect();
    const pending = client.listAgents();
    const assertion = expect(pending).rejects.toMatchObject({ code: 'stale_generation' });
    await gate; client.close(); await assertion;
  });

  it('validates session names and removes inherited target environment for fixed-argv CLI discovery', async () => {
    expect(() => new HerdrClient({ session: '../other' })).toThrow();
    const directory = await mkdtemp('/tmp/mf-herdr-cli-');
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const script = join(directory, 'herdr-fixture');
    await writeFile(script, `#!${process.execPath}\nif(JSON.stringify(process.argv.slice(2))!==JSON.stringify(['session','list','--json'])) process.exit(2);\nif(process.env.HERDR_SESSION||process.env.HERDR_SOCKET_PATH) process.exit(3);\nconsole.log(${JSON.stringify(JSON.stringify({ sessions: [{ name: 'default', socket_path: sessionSocketPath('default') }] }))});\n`, { mode: 0o700 });
    const before = process.env.HERDR_SESSION;
    process.env.HERDR_SESSION = 'other-inherited-session';
    try { expect(await listSessions(script)).toEqual([{ name: 'default', socketPath: sessionSocketPath('default') }]); }
    finally { if (before === undefined) delete process.env.HERDR_SESSION; else process.env.HERDR_SESSION = before; }
  });
});


it('accepts an Agent with its own MCP child but rejects unrelated pipelines and duplicate Agents',async()=>{
  const child=spawn(process.execPath,['-e',"process.stdout.write('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});const closed=once(child,'close');
  try{
    await once(child.stdout!,'data');let companions:Array<{pid:number;name:string}>=[{pid:child.pid!,name:'mcp-server'}];
    const client=await fixture((request,socket)=>{
      if(request.method==='pane.process_info'){respond(socket,request,{type:'pane_process_info',process_info:{pane_id:request.params.pane_id,foreground_processes:[{pid:process.pid,name:'claude'},...companions]}});return;}
      if(!basics(request,socket))respond(socket,request,{type:'agent_list',agents:[agent('w1:p1',{agent:'claude'})]});
    });
    await client.connect();expect((await client.listAgents())[0]).toMatchObject({pid:process.pid,processStart:expect.any(String)});
    companions=[{pid:process.ppid,name:'pipeline-peer'}];expect((await client.listAgents())[0]).toMatchObject({pid:null,processStart:null});
    companions=[{pid:child.pid!,name:'claude'}];expect((await client.listAgents())[0]).toMatchObject({pid:null,processStart:null});
    child.kill('SIGTERM');await closed;companions=[{pid:child.pid!,name:'mcp-server'}];expect((await client.listAgents())[0]).toMatchObject({pid:null,processStart:null});
  }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;}
});
