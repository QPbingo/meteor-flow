# 控制台独立技术审查

日期：2026-10-07。状态：**未通过发布关卡，待作者修复与独立复验**。作者之外的独立 reviewer：`/root/ui_technical_review`。适用：`apps/web/`、`tests/e2e/`；目标 `apps/web/src/App.tsx`。这是初次实现审查，不签署人工验收。运行方式、技能就绪、检测器和截图来源见 [Assessment B](ui-assessment-b.md)。没有阅读 Assessment A 报告。

## 实现完整性判断

**不通过当前行为完整性关卡。** 页面具有产品所需的本地 session、Agent 模式、任务/执行分离、只读终端和结果归属，工作台结构一致；机械 detector 返回零项。但未决写操作身份在刷新后丢失、终端客户端未实施协议版本检查，影响已确认 R02/R12/R14。零 detector findings 不能关闭这两项行为缺口。

## Audit Health Score

| 维度 | 0–4 | 依据 |
| --- | ---: | --- |
| Accessibility | 2 | 原生字段标签、Radix Tab/Modal、focus-visible、skip link 已有；placeholder 对比度 4.362:1，关闭 Modal 未回到触发按钮 |
| Performance | 3 | 本机首屏 loadEventEnd 73.5ms，主 JS 464347 字节、CSS 14206 字节，终端 lazy；没有高负载/1000 任务/持续输出基准，不能给 4 |
| Responsive Design | 3 | 1440/390/720 CSS px 实测页面无水平溢出；表格与 tabs 局部横滚；多个触点小于 44px，未测试物理触控 |
| Theming | 3 | 主色/表面/状态 tokens 和明确浅色工作台一致；hover、表头、placeholder、终端有硬编码颜色；需求未要求暗色主题，不将浅色固定记为“暗色损坏” |
| Implementation Integrity | 2 | 前端/契约分层、归属过滤、净化、状态提示较完整，但未决操作恢复和终端版本边界未实现 |
| **合计** | **13/20** | **Acceptable：发布前仍需解决重要问题** |

共 5 项：P0 0，P1 3，P2 2，P3 0。P1 的优先级同时映射本项目 high；没有将未经测试的性能目标写成失败事实。

## 发现

### B-01 [P1 / high] 页面重载丢失未决操作身份

- 位置：`apps/web/src/api.ts:44`、`:50`、`:51`；测试 `tests/e2e/web-console.spec.ts:76` 和 `web-server.spec.ts:32`。
- 类别：Implementation Integrity；R02、R12，V03/V04。
- 依据：operation_id 的 Map 只在 `useRef` 内保存；请求结果不明时保留同一组件内签名，但没有持久化或重连查询路径。页面刷新/关闭再开会创建空 Map，重试同一操作生成新 UUID。创建任务/项目允许相同内容的新动作，服务不能靠内容判定它是旧请求。UI 的“恢复连接后可重试同一操作”未限定刷新边界。
- 影响：服务已提交而成功回复丢失后，用户重新打开页面重建同一任务，可产生第二个任务/派发；当前旧页面内重试测试覆盖不到该恢复路径。
- 验证状态：源码确认；此次补充跨刷新浏览器探针被并行构建造成的空白页面阻塞，未宣称已在真实 DB 复现重复写入。现有 7 项 E2E 通过只证明原测试路径。
- 建议：把未决操作及其恢复信息持久化到本服务实例作用域，重新进入时先展示/查询已接受操作；明确区分恢复旧动作与用户主动创建相同内容的新动作。补“真实服务已提交→丢响应→页面重载→恢复同一操作→副作用仅一次”的用例，不能仅比较客户端 UUID。
- 建议命令：`$impeccable harden`。

### B-02 [P1 / high] 终端消息不拒绝未知协议版本或无效消息形状

