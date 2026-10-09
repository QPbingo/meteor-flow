# 当前执行环境与验证准备

日期：2026-10-08。确认状态：既有实现/修复授权继续有效，人工验收 pending。适用：结果复审、既有需求内修复、回归及交付证据。宿主：本次 Codex /root 上下文；独立审查为 /root/technical_review 和 /root/ui_technical_review。

本轮修改前显式读取 capture-constraints 完整 SKILL/index/rules，应用 R-002。本地产品无已部署线上服务；实际目标为 Node 24.21.0、SQLite 3.53.4、darwin arm64，修改前已实查，最终再次核验见 runtime.json。R-001 仅限小黑盒搜索代码，不适用。沿用用户已确认需求与 Node 方案及“请开始实现”，不重复启动 brainstorming/specify 确认流程；本轮不扩展产品范围。

| 必需能力 | 实际加载与用途 | 当前可用证据 |
| --- | --- | --- |
| meteor-flow-verification | 项目 .agents/skills/meteor-flow-verification/SKILL.md，AGENTS/prerequisites/workflow/mandatory-scenarios，建立六类用例及最终记录 | doctor.log；最终 report 命令、证据与独立审查 |
| test-master | 项目完整 SKILL，integration/anti-patterns/performance/report 引用，组织分层回归 | build/typecheck/tests/workflow 日志；实际 DB/进程/文件而非全 mock |
| OCR 委托 | 项目 open-code-review-delegate/SKILL.md；固定本地 CLI；preview/rule，不接入外部 OCR 模型 | ocr-preview.json、ocr-rules.json；独立审查报告和逐文件 SHA |
| Playwright | 项目 playwright-cli/SKILL.md 与 playwright-tests 引用；独立 Chromium 启动/点击探针已通过，固定 Playwright Test 1.63.0 | e2e.log 与 browser/；HTTP/DB/collector 真实，herdr 边界模拟 |
| Impeccable | 项目完整 SKILL 与 harden/craft-floor；既有 Operate 设计上下文继续有效，独立审查使用 audit/critique | 独立 UI 报告、detector 原始输出与浏览器证据；detector 不代表业务正确 |

来源/适配版本由 scripts/workflow/sources.lock.json 固定；本次使用显式读取完整 skill 和所需引用，不声称新注册原生命令。无技能安装变更。macOS 沙箱限制本地监听、Chromium 和进程身份读取，实际集成命令经过已授权的沙箱外执行；未修改系统网络或代理配置。

两种真实 Agent 测试沿用用户明确授权：只在独立 herdr session/cwd 生成含 meteor-flow-real-agent-ok 的 hello.txt 及结果 JSON。既有模型配置只读保护；登录/信任/权限提示停止，不代为同意。
