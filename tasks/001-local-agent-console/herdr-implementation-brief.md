# herdr 适配实施子任务

历史分工稿（2026-10-07）：仅保留当时任务分配，不作为最终实现或验收约束；当前行为以 requirements、technical-design 和 verification-status 为准。

日期：2026-10-07。已授权实现；需求0.2、技术0.2。当前项目技能已接入，执行 agent 须自行读取 prerequisites、capture-constraints（R-002）、verification/test-master/OCR；先核对Node24和herdr版本。用户现有session禁止用于测试写操作。

仅修改 `apps/server/src/adapters/herdr/**`、该目录测试及 `tests/fixtures/herdr-*`（可选），不改manifest/其他模块。读取 technical-design §2/5/6/7 和 herdr-compatibility，实际协议源码在 `/tmp/meteor-flow-upstream-20261006/herdr-v0.9.3`、v0.9.0。本机CLI0.9.3/protocol22，实际连接仍须ping核对。实现 Node net NDJSON 严格限帧/timeout/id，取消未确认副作用不重发。终端原生桥接由根agent处理，本任务只管理适配。

输出单一入口 `index.ts`：

```ts
interface AgentObservation { terminalId:string; paneId:string; type:string; status:'idle'|'done'|'working'|'blocked'|'unknown'; cwd:string; agentSession:string|null; pid:number|null; processStart:string|null; sequence:number; launchPending:boolean; interactiveReady:boolean; fingerprint:string; observedAt:number; }
interface HerdrPort { session:string; connect():Promise<{version:string;protocol:number}>; listAgents():Promise<AgentObservation[]>; prompt(target:string,text:string):Promise<void>; interrupt(target:string):Promise<void>; start(type:'codex'|'claude',cwd:string):Promise<{target:string}>; subscribe(onChange:()=>void,onDisconnect:(reason:string)=>void):Promise<()=>void>; close():void; }
class HerdrClient implements HerdrPort { constructor(options:{session:string;executable?:string;socketPath?:string;timeoutMs?:number}); }
function listSessions(executable?:string):Promise<Array<{name:string;socketPath:string}>>;
```

允许调整接口细节，但必须尽早通知根agent。真实 API方法及返回结构必须据schema/source验证，不编造。identity用session/terminal/type/agentSession/前台进程PID+OS启动时间/cwd，进程证据缺失=>fingerprint仍可展示但上层观察only；状态sequence来自state_change_seq不依赖completion_seq。CLI发现session只读固定argv，清理冲突环境；默认路径发现来自官方socket规则。start需先创建独立shell pane再agent.start，响应不明throw不可重试错误，异常最好携带已知target便于核对；业务start intent由上层在调用前持久化。

subscribe按已发现pane更新目标、先ack再snapshot，断线及时回调，旧generation响应不回流；如管理多订阅协议需读源码。独立net模拟器集成测试可验证NDJSON分片、超大、错id、未知protocol、timeout、断线；真实隔离session只读/可控创建需命名meteor-flow-test-*，不操作用户session。报告放 `verification-runs/20261007-implementation-preflight/herdr-report.md`。不git提交。