- 位置：`apps/web/src/TerminalPanel.tsx:52` 至 state 分支；`tests/e2e/web-console.spec.ts:133`。
- 类别：Implementation Integrity；R09/R14，V18/V19/V27。
- 依据：`JSON.parse` 后仅分支检查 `type`，收包没有验证 `protocol`；state 为 control、token 是字符串、epoch 是整数即启用 stdin。缺少/未知协议版本也按当前规则接受。对未知 type 则静默忽略。当前 WS 测试所有服务入站 frame 都省略 protocol，因而未验证已确认“未知版本关闭连接并提示升级”的规则。
- 影响：服务/前端版本不匹配时，旧前端可以把未知版本消息解释成有效的控制授权，且无法清楚提示不兼容。这里是可确认的客户端边界缺口，不声称当前真实后端一定发送错误帧。
- 建议：用共享入站 schema 校验版本、判别类型及字段；版本未知或包结构无效立即失权、停输入、关闭连接并显示升级提示。补无协议、未知协议、畸形 state、未知 type 和旧代 frame 的浏览器用例，断言不能输入/resize。
- 建议命令：`$impeccable harden`。

### B-03 [P1 / high] Placeholder 未达到普通文本 4.5:1 对比度

- 位置：`apps/web/src/styles.css:2`，`input::placeholder,textarea::placeholder{color:#6e7a8a}`；搜索框、任务名和任务说明示例。
- 类别：Accessibility；WCAG 1.4.3（普通大小文本）；技术方案 §12 的无障碍要求。
- 依据：#6e7a8a 在实际白底 #ffffff 上 WCAG sRGB 对比度计算为 **4.362:1**。字体基础 14px，不属于大文本。截图 `ui-b-form.png`、`ui-b-desktop.png` 以及 CSS 为证。普通辅助文字 #5c697c/white 为 5.575:1，未一概判为不合格。
- 影响：低视力用户读搜索范围和输入示例更困难。
- 建议：将 placeholder 颜色纳入语义 token，选到至少 4.5:1；同时确认灰色 placeholder 不被用作唯一标签（现有可见字段标签应保留）。
- 建议命令：`$impeccable harden`。

### B-04 [P2 / medium] 关闭对话框后焦点落到 BODY

- 位置：`apps/web/src/ui.tsx:14`；测试 `tests/e2e/web-console.spec.ts:196`。
- 类别：Accessibility。
- 依据：真实浏览器点击“新建任务”后首个字段获焦；Escape 关闭后 `document.activeElement` 为 BODY（`ui-browser-b.json`）。首次 `:focus` locator 等待 30 秒仍未找到，失败保留在 `ui-browser-b-initial.json`。Modal 使用受控 open，页面触发按钮不在 Dialog.Trigger 内，也没有 onCloseAutoFocus 返回处理。原 E2E 只断言弹窗消失，没有检查返回焦点。
- 影响：键盘用户失去当前位置，继续 Tab 容易从页首重新导航。这里按效率/可预测性问题归 P2，不把单一 activeElement 结果夸大成全流程不可访问。
- 建议：保存打开时触发元素并在关闭时恢复焦点，或使用 Radix Trigger；覆盖 Escape、取消、提交成功和嵌套产物预览关闭。
- 建议命令：`$impeccable harden`。

### B-05 [P2 / medium] 常用控件触摸尺寸偏小

- 位置：`apps/web/src/styles.css:2`、`:4`。
- 类别：Responsive Design。
- 依据：桌面实测 task-title 151×28px、按钮通常 38px；窄屏统一按钮 min-height 42px，`.icon-button` 约35px、会话按钮34px、输入41px。44×44 是本次 audit 的触控质量检查阈值；不把小于44一律声称违反 WCAG 2.5.8 AA（该标准另有尺寸/间距及例外条件）。
- 影响：窄屏/低精度输入容易误触；表格任务名称和详情关闭控件尤需清晰点击区域。
- 建议：在 coarse pointer/窄屏为主要按钮、关闭图标和任务标题提供至少44px命中区，保持桌面信息密度；用 synthesized touch 检查操作和横向 tab/table 滚动。
- 建议命令：`$impeccable adapt`。

## 测试与六类场景复核

