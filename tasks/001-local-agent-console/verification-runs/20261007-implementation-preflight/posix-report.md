# POSIX 子模块实现与验证记录

日期：2026-10-07。作者上下文：`/root/posix`。状态：本包实现及作者验证完成，独立 OCR 审查、产品集成及人工验收由主流程继续；本记录不签署验收。

适用：已确认需求 0.2 的 R02/R08/R10/R11/R12/R13/R14、技术方案 0.2 §2/3/4/8/9，以及 POSIX 实施 brief。代码只写 `packages/posix-fs/src/`、同包 `test/`。主 agent 补充授权了 `createRunDirectory`，用于 `.meteor-flow/runs/<attempt UUID>/` 独占创建。

## 本上下文技能准备

- 显式完整读取仓库 AGENTS、skill-prerequisites、workflow、mandatory-scenarios；加载项目 `.agents/skills/meteor-flow-verification/SKILL.md`、`test-master/SKILL.md`、`open-code-review-delegate/SKILL.md`，另读 test-master unit/integration/security/testing-anti-patterns 引用。
- test-master 来源固定 `1be15d8064f88fc25216442406d40add8fd23b53`；OCR 来源固定 `182898cf522da3d04157b422752d028417974e19`；显式文件加载，不声明宿主原生命令注册。
- `capture-constraints` 使用 `/Users/heybox/.codex/skills/capture-constraints/SKILL.md`，完整检索 index/rules，复用 R-002。R-001 只针对小黑盒搜索模块，本任务不适用。没有修改约束库。
- `python3 scripts/workflow/check.py doctor` 退出 0；固定 OCR `--version` 输出 v1.12.12 darwin/arm64，退出 0。本包作者没有自称完成独立审查；主 agent 负责交给独立 reviewer 运行 preview/rule。
- 编码前实际运行 `/tmp/meteor-flow-node-design-probe-20261006/node_modules/node/bin/node --version`，为 v24.21.0；随后只读加载原生包确认为 darwin/arm64、Koffi 3.3.2。目标是本机首次交付产品，没有既有线上服务；不以系统 Node 25 代替目标兼容性。无需数据库中间件。
- 仅本包文件系统/锁/进程证据，不改变浏览器交互，Playwright/Impeccable 不由本子任务执行；整体验证能力由主 agent 准备，不把它当成本包已执行浏览器验收。
- 目标及约束无新增产品需求变更，沿用已确认需求和技术，不重做 brainstorming/forge/Spec Kit。新增目录接口落实已有输入目录隔离要求。

## 实现接口

`safeRead(root, relativePath, maxBytes)` 返回 Buffer、SHA-256、size，以及 dev/ino/size/mtimeNs/ctimeNs 十进制字符串。`safeCopy` 返回同样元数据而无 Buffer，以 64 KiB 块复制至独占创建的 0600 staging 文件，fsync 后返回；失败时只清除仍为自己 inode 的文件，不覆盖现存目的文件。

输入路径逐组件 `openat`；目录 O_DIRECTORY/O_NOFOLLOW，叶子先 fstatat(AT_SYMLINK_NOFOLLOW) 检查，随后 O_NONBLOCK/O_NOFOLLOW 打开并立即 fstat。读取前后核对 bigint 文件身份、普通文件和单链接约束，重新打开整条目录链比较身份；拒绝 NUL、绝对/父级/空组件、软链接、硬链接和特殊文件。所有描述符设置并验证 CLOEXEC。

`acquireLock(path)` 使用 flock(LOCK_EX|LOCK_NB)，返回幂等 `release()`；仅关闭锁 fd，不 unlink 锁文件。`canonicalDirectory` 解析规范目录并检查链；`directoriesOverlap` 检查规范路径、inode、双向包含，避免相同前缀误判。

`createRunDirectory(root, attemptId)` 验证 UUID，通过固定 mkdirat(0700) 与 openat/no-follow 创建 `.meteor-flow/runs` 和独占叶目录；已存在叶目录或文件直接失败，保留历史内容。创建前后复查父组件；失败只尝试清理本次空叶目录，不递归覆盖用户内容。

`processIdentity(pid)` 使用固定 `/bin/ps -p <数值PID> -o pid= -o lstart=` 只读 argv，无 shell；增加 Darwin proc_pidinfo 的启动秒/微秒证据，在 ps 前后核对同一身份，避免仅靠秒级 lstart 识别 PID。失败/不存在/不可读取返回 null，不猜测身份。Darwin 结构及常量按本机 SDK sys/stat.h、sys/fcntl.h、sys/proc_info.h 核对；文件 stat 的 FFI 输出已与 Node bigint fstat 实际比较一致。

