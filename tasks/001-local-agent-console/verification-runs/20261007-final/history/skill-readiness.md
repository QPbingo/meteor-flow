# 编码前能力准备

日期：2026-10-07。状态：当前作者上下文 `/root` 已加载本次技能，产品尚未实现。技术方案与实现授权已由用户明确确认。

| 能力 | 来源及实际验证 |
| --- | --- |
| capture-constraints | 完整读取全局原始 SKILL、index、rules；R-002 核对目标 macOS arm64、本机 Node 与隔离 Node 24.21.0；无线上部署或远程中间件。R-001 搜索模块不适用 |
| meteor-flow-verification | 完整读取项目 SKILL、prerequisites、workflow、方案；doctor 通过，已扩展五个项目技能及来源哈希/双端入口检查 |
| test-master | 读取项目 SKILL，unit/integration/e2e/security/testing-anti-patterns 引用；本地工作流检查 26 项通过，非产品测试 |
| OCR delegate | 项目锁定 v1.12.12，version 可运行；独立 `/root/technical_review` 审查技能接入，原始 preview/rule 在本目录 |
| Playwright | 项目技能固定 b85c7a736bb473bf55b584e54a09ffa698d6d871，完整引用与 Apache 许可证；显式读取 SKILL、tests/running-code/session 引用。@playwright/test 1.63.0，CLI 0.1.22，Chromium v1243 放 .tools/playwright |
| Impeccable | 固定 cf3d2fa07d3ad1814ac5fbbbb5b2043b795eaef1，完整技能/引用/脚本/许可证；engine 0.1.11 经官方 SHA-256 校验，Codex/Claude 共用入口；engine-probe 与 context 实际执行。根目录上下文误判按项目适配直接读取任务文档；报告不用上游根目录 storage |
| pnpm | 读取个人 pnpm SKILL 和配置/workspace 引用；实际 pnpm 11.9.0，Node 24.21.0 安装固定依赖，锁文件已生成 |

已实际加载 better-sqlite3 13.0.3，查询 SQLite 3.53.4。安装含 Node 原生扩展编译，退出 0；未改系统 Node 版本。所有后续运行使用目标 Node 24，不以系统 Node 25 的结果替代兼容验证。

Chromium 首次启动因工具沙箱禁止 macOS Mach IPC 而失败；按执行工具授权流程重试，不修改系统防火墙或权限设置。重试实际启动 Chromium 153.0.8010.12、填写输入框、点击按钮并核对输出，退出 0。该能力检查在界面编码前完成；子 agent 也独立执行了相同能力检查。

独立审查子 agent 曾遇到 `Fatal error: application network permission was revoked`，正常入口重试后恢复；未绕过网络限制。用户另报告终端同文案错误，已请求具体命令以区分来源。已有文件与依赖均保留。

用户随后表示已不记得具体命令，可能发生在技能安装或开发检查。未据此推断操作系统/npm 根因；当前安装、构建、工具检查已恢复，不阻塞本轮实施。

后续产品六类场景和 V01—V29 按 implementation-plan 执行，当前无产品通过声明。技能审查修订、浏览器能力结果与产品最终验证分开记录。
