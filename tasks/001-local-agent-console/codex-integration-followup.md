# Codex 实体测试授权与执行记录

日期：2026-10-08。确认状态：用户已于 2026-10-08 明确“授权按此方案继续测试”；不修改已确认产品行为。适用：当前 Codex CLI 0.160.1 / herdr 0.9.3 / macOS arm64 的隔离集成测试。

## 授权前已查明事实

1. 原默认启动在提交后退出。保留现场确认：`Cannot use the shared background server: This session requires api_key_model_discovery to be disabled.`；未产生 hello.txt/result.json，控制台保留待确认与占用。Claude 同轮完成固定任务并归档。
2. 仅对照追加官方 `--no-daemon` 后，该错误消失；首次处理任务才出现 agent_session，当前身份策略保守暂停，仍需产品兼容设计及反例验证，不能在测试里忽略身份变化。
3. 启动更新提示被外部 herdr 判为就绪；一次诊断进入 `brew upgrade --cask codex`，发现后立即停止自建 herdr 会话。之后核验 Codex 仍为 0.160.1；原配置文件哈希未变。不声称 Homebrew 元数据完全未动。
4. 在单次启动参数关闭更新检查、禁止诊断子进程执行 brew 后，Codex 开始处理固定任务，但其执行器报 `sandbox_apply: Operation not permitted`，并明确等待人工恢复权限。当前测试给整个 herdr 进程树叠加 sandbox-exec（保护全局配置只读），该模式与独立 Codex 再创建执行沙箱冲突；此前共享 daemon 在外层进程树之外，未触发这一路径。

原始证据在 verification-runs/20261008-review-final2/real-agents/ 与 verification-runs/20261008-result-review/codex-*/。诊断临时测试代码已经移除；源码快照仅作证据保存。以上为授权前状态；不能将当时诊断当作完整真实 Codex 验收通过。

## 已授权的具体操作

继续使用独立 herdr session、临时工作目录、固定 hello.txt 和 result.json 任务；仅针对 Codex 使用：

```text
codex --no-daemon -c check_for_update_on_startup=false --sandbox workspace-write --ask-for-approval on-request
```

用正常进程启动该测试 herdr，不再给整棵进程树叠加外层 sandbox-exec。保留 Codex 自身 workspace-write 沙箱与 on-request 审批，不使用绕过审批/信任/沙箱的开关。配置文件仍进行执行前后哈希核验，但外层“强制只读”保护不再存在：模型工具的写入范围由 Codex 自身沙箱约束，启动程序本身不受该外层限制。这是本次已说明并获授权的实质差异。

不改用户全局模型配置、不重启共享 daemon、不升级软件、不回答任何登录/目录信任/工具权限提示。若再次遇到提示立即停止，不由超时或默认选项代替授权。启动更新检查的关闭仅限本次参数，版本升级继续由用户自行管理；该参数见 [OpenAI 配置参考](https://developers.openai.com/codex/config-reference/)，--no-daemon/workspace-write/on-request 已从本机 --help 核对。

这一步先验证环境及文件任务，不把诊断专用启动参数直接当作产品修复。若任务能生成结果，随后再按独立审查建议实现受约束的首次会话身份补全及托管启动兼容，并完整复验；已提交的原任务不重发，新的试验使用新 session/operation。

## 授权时序与后续关卡

用户原真实测试授权明确约定“遇到登录、目录信任或工具权限提示会停止”。本次已出现执行沙箱权限失败；因此先交代替代方式与失去的外层保护，再请求具体授权，不能用原授权自动同意工具权限或移除保护。

2026-10-08 用户已明确授权按本方案继续。此前 blocked 汇总保留为授权前快照；新阶段先补测试提示识别，再执行单独 Codex 诊断。仍不自动确认任何登录、信任或工具审批，也不改全局配置或升级。

## 授权后的实际结果

2026-10-08 已完成单独诊断、产品启动兼容与首次会话标识补全、实际输入前的提示拦截、反例回归和独立审查。Codex 固定任务通过真实适配器及应用状态链路，观察到执行活动，结果与执行 ID 一致、hello.txt 精确校验并持久归档，配置前后哈希相同；Claude 也有同轮成功证据。见 [最终分层报告](verification-runs/20261008-delivery/report.json)。

真实成功仍受所测版本与固定任务范围限制，历史失败保留；没有修改用户全局配置、升级软件或自动同意外部提示。Codex 不叠外层沙箱的保护差异仍有效，不因哈希相同宣称具备外层强制只读保护。人工验收 pending。
