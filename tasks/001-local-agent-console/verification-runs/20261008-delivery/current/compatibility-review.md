# Codex 启动与首次会话标识兼容：独立增量审查

日期：2026-10-08。审查者：`/root/technical_review`，与候选作者 `/root` 独立。状态：本批 10 个候选已审；0 critical / 0 high / 0 medium 未关闭；1 low 已修复。未修改产品或测试代码，未调用真实模型。本结论允许作者继续已授权的真实兼容复验，不代表产品验收就绪，也不关闭历史真实 Codex 阻塞的运行时结论。

## 范围与指纹

本批覆盖 contracts、herdr 适配器及其测试、domain 及其测试、application 测试、真实 Agent 测试、技术方案、usage 和根 package.json，共 10 文件。准确路径、状态及最终 SHA-256 见 [reviewer-reviewed-files.json](reviewer-reviewed-files.json)。

重新执行项目 OCR 委托 preview/rule；原始结果见 [reviewer-preview-final.json](reviewer-preview-final.json)、[reviewer-rules-final.json](reviewer-rules-final.json)。最终 preview 有 173 个 reviewable：本批 10 个 reviewed，另 163 个逐项标为 skipped，不能把本批结论解释为重新审查整个仓库；工具排除的 1367 项逐项保留在 [reviewer-scope.json](reviewer-scope.json)。此为生成本轮审查报告前的证据截点，新审查材料本身不列作待审产品。此前报告及执行日志不被覆盖。

当前上下文已加载项目 prerequisites、verification、test-master（unit/integration/security/anti-patterns 引用）、OCR 委托及 capture-constraints；只读审查沿用已核对规范。本轮 [doctor](reviewer-doctor.log) 和 [固定 OCR 版本](reviewer-version.log) 检查通过。此次没有新增产品、临时模型诊断或修改全局配置。

## 结论与依据

1. `instanceFingerprint` 单独表达 session/socket/连接代/terminal/type/PID/启动时间/canonical cwd 的基础实例身份；完整 fingerprint 继续包含 Agent session。补全只接受旧 session 明确为 null、新值非空、已确认且连续新鲜的观测、旧绑定及活动 attempt 身份一致、序号不回退。旧数据缺少基础指纹不能误走补全路径。普通非空会话变更、清空、进程变更仍暂停，不自动重发。
2. `sessionIdentificationBlocked` 在缺观测、过期、断线、切 session、恢复时持久失效。之后即使再出现相同 null 观测也不能恢复资格；只有满足现有条件的显式 confirm 才重置。数据库回归验证审计只发生一次、binding 与占用 attempt 同步提交、磁盘重开后资格撤销且占用不丢失。
3. 跨绑定冲突依据批次开始前的 confirmed/occupied 绑定和所有占用 attempt 建立 reservation，并同时检查完整新观测批次。先处理旧占用方、后处理新方以及反序排列不会因循环内变更而漏判。同一基础实例首次补全只更新会话身份和审计；不修改 mode/paused/dispatch、不授予控制权，也不把补全本身当作执行活动。原来的正常活动观测判定仍有效。
4. Codex help 探测在 workspace 创建前执行，默认具有 5 秒和 128 KiB 上限；失败或连接代变化拒绝启动。能力匹配要求正式选项行，不能仅凭描述文字误认支持。支持时加入固定 `--no-daemon -c check_for_update_on_startup=false`，不更改普通产品的 sandbox/approval 或全局配置。显式 `codexExecutionPolicy: 'workspace-write'` 仅用于本次授权测试调用，并同时校验 sandbox/approval 正式参数能力；未提供此选项的产品路径保留用户策略。服务 PATH 与 herdr shell 命令解析差异仍是已明确的上游边界，失败不自动重启。
5. 真实 Agent 测试需要双开关，使用真实公共适配器入口而非替换私有启动方法；Codex 使用已授权的 workspace-write/on-request、配置前后哈希核对，Claude 保留外层只读配置保护。实际 prompt 边界仍由此前独立审查通过的 guard 封闭输入；遇更新、登录、信任、审批和执行器错误停止，未新增自动批准或重发路径。测试成功标准要求应用 task/attempt/result/archive 链路成立，不能仅以模型写出文件当作产品通过。
6. package.json 仅将 `test:e2e` 改为 `playwright test tests/e2e --workers=1`。反向还原这一行后的 SHA 精确等于之前独立基线，见 [reviewer-package-audit.json](reviewer-package-audit.json)。该修复把入口限定为实际 E2E 目录；没有删除或降低断言。作者保留原裸入口失败 [e2e.log](e2e.log)，实际脚本复验 [e2e-runtime.log](e2e-runtime.log) 显示 14/14 通过；这是作者执行证据，不是本 reviewer 执行。

