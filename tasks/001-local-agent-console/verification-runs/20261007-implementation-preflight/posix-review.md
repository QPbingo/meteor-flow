# POSIX 子系统独立审查

日期：2026-10-07。适用：已确认 task 001 需求 0.2、技术方案 0.2，以及 POSIX 实施 brief。作者：`/root/posix`，修订者：`/root`；独立 reviewer：`/root/technical_review`。状态：本批审查和修订复查完成；P01 high 已关闭，当前本批无未关闭 findings。reviewer 未修改产品源码或测试。

本批仅认领 `packages/posix-fs/` 的两项源码、两项测试、package.json、tsconfig.build.json，共六个文件。可继续上层集成与后续审查，**不代表整仓审查、完整产品验收或真实 herdr 集成通过**。

## P01 · high · 使用时重新 realpath 会重新授权已被替换的根目录

- 首轮路径：`packages/posix-fs/src/index.ts`，createRunDirectory 第 131 行、sourceParent 第 166 行、safeCopy 第 236 行；类别 security；状态 fixed。
- 首轮实现先对已冻结 root 再次执行 canonicalDirectory，然后才逐组件 nofollow。若授权目录在操作开始前已被移动、原路径改成指向其他目录的符号链接，新 realpath 会把链接目标当成新的授权根。safeCopy 对目的父目录做同样转换，也能在预先存在的中间链接外写入。后续所有 nofollow 检查在新根下成功，不能阻止此绕过。
- 独立真实复现：先 canonicalDirectory 冻结专用临时 authorized 路径，再将其 rename、以 outside 符号链接替换；safeRead 返回 outside 文件字节，createRunDirectory 在 outside 创建 `.meteor-flow/runs`，safeCopy 经目的父链接写入其他目录。没有访问用户数据。原始证据保留在 [posix-review-root-reproduction.json](posix-review-root-reproduction.json)。原 38 项测试只覆盖相对组件和进行中的根替换，未覆盖操作开始前替换。
- 影响：违反 R10/R11、V21/V22，以及技术方案 §8 的冻结授权根、符号链接拒绝和内部路径安全创建要求。它不依赖恶意攻击或复杂竞争；操作前已有链接即可触发，不能用“同一系统用户非安全边界”豁免。
- 作者修订：初次授权保留 canonicalDirectory；安全操作使用传入的冻结绝对规范路径，由 openAbsoluteDirectory 验证绝对/规范形式并从 `/` 开始逐组件 nofollow。sourceParent/createRunDirectory 不再重新 realpath root；safeCopy 不再 realpath 目的父目录。新增两项用例覆盖读取/建 run 前根被替换、目的父目录为链接，并断言外部目录未产生文件。
- 独立复查：阅读修改后的调用链与用例，运行修订后全部 **40 项 POSIX 测试通过**，源码构建配置的 `tsc --noEmit` 退出 0；测试前后六项候选哈希一致。P01 关闭依据是代码与实际回归，不是作者口头结论。

## 其他核查结论

| 检查点 | 结论与证据边界 |
| --- | --- |
| openat/特殊文件/路径竞争 | 目录 O_DIRECTORY/O_NOFOLLOW、叶子先 nofollow stat 再 O_NONBLOCK/O_NOFOLLOW，随后普通文件/单链接检查；FIFO 预检查后替换、父组件替换、读取中移动/删除/增长/同长修改均有真实文件与受控 I/O 同步点 |
| bigint 与 ABI | statAt 对整数先转 bigint，再组合纳秒；没有将纳秒或 inode 转 Number。独立核对本机 SDK stat/proc_bsdinfo 布局与 fcntl 常量，并核对安装 Koffi 的大 64 位整数返回 BigInt 规则；测试将实际 metadata 与 Node bigint stat 比较 |
| 复制与清理 | 分块写入、独占创建、0600、限额与 hash；失败仅清理仍属于本次 inode 的 staging，现存文件/链接不覆盖。ENOSPC 为边界故障注入，不冒称真实磁盘填满 |
| flock 与 CLOEXEC | 非阻塞排他锁，打开后 F_GETFD 验证 close-on-exec，release 幂等且不 unlink；真实跨进程竞争、退出及存活 exec descendant 不延长锁的测试通过 |
| PID 身份 | 固定 libproc 查询及无 shell 的 `/bin/ps` argv；PID、启动秒/微秒在 ps 前后连续核对，不使用秒级字符串作唯一身份。不支持平台失败关闭；null 表示不存在或无法核实，不能被上层直接当成退出证明 |
| run 目录 | UUID 校验、0700、mkdirat 独占叶目录、既有内容保留、父目录重复核验与失败时仅清理空的新叶；P01 修复后拒绝操作前根链接替换 |
| 重叠目录 | realpath、inode、双向包含和分隔符边界共同判断；独立检查本机大小写不敏感目录别名的父子关系，正确返回重叠，见 case-alias 证据；该疑点关闭为非问题 |
| 包边界 | public API 由 index 导出，native 固定库/符号/flags，不暴露可配置 FFI。Koffi 3.3.2 固定，ESM exports 指向 dist/index.js 与 dist/index.d.ts，构建声明输出匹配。同步采集仍须置于有界采集子进程；本包不能替代上层超时/退出屏障 |

