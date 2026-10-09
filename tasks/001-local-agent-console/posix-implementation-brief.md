# POSIX 实施子任务

历史分工稿（2026-10-07）：仅保留当时任务分配，不作为最终实现或验收约束；当前行为以 requirements、technical-design 和 verification-status 为准。

日期：2026-10-07。已授权实现；需求 0.2、技术 0.2。当前所有项目必需技能已接入，执行 agent 仍须自行加载 prerequisites、capture-constraints（R-002）、verification/test-master/OCR；浏览器技能非本子模块编码范围，但整体验证能力已由主 agent 准备。

仅修改 `packages/posix-fs/src/**` 及同包测试，不改清单/共享类型/其他业务代码。Node 24.21.0 在 `/tmp/meteor-flow-node-design-probe-20261006/node_modules/node/bin/node`；pnpm11.9.0、Koffi3.3.2 已安装。读取 technical-design §2/3/4/8/9 与 review N01/N02；不得削弱安全要求。可参考 `/tmp/meteor-flow-node-design-probe-20261006/probe.cjs` 原语，不视为产品实现。

实现导出：

```ts
type FileSnapshot = { data: Buffer; sha256: string; size: number; identity: {dev:string;ino:string;size:string;mtimeNs:string;ctimeNs:string} };
function safeRead(root: string, relativePath: string, maxBytes: number): FileSnapshot;
function safeCopy(root: string, relativePath: string, destination: string, maxBytes: number): Omit<FileSnapshot,'data'>;
function acquireLock(path: string): { release(): void };
function canonicalDirectory(path: string): string;
function directoriesOverlap(a: string,b: string): boolean;
function processIdentity(pid: number): string | null;
```

同步 safeRead/safeCopy 仅在有界采集子进程调用；文件路径逐组件 openat、O_DIRECTORY/NOFOLLOW、叶 NONBLOCK/NOFOLLOW，拒绝 NUL/../绝对/软链接/硬链接/特殊文件，打开前后/复制后检查bigint身份及路径再验证，限额与hash，异常关闭fd。目录替换并发不能读越界或发布不一致数据；macOS arm64 当前目标，其他平台明确失败关闭（Linux支持只能证据充分后）。锁使用flock，主进程持有，CLOEXEC，release幂等、不unlink，不给子进程继承。进程身份只读固定 argv，无shell，使用 PID+开始时间证据，不存在或无法读取返回null。

测试真实临时目录、FIFO、symbolic/hard link、目录替换/修改、两进程锁竞争/退出，使用可控同步点或明确外部进程同步而非固定sleep判断。先执行目标Node版本检查，再编写。记录报告 `verification-runs/20261007-implementation-preflight/posix-report.md`，源代码不放证据目录。返回导出接口和测试结果即可。不自行提交git或改技术需求。
