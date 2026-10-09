# 首次会话补全与托管 Codex 启动：实现边界独立意见

日期：2026-10-08。状态：方案/实现前边界意见，**未审签尚在编写的完整候选**。审查者 `/root/technical_review`；本轮未修改产品、未调用模型。既有 R03/R04/R10 和新授权诊断范围有效，不重复请求授权。

一次 null→首次非空 agentSession 可以作为同一已确认进程的证据补全；基础 fingerprint 继续包含 session/socket/connectionId/terminal/type/PID/start/canonical cwd，完整 fingerprint 保留 agentSession，符合 R04 使用可获得的会话和进程证据的原则。同步补全 binding 与活动 attempt 并写审计、不改变输入/派发次数/模式/暂停/seenActivity，是适当边界。非空替换、进程/连接代/目录变化及恢复不能借此继承旧授权。完整实现仍需反例和真实产品路径证据。

## 需要落实的边界

1. **观测缺口资格不能靠相邻两帧推导。** 当前 observe 的缺失分支和 disconnect 只清 observation 并 pause，没有清 confirmed。具体反例为“已确认、session=null → 一轮不可见 → 同指纹 null 再可见 → 下一轮出现 session”。后两帧又能满足 old/new fresh、old.fp=b.fp、相同 base，先前缺口已经从相邻观测消失。需持久标记补全连续性失效或撤销确认，直到人工重新确认；暂停模式本身不能证明原活动 attempt 连续。测试应覆盖缺失/断线/过期后先出现新鲜 null 再补全的顺序。
2. **冲突检查必须与遍历顺序无关。** 用本批开始前的已确认绑定/占用执行快照加完整 observations 决定资格；不能先在 for-loop 撤销前一绑定的 confirmed，然后让后一绑定自动取得同一个原会话。两条候选同时补同一 session、既有 confirmed 会话所有者本批变身份，以及倒序绑定/观测排列，都应得出同一保守结论。
3. **可选基础身份缺失不构成相等证据。** old/new instanceFingerprint 均须为有效非空值，不能让 undefined===undefined 通过。PID/start/canonical cwd/type/terminal 也须有效且显式相同；旧数据或旧适配器没有该字段时保留原暂停路径。新非空 session 字段同样应通过原接口类型/内容校验。
4. **启动探测成功但无 flag 与探测失败分开。** 有界 help 确認支持 --no-daemon 及 --config 后才加固定参数；旧版正常返回、确无能力时保留原路径。timeout/exec/输出超限或无效响应应明确终止本次尚无外部 workspace 副作用的启动，不静默等同“不支持”继续。探测后仍检查连接代；不按运行错误自动重启。服务 PATH 与 herdr shell 解析可能不同，保持已说明的能力边界。

以上为需在候选中核对的约束，不是声称作者已经实现了有缺陷的版本。只要上述资格成立，补全不应改变取消顺序、dispatch unknown/not_sent、resultConflict、恢复暂停或人工控制权；旧 token/epoch 的身份约束也不能被自动延长。首次补全的审计只应产生一次；重复观察幂等。

六类场景关注：状态迁移（一次补全、不升级权限）、幂等（重复观察单审计/无新派发）、时序（缺口及批次顺序）、恢复（服务/连接恢复不得自动补全）、关联（binding/active attempt 同事务和跨绑定唯一性）、隔离（连接代/目录/原生进程与固定启动参数）。对应 R02/R03/R04/R09/R10/R12、V03/V05/V07/V18/V19/V24/V26。后续完整候选需由独立 reviewer 检查源码、事务持久化、反例及真实产品结果；本方案意见不构成产品 E2E 通过。
