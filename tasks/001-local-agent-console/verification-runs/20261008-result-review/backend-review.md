# 2026-10-08 后端异常路径独立复查

状态：本批独立复查完成。BR01—BR04 均已修复并复验关闭；追加发现的测试注入问题 BR05 已关闭。当前本批 0 critical / 0 high / 0 medium / 0 low 未关闭。此结论限于下面的准确 SHA，不代签人工验收，也不代替仍由根作者汇总的全套执行结果。

审查者：独立上下文 `/root/technical_review`。范围：application、domain、results/collector、HTTP，以及相关 contracts、storage 调用关系和测试。只写报告及临时复现材料，未修改产品代码/仓库测试，未调用真实模型或用户已有 herdr session。

本轮按项目 verification、test-master（unit/integration/security/testing-anti-patterns 引用）和 OCR 委托流程执行，capture-constraints 的 R-002 本机版本约束用于临时探针；R-001 的 Heybox 搜索不适用。doctor 与固定 OCR CLI 实测成功，原始材料见 [doctor](technical-doctor.log)、[版本](technical-ocr-version.log)、[preview](technical-preview.json)、[rule](technical-rules.json)。规则共 6 组，Python/React 等不相关语言条款不机械套用到后端，但六类项目场景、正确性、安全、生命周期、测试质量均适用。

## 基线与边界

[首次基线比对](technical-initial-baseline.json) 对照 `20261007-review-delivery/reviewer-coverage.json` 的 170 个候选摘要；开始复查时仅 HTTP 测试已有作者新修改，其他 169 项一致。本轮在旧审查基础上主动检查遗漏，不把旧通过结论当成本轮结论。正在修订的文件需在最终复验时另存准确摘要；[中途基线](technical-midreview-baseline.json) 只用于复现阶段定位，不替代最终基线。

## 发现

| ID | 程度 | 位置 / 已确认规则 | 触发与影响 | 修复要求 / 当前状态 |
| --- | --- | --- | --- | --- |
| BR01 | high | `domain/model.ts` 的 `collection.error` / `observe`；`application/console.ts` 的结果扫描；R05/R07/R08，方案 §8 | 同一次执行已有归档、仍 working，随后 `result.json` 改为冲突声明：先进入 needs_confirmation，但下次 idle 观测自动 succeeded 并释放占用，可满足下游。终态后的冲突原先也不落事件、不暂停。 | 持久化冲突摘要和审计；活动执行禁止自动终态，人工结论仍须停止证据；已终态保留原结论并暂停。已修复并独立复验关闭，见末节。 |
| BR02 | medium | `application/console.ts` 的 `start`；R02/R03，V03/V06 | start 在串行队列外捕获旧 port；它排在会话切换后接受，持久化新会话 intent 后因 port 不符不发送。旧/新 port 的 start 均为 0，之后同 cwd 启动与切会话均被未决 intent 阻塞。 | 在串行接受意图的同一阶段绑定 port/generation；使用可控队列 gate 覆盖。已修复并独立复验关闭，见末节。 |
| BR03 | medium | `application/console.ts` 的 `taskAction(record-conclusion)`；R04/R05/R12，V07/V12/V24 | 旧进程确实退出，同 terminal 出现新实例；由于仅无观测时才核验旧 PID 已退出，人工结论始终不能解除旧 occupancy，新的接入确认也被拒绝。 | 独立核验旧 PID 已消失或可靠启动身份已更换；不能以新实例 idle 或身份查询 null 推断停止。已修复并独立复验关闭，见末节。 |
| BR04 | medium | start 恢复接口；R03、方案 §6，V06/V24 | unknown 启动只有“随后发现实例再 attach”的解除途径；原启动未创建或后来已消失时，cwd 和会话永久保持未决，用户无法完成已确认的人工核对恢复。 | 显式人工核对原生窗格/进程、非空证据；仅 unknown 且无本机未返回 RPC；新鲜读取仍有原 target/cwd Agent 时拒绝；保存 manual 解除记录。不得自动启动、杀进程或以列表缺失宣称服务证明停止。已实现并独立复验关闭，见末节。 |

