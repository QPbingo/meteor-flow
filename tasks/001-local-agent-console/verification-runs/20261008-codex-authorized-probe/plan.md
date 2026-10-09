# 已授权 Codex 隔离诊断

日期：2026-10-08。状态：用户明确授权替代保护方案，尚未执行。适用：固定 hello.txt/result.json 小任务。

开发前已重读 capture-constraints 索引/R-002，实际核对 Node24.21.0/SQLite3.53.4/darwin arm64；无线上部署。项目 verification/test-master/OCR 已加载且 doctor 通过；本阶段不改界面，已准备后续独立审查。

先补真实测试对更新提示、执行器权限失败、共享 daemon 错误的阻断识别并用记录中的屏幕片段回归，提交任务前再次检查。诊断专用入口仅为 Codex 单次追加已批准参数，不先视为产品修复。取消外层 sandbox-exec，只在自建 herdr/cwd 运行，配置前后哈希核对；遇提示停止并清理自建进程。

六类场景：状态迁移（ready 与阻断）、幂等（固定任务只提交一次）、时序（投递前最后检查）、恢复（失败保留证据不重发）、关联（hello/result 的 task/attempt）、隔离（新 session/cwd、保留 Codex 自身 sandbox）。若结果生成而应用因首次会话身份暂停，分开记录，不将模型输出等同产品全链路通过。
