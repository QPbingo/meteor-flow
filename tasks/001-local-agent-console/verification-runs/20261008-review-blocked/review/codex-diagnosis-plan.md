# Codex 实体复验失败诊断

2026-10-08。首次最终运行 Codex 在提交后约 1 秒未知生命周期、随后不可见；无文件/结果，保留占用。Claude 同脚本通过。

现有日志只保留 pane 文本摘要，无法区分退出/交互/观测缺失。读取当前本机 Codex log 与当天 session 路径未找到该临时任务记录。按 diagnose，用原已授权固定任务仅增加错误行和当前观测采样，独立 session/cwd，配置只读，代码在 tests/integration/codex-diagnostic.test.ts 暂存，诊断完成删除。结果写独立 codex-diagnostic 目录，不覆盖首次失败。

待区分预测：1.Codex崩溃/网络权限错误应在自己的pane产生fatal/error且PID消失；2.herdr观测丢失则pane/前台process仍在而Agent列表消失；3.交互阻塞则出现登录/信任/权限提示并停止测试。仅增加诊断，不改产品和超时阈值，不通过盲目重试改变结论。