复现使用独立临时 SQLite 和 FakeHerdr 外部边界；BR03 另外创建并等待退出本次自己的 Node 子进程，读取 PID/启动时间。证据：[启动竞争与冲突](technical-probe-results.json)、[其探针源](technical-initial-probe-source.txt)、[替换实例后无法恢复](technical-replaced-agent-verified.json)、[其探针源](technical-replaced-agent-probe-source.txt)。首个临时 `.ts` 因顶层 await 按 CJS 解释失败；改为 `.mts` 后成功。BR03 首轮沙箱不允许跨进程身份核验，正常授权入口复验成功；首次失败 stderr 均保留，不冒称产品失败或抹去失败记录。

父作者另发现并修复的 createProject 回执前目录重验、HTTP listen 后 bootstrap 写入失败未关 listener、归档任务 retry 状态转换，也纳入本轮增量独立复查；发现归属不混记为本 reviewer 首次发现。

## 六类场景与真实覆盖

| 类别 | 本轮具体核查 | 证据/边界 |
| --- | --- | --- |
| 状态迁移 | 冲突后不得成功；终态不翻转；人工结论与停止事实分离；unknown 解除不等于启动；归档后 retry 不制造永远 queued 的任务 | BR01/BR03/BR04 及修复回归。原 V08/V10/V15 的正常路径只作为历史支撑，不代替本轮异常证据。 |
| 幂等 | 项目目录消失仍回原回执；同 ID 不同内容冲突；start、人工解除、取消不重复副作用 | 实际 SQLite/HTTP；新恢复入口 replay 必须早于当前枚举和状态检查。 |
| 时序 | 会话先切换、start 后接受；结果先归档、后冲突、再 idle；取消与结果已确认的两种持久化顺序 | BR02 使用 gate，不以 sleep 猜测；BR01 首轮 reducer 复现后由真实 DB/collector 回归验证修复。 |
| 恢复 | 冲突标记跨重启保留；旧 PID 退出后人工解除；未知启动核对；worker/orphan 隔离 | 本轮未重新调用真实模型、未物理休眠；历史实体测试与本轮受控故障分开。 |
| 关联 | 冲突保留原 resultHash/archive；旧 attempt 不覆盖新 attempt；新实例不继承旧授权；启动归属跟随接受时 session | 对照 R04/R05/R08 与 V07/V09/V13/V16/V17/V28；不以文件覆盖率宣称业务覆盖。 |
| 隔离 | 每个探针新建临时目录/DB；仅终止自己创建的测试子进程；认证/Origin/路径读取边界不放宽 | 无用户 session / 模型任务 / 现有数据访问。原 POSIX 及终端证据按未变 SHA 复用。 |

R01—R14 / V01—V29 的完整历史层级映射仍见任务 `verification-status.md`；本轮发现表证明旧 V03/V06/V07/V09 等映射不等于异常全覆盖。V18—V20 的终端 UI、V23 预览浏览器、性能及真实 herdr 由其他范围/原准确基线证据支撑，本报告不虚报重新执行。最终需要将当前修复回归补入映射，不能用“所有 V 已映射”替代语义判断。

## 已排除疑点

- `Collector.reapOrphans(true)` 将不能证明退出的 intent/running 变为 orphaned，并继续占容量；身份 null 不等于退出。该代码与旧交付一致，未发现本轮新增缺陷。
- 结果扫描使用轮转游标，每轮历史扫描 4 项，不是永久只检查最后 4 项；旧执行的迟到结果仍会轮到。
- Collector 的大文件核验在有容量和身份记录的子进程内，IPC 完成仍等待 exit + close；rename 后失效候选移出恢复发布目录。主线程小 manifest 读取有界。未把之前已修的问题再次列为新问题。
- herdr 的“核验身份并发送”非原子限制仍是已记录上游能力边界；本轮不凭空要求上游不存在的原语。


## 修复关闭与最后基线