本 reviewer 实际执行前端模拟 API/WS suite，7/7 通过，日志 `ui-b-e2e.log`。真实样例服务仅用于已完成的只读交互；真实 service/DB E2E 文件已审查，但本 reviewer 未重新执行它，也未执行真实 herdr 集成。不能宣布全面验收就绪。

| 类别 | 需求/场景与实际证据 | 结论/边界 |
| --- | --- | --- |
| 状态迁移 | R01/R09；控制→断线→只读、存储不可写、观测过期；E2E第3/5/6项 | 模拟路径通过；未知 WS 版本未被校验，B-02 |
| 幂等 | R02/V03；丢响应→同一弹窗重试复用 ID、pending 禁重复；E2E第2/3项 | 同页通过；跨页面恢复未覆盖，B-01 |
| 时序 | R09/V18/V19；关闭 socket 后旧输入不重放；E2E第5项 | 模拟路径通过；双页面竞争和真实审批非本次执行范围 |
| 恢复 | R12；API失败保留快照/禁写→重取、终端重连只读 | 模拟路径通过；刷新后操作身份见 B-01；服务/DB重启由根集成验证负责 |
| 关联 | R08/R10/R11；项目过滤、旧 attempt 结果/输入切换；E2E第1/4项 | 模拟路径通过；已审查真实service E2E有DB归属断言，未重跑不记通过 |
| 隔离 | R10/R14；浏览器独立 context，样例临时数据/端口、模拟 URL、受净化 Markdown | 实际检查不接触生产；XSS/remote元素移除测试通过；无操作系统强隔离声明 |

## 已核验优点与误报处理

- 状态文字和图标共同表达阶段；任务状态、Agent 观测、调度、控制权分离。释放控制与恢复调度是两个明确操作。
- 输入有可见标签和 required；新建弹窗初始焦点、Escape 退出、原生表单约束可用。reduced-motion 下按钮 transition 为0s，没有用全局0.01ms破坏层级。
- 主页面没有布局 thrash 循环、宽泛 will-change 或昂贵装饰动画；终端按需 lazy，输出有1MiB待处理上限、5000行scrollback。
- CSP 阻止 localhost 外源 detector 是产品隔离生效，非产品缺陷；没有降低它来获取 overlay。preview 作者新增图片需要 blob 的支持另做版本复验。
- 390px 内任务表和 tab strip 的局部横滚是明确容器设计，截图测得整页 scrollWidth=390；不将其误判为整个响应式损坏。真实触摸滚动未测。
- 无暗色主题承诺，浅色主题不会因系统 dark 偏好被判失败。tokens 尚有可维护性改进空间，但无需为这次审查扩展产品范围。
- detector 零命中，没有被静默忽略的确定性 findings。

## 完整范围与后续动作

OCR v1.12.12 preview/rule 原文分别为 `ui-ocr-preview-b.json`、`ui-ocr-rules-b.json`。范围内13/13文件（11个web文件、2个E2E）均已逐一读取；全 workspace 150 中范围外137项明确 skipped，126项 OCR 排除逐项保留。`ui-ocr-coverage-b.json` 记录 (path,status) 与原因。范围内没有删除文件或OCR排除文件。13/13是文件交代比例，不是业务测试覆盖率。

作者并行更新了 ArtifactPreview（安全图片 Blob/Markdown/JSON/限额），本报告对新代码仅静态查看；首轮浏览器服务构建和已执行测试不作为该更新的通过证据。补充检查曾遇空白页面，诊断控制台为模块请求返回 text/html MIME、没有任何/api请求；属于评估构建切换阻塞，已交根 agent 重启版本后复验，不当作认证失败或产品最终缺陷。

修复顺序：P1 `$impeccable harden`（操作恢复、协议校验、对比度）→ P2 `$impeccable harden`（返回焦点）→ `$impeccable adapt`（触控命中区）→ `$impeccable polish`。作者完成后针对上述行为和新预览统一复验，并交独立 reviewer 复查；本 reviewer 不修改源码。

Questions skipped: 当前实现和修复已获授权，按项目适配直接交作者处理；无新增产品或技术选型问题。
