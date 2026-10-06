# 宿主行为验证上下文

Codex CLI 0.160.1、Claude Code 2.1.195；2026-10-06。
隔离样例由 scripts/workflow/tests/host_fixture.py 生成，两宿主均以独立新会话调用 meteor-flow-verification。
任务要求：对 tasks/003-sample/requirements.md 做独立走查，读取 test-master 与 OCR 委托技能，运行测试和 preview/rule，逐项报告六类场景、是否可验收；不改候选代码、不安装无关技能、不生成流程记录，最终答复保存命令、结果、技能路径和发现。
Codex 使用 exec --ephemeral --sandbox read-only --json；Claude 使用 -p、--permission-mode dontAsk、--output-format json、--no-session-persistence，放行读文件和所需本地命令。
两宿主进程退出码均为 0；候选 unittest 退出码均为 1（预置失败负例）。原始最终答复另存 codex-behavior.md、claude-behavior.md。
最终加载复测另起会话，只读三个 skill 并执行 doctor / OCR --version，不创建子 agent；两个进程退出码均为 0。
该记录为宿主运行证据，不代表产品 E2E 或人工验收。