- BR01：`result.conflict` 单独持久化首个冲突摘要和事件，并暂停绑定。活动 attempt 的 observe 首先检查该标记；恢复保留标记，`retry-collection` 不能清除。结果本身已先有 resultHash，不会重新进入首次接受分支。真实 DB/collector 用例验证 working → 归档 → 冲突 → idle → 重启/还原文件仍占用，并仅在有停止证据的人工结论后结束。终态冲突保持原终态并仅记一次事件；取消仍按已证实停止处理。
- BR02：port 和 storage generation 在 serial 内、意图提交前共同固定。相同 gate 探针复验旧会话 start=0、新会话 start=1、记录 started；不再留下从未调用的 intent。
- BR03：同身份 idle/done 证据不足时，独立核验旧 PID 是否 ESRCH，或读取到与原启动时间不同的可靠身份；未知/null 不作停止。实际自有子进程在存活时不释放，退出后人工结论释放；新实例仍 observe/未确认，未继承授权。
- BR04：恢复入口只接受 unknown，不允许 intent 或本机尚未返回的 start RPC；要求显式 confirmedStopped=true、非空人工证据、成功新鲜读取且无原 target/重叠 cwd 实例。保存 dismissed/manual/时间/证据；重复 operation 先返原回执，改 body 拒绝。处理本身不调用 start/interrupt，不清理窗格或目录；再次启动是独立新操作，仍走完整隔离检查。它依据用户核对声明保留剩余人工判断风险，未将空列表描述为自动停止证明。
- 父作者发现的项目幂等：createProject 将回执查询移入串行队列并先于目录校验；真实 HTTP 用例覆盖目录 rename 后两个并发重放、同键改 body 拒绝和新键目录校验失败，事件/项目均不重复。
- 父作者发现的启动监听清理：createServer 对 listen/auth.init 包围异常清理；CLI 用例将本次临时 open.json 设为目录，核对报 EISDIR 后 exit=1、无“已启动”输出，并清理本次独立锁。HTTP 监听不再使失败 CLI 常驻。
- 归档任务 retry：domain 拒绝直接 retry 并允许 copy；与界面恢复策略一致。本报告不自签前端交互修复。

追加 BR05（test / medium，已关闭）：新 HTTP 回归最初写入不存在的 `fake.discover` 属性，46 项即使通过也未注入声称的枚举故障。独立读测试发现后，作者改为真实钩子 `fake.onList`；修正用例再次独立运行成功，另核对作者 typecheck 成功日志。首轮测试结果保留，其 HTTP 故障注入结论由追加复验补齐。

本 reviewer 实际执行 [4 个测试文件、46 项通过](technical-retest.log)，修正 BR05 后仅补跑 [HTTP 该 1 项通过、其他 11 项明确过滤](technical-http-replay-retest.log)，不是重新把 47 项当作独立总用例。测试前后源码与编译产物检查见 [before](technical-retest-before.json) / [after](technical-retest-after.json)：只发生已单独复验的 HTTP 测试修正，其余待测源码与编译产物未变。作者随后完整构建/类型检查另记于最终 run，不把那些命令冒称本 reviewer 执行。

独立探针复验见 [冲突与启动竞争](technical-probe-fixed.json)、[修复后探针源](technical-fixed-probe-source.txt)、[旧实例退出后的人工解除](technical-replaced-agent-fixed.json)。冲突探针改用修复后 scanner 实际发送的 `result.conflict`，原 `collection.error` 探针与失败证据仍保留；另有真实扫描路径回归避免只验证 reducer 镜像。

四份文档增量已核对：usage 正确区分人工声明和服务停止证明；technical-design 记录 port 绑定、持久冲突、manual 解除和可选 JSON 字段兼容，不更换 SQL 表结构/已确认技术；verification-status 更新当前入口并明确旧实测边界；implementation-progress 将旧数字标为 2026-10-07 历史，未把新最终 run 预写为通过。最终 run 的 summary/report 内容由根作者另行登记，本批没有替其预签结论。

最后候选基线对应 `20261008-review-final2`：HEAD `618607de5d6b3b22d44258950236273c37bd8079`，workspace `ee6c4ea819318ceadfd55e8fde3c6618bf174ae1f124a07949697bf4d23e29b0`。本次新读的 24 项准确指纹在 [technical-reviewed-files.json](technical-reviewed-files.json)，包括全部本轮后端/测试及四份文档变更。末次 [preview](technical-preview-final.json) / [rules](technical-rules-final.json) 均 exit 0；[逐文件覆盖](technical-coverage.json) 交代 169 个 reviewable 与 774 个排除项：24 项新读审查、142 项准确 SHA 继承旧独立证据；3 项前端/E2E 增量留给独立 UI reviewer，未虚报本批覆盖；2 个非证据排除项沿用相同 SHA 的手工审查，其余运行证据逐项说明排除理由。文件范围交代不表示语义或测试全覆盖。
