# Skills 前置条件补充验证

日期：2026-10-06。范围：用户要求的使用条件及先引入再开发规则；人工验收 pending。

本次 /root 主执行上下文显式读取本仓库 AGENTS、三个项目 skills 及前置要求；所需技能已接入，doctor 与静态校验通过。任务仅修改技能指令/协作规则与来源记录，没有修改产品或工作流可执行脚本。无需重做已确认需求阶段，也不触发无浏览器任务的 Playwright/Impeccable 安装。

独立审查上下文 /root/prerequisites_review 审查全部 9 个变更文件。发现待接入技能缺准确来源后，已补官方仓库与入口并复核关闭；最终仅前置准备不要求完整 report.json 的补充也已复查。详见 review.md、coverage.json、preparation-clarification-review.json。

在互相独立的临时 Git 副本中，移除 Claude test-master 入口，保留原始项目技能与已锁定 OCR。宿主只被要求为纯 Python CLI 样例做技能准备、可补齐环境裁剪入口、不修改候选代码/测试，不执行产品验收或创建子 agent。

- Codex 0.160.1：发现入口缺失，按项目规则恢复；doctor、Python/unittest 入口与 OCR 委托探针成功，生成 skill-readiness，未开始编码。验证核心准备规则后，文档追加的来源指针及阶段区分由独立 reviewer 复核。
- Claude Code 2.1.195 首轮：入口恢复，但隔离会话的命令授权未放行部分 Python 脚本；如实记录“已引入待验证 / blocked”，没有把文件存在当成就绪。原始阻塞结果予以保留。
- Claude 最终副本：显式允许准备所需命令后，检测 doctor 退出码 2，恢复入口，doctor 退出码 0，OCR 委托与独立 unittest 能力探针成功，记录就绪；没有调用 init/evidence/check、候选测试或产品开发。
- 对三个副本独立复核：链接目标均为项目共享源，候选代码和测试 SHA-256 未改变，tracked diff 为空；详情 host-state.json。

三份 SKILL.md 静态校验和本仓库 doctor 通过。本轮没有新增运行时代码，未新增镜像文档内容的单元测试，未把历史 35 项测试声称为本轮重新执行。

边界：此次行为验证覆盖缺失入口修复、当前宿主加载、能力检查、权限失败保持阻塞；没有实际安装尚未触发的 brainstorming/forge-idea/Spec Kit/Playwright/Impeccable，不能声称这些已可用。仅前置准备就绪不授予产品编码权限，也不代表产品测试或最终验收通过。