## 六类场景及需求关联

| 类别 | 本批检查与执行依据 | 关联 |
| --- | --- | --- |
| 状态迁移 | 仅 null→首次会话补全；非空变更/移除、进程字段差异、缺基础指纹拒绝；不额外解除暂停或占用 | R03/R04，V06/V07 |
| 幂等 | 重复同观测只记一次审计；原 durable intent/prompt 次数不增加；help 失败无 workspace 副作用 | R02/R03，V03/V04/V05 |
| 时序 | 旧/新观测新鲜性、sequence、同连接代检查；探测期间重连拒绝；已有终端控制继续受完整指纹校验 | R04/R09，V07/V18/V19 |
| 恢复 | 缺口后 null 再出现不能重获补全资格；断线/恢复持久撤销；真实 DB 重开保留身份、原占用与审计 | R12，V24 |
| 关联 | binding 与当前占用 attempt 同步更新；活动 attempt 旧指纹及显式身份逐字段匹配；不修改已冻结输入和结果归属 | R04/R10，V07/V13 |
| 隔离 | 前批 reservation + 整批新观测拒绝跨绑定会话重复；反序执行一致；测试在独立临时 cwd/session/数据库运行 | R10，V07/V16 |

本批未重做所有 R01—R14 / V01—V29、UI、性能和真实模型验收。应用原有锁/唯一派发者（V26）未变，不因这次定向测试重新声明完整验证；最终整体报告需按 SHA 继承此前证据并纳入后续真实执行。

## 执行与问题关闭

独立执行 5 个测试文件（domain、herdr adapter、application、terminal bridge、Agent screen guard），121/121 通过、exit 0，耗时 5.86 秒：[reviewer-tests.log](reviewer-tests.log)。使用固定 Node 24 入口执行以下命令；需要正常宿主的 libproc 和临时 UNIX socket 能力，仅访问自建测试资源，没有模型调用：

```sh
PATH=/tmp/meteor-flow-node-design-probe-20261006/node_modules/node/bin:$PATH /tmp/meteor-flow-node-design-probe-20261006/node_modules/node/bin/node node_modules/vitest/vitest.mjs run apps/server/src/domain/model.test.ts apps/server/src/adapters/herdr/index.test.ts apps/server/src/application/console.test.ts apps/server/src/terminal/bridge.test.ts tests/integration/agent-test-screen.test.ts --maxWorkers=1 --reporter=verbose
```

执行前后的源代码及 5 个构建运行产物 SHA 均未变化：[reviewer-test-baseline.json](reviewer-test-baseline.json)、[reviewer-test-check.json](reviewer-test-check.json)。后者 `all_match=false` 仅因为测试期间作者修订 usage 文案；该纯文档增量已另行检查并登记最终 SHA，不能隐去该初始比对差异。package.json 在随后追加范围内，已独立检查单行增量，无需重复 121 项后端测试。

**CC01 — low / fixed：真实测试说明没有完整表达新授权方式。** 初稿 usage 的常用命令漏写 Codex 第二开关，并把所有测试笼统描述为配置只读，易导致 Codex 被跳过或误解保护边界。作者已补双开关、Codex hash-only 与 Claude 外层只读的区别，并保留明确授权要求；最终第 80 行与第 85 行一致。关闭依据是当前 usage 原文及最终 SHA，见 [reviewer-findings.json](reviewer-findings.json)。

截至本报告，本批没有需要在真实模型重跑前阻断的代码问题。历史 CP01 输入时序缺口已由前一轮独立审查关闭，本轮 guard 回归仍通过；历史 Codex 真实产品路径是否闭环，必须由后续授权运行证据决定，本报告不代签关闭或人工验收。