## 跨批移交，未并入本批通过范围

检查实际调用方时另发现 `collector.reconcile` 和手动结论流程将 processIdentity 返回 null 解释成进程已消失，可在身份读取失败时释放容量/执行占用。此问题已即时移交 `/root`；根作者已报告新增仅 ESRCH 证明消失的判断并保留 unknown。本批不覆盖这些应用文件的最终修订，须由应用/恢复批次验证身份查询失败但进程仍存活时，不标记退出、不释放容量或占用。本批通过不能作为该问题的关闭证据。

## 独立加载与测试记录

本 reviewer 已完整加载本项目 verification、test-master、OCR 委托；本批重核 prerequisites/verification 和 AGENTS，复用本上下文已读且未变的技能正文，另重读 integration-testing。适用 test-master 引用为 unit、integration、security、testing-anti-patterns。capture-constraints 采用可用来源 `/Users/heybox/.codex/skills/capture-constraints/`，索引及 R-002 已核对；目标为本机首次交付，无线上中间件，实际 Node **24.21.0 darwin arm64**。R-001 搜索规范不适用。浏览器技能不由本文件系统子模块复跑；对应上层用户链路仍需后续验证。

独立 doctor、固定 OCR v1.12.12、preview/rule 均退出 0。仅使用委托模式。

1. 原候选首次独立测试：默认沙箱 **36/38 通过、2 项失败**，分别是 Unix socket listen EPERM 和只读进程查询受限。日志 [posix-review-tests-initial.log](posix-review-tests-initial.log) 保留，未修改断言或跳过。
2. 自动审批允许本机隔离 socket/只读进程查询后，同一原候选 **38/38 通过**，日志 [posix-review-tests-authorized.log](posix-review-tests-authorized.log)。这不覆盖后来发现的 P01，因此没有据此提前签收。
3. 作者修订后独立运行 `/tmp/meteor-flow-node-design-probe-20261006/node_modules/node/bin/node node_modules/vitest/vitest.mjs run packages/posix-fs/test/index.test.ts`，**40/40 通过，退出 0**，日志 [posix-review-tests-final.log](posix-review-tests-final.log)。同一 Node 执行 `node_modules/typescript/bin/tsc -p packages/posix-fs/tsconfig.build.json --noEmit` 退出 0。

## 六类场景与范围

| 类别 | 需求/验收 | 本批实际覆盖 |
| --- | --- | --- |
| state-transition | R02/R11；V22/V26 | 锁持有/释放、源文件变为特殊对象或变化时拒绝、合法读取继续可用 |
| idempotency | R02/R08；V03/V26 | release 重复不释放后续锁；目的文件及 attempt 目录重建拒绝，不覆盖既有内容 |
| ordering | R11/R13；V22/V25 | nofollow stat 与 open 间换 FIFO；实际首块读取后修改/移动；新增操作前根/目的链接替换 |
| recovery | R02/R11/R12；V24/V25/V26 | ENOSPC 后清理并显式重试；owner 崩溃退出后锁可重新取得，descendant 仍活着 |
| association | R08/R11/R12；V16/V17/V24 | 字节/hash/精确身份绑定、attempt UUID 独占创建、PID+启动微秒核验 |
| isolation | R10/R11；V21/V22/V26 | 真实路径/目录重叠、软硬链接与特殊文件拒绝、专用临时资源及 0600/0700 |

以上是包级用例覆盖，不表示各产品 V 编号的完整验收通过。主进程采集隔离、generation、manifest、归档发布、进程退出不明占容量、真实 herdr、终端及 UI 均属于后续批次。

首次基线见 [posix-review-baseline.json](posix-review-baseline.json)；修订后六项文件的准确 SHA-256 见 [posix-review-baseline-final.json](posix-review-baseline-final.json)，HEAD 为 `618607de5d6b3b22d44258950236273c37bd8079`。首轮原始 preview/rule 保留，最终另存 `posix-review-preview-final.json` / `posix-review-rules-final.json`。

最终 preview 共 226 项：reviewable 142 项，本批 reviewed 6、skipped 136，整份 preview 文件比例 **4.23%**；本批指定六项覆盖 **100%**。84 项排除项均逐项记录；本批没有删除或超大文件被静默排除。每项 `(path,status)` 和排除理由见 [posix-review-scope.json](posix-review-scope.json)。其他候选明确交后续审查，不虚报整体覆盖。