## 实际测试与命令

最终命令：

```text
/tmp/meteor-flow-node-design-probe-20261006/node_modules/node/bin/node node_modules/vitest/vitest.mjs run packages/posix-fs/test/index.test.ts
```

退出 0，38/38 通过；原始输出见 [posix-tests.log](posix-tests.log)。真实临时目录、真实 fd、FIFO、符号/硬链接和真实两个进程；竞争点在实际 I/O 调用后注入文件修改、或在真实 statAt/mkdirat 后改变路径，没有固定 sleep 判定胜负。ENOSPC 为写入边界故障注入，没有填满真实磁盘。子进程 ready/release/exit 和 Unix socket ready 明确同步。

本包构建命令 `.../node node_modules/typescript/bin/tsc -p packages/posix-fs/tsconfig.build.json` 退出 0。源码与测试类型检查命令 `.../node node_modules/typescript/bin/tsc --noEmit --target ES2023 --module NodeNext --moduleResolution NodeNext --esModuleInterop --skipLibCheck --strict packages/posix-fs/src/index.ts packages/posix-fs/test/index.test.ts packages/posix-fs/test/lock-process.ts` 退出 0。`git diff --check -- packages/posix-fs` 退出 0。

首次 32 项测试在默认沙箱中 30 项通过、2 项失败：Unix socket listen 报 EPERM，`/bin/ps` spawn 报 EPERM 导致身份 null。它们是环境限制，未修改断言或跳过。工具自动审查许可本机只读进程访问及隔离 socket 后，同一 32 项全部通过；增加 FIFO 竞争、微秒身份和目录创建后执行最终 38 项并通过。未把第一次失败删成“始终通过”。

## 六类场景

| 类别 | 需求/验收 | 前置、顺序、结果与副作用 | 实际证据 |
| --- | --- | --- | --- |
| state-transition | R02/R11；V22/V26 | 锁由空闲→持有→释放；采集源从普通文件变为变化/删除/特殊对象时失败，staging 不保留部分文件；合法读取仍完成 | 38 项测试中的 locks、growth/deletion/FIFO 及 retry 用例通过 |
| idempotency | R02/R08；V03/V26 | release 两次不释放后续新锁；重复 UUID 创建拒绝且旧输入仍为 frozen；重复目的文件复制不覆盖 | release、private attempt、bounded copies 用例通过 |
| ordering | R11/R13；V22/V25 | nofollow 预检查后叶子变 FIFO；已打开父目录变 FIFO；首块读后父目录移走并替换软链接、根目录替换或原文件同长修改；返回失败而非不一致字节/副本 | 四类可控同步点实际执行，父/叶 FIFO 拒绝，越界目标内容未改变 |
| recovery | R02/R11/R12/R13；V24/V25/V26 | 写中 ENOSPC 清理自己的 staging 后可显式再试；锁 owner SIGKILL 并观察 exit 时，仍存活 exec descendant 不延长锁，新 owner 可取得 | disk failure/retry 和 owner crash 用例通过；真实 socket 保证 descendant 已启动且仍活着 |
| association | R08/R11/R12；V16/V17/V24 | 快照返回内容与 SHA-256、完整 bigint 身份绑定；独占 attempt UUID 不混用已有内容；PID+微秒启动时间前后连续，不存在 PID 返回 null | exact identities、private attempt、process identity 用例通过 |
| isolation | R10/R11/R14；V21/V22/V26 | 拒绝相对路径越界、软硬链接、特殊文件；不同前缀目录不误判重叠；输出仅 0600、新执行目录 0700；竞争和恢复资源均专用临时目录 | unsafe relative path、links、FIFO、directory overlap、file mode 和 run directory 用例通过 |

## 边界与后续

- 仅 macOS arm64 为已执行目标；其他平台显式失败关闭，没有 Linux 兼容声明。
- 此包提供同步有界采集原语。主进程不得把它当作非阻塞文件 API；有界子进程管理、deadline、退出屏障、generation/attempt 关联、归档发布和 herdr 集成由上层负责，未由本包测试代替。
- 目录 realpath 用于授权根初次规范化；调用方应持久化该规范根和业务归属。该方案防止常见越界与复制期间变化，不承诺防御同一系统用户的恶意进程，符合已确认隔离边界。
- 独立代码审查尚由主流程安排，作者未自审签收。人工验收状态仍 pending。
