# 前端修复的独立复查

日期：2026-10-07。状态：**本轮 A/B 修复复查通过，保留 1 项 medium 范围差距；整体人工验收 pending**。独立 reviewer：`/root/ui_technical_review`。范围：`apps/web/` 全部源文件与 `tests/e2e/`；不审查并行修改的性能后端，不改源码。本轮是有界复查，不重复完整双 agent critique；首次 A/B 的独立性仍按原报告保留。

## 方法与准确基线

沿用本会话已实际加载的 capture-constraints、项目 verification、test-master、OCR、Playwright 和 Impeccable 及相关引用；本轮再执行 doctor 退出 0，读取作者 web-refinement-report 及完整相关源码/测试，重新执行 OCR preview/rule（均退出 0）。没有重跑 context 或生成根 .impeccable 文档。

- Node v24.21.0，Playwright Test 1.63.0，Chromium 153.0.8010.12。
- 独立样例服务：临时 metadata 指定的隔离数据目录和端口，实际浏览器载入 `/assets/index-BgaYm1Rr.js`、`/assets/index-CaGdyP3D.css`。首次一次性入口兑换后复用当前 cookie/address；凭证未写证据。独立浏览器会话已关闭，临时探针已删除；共享评估服务由根 agent 负责。
- 主 JS SHA-256：`13fe2e8ed122a1acb1b62e3162def126b88ea09a5d926ec27bd84680e668cc93`。
- CSS SHA-256：`b99f809f442389ad1029f61f851017f692677c8f4129557f66288f186267b6ab`。
- 终端 chunk SHA-256：`96ce35fbd27122ac09afe2950de5700ebf19af4cea244de36e195ba4bfb0981d`。
- 13 个源码/测试文件哈希：`ui-final-source-hashes.json`；复查结束核对内容未变。OCR 原始清单/规则及逐项范围说明：`ui-final-ocr-preview.json`、`ui-final-ocr-rules.json`、`ui-final-ocr-coverage.json`。13/13 范围内文件 reviewed；workspace 159 条中的其余146条明确范围外，235条 OCR exclusion逐项交代。覆盖比例不代表业务测试覆盖率。
- 新版 detector 复用作者已经运行的 `web-refinement-detect.json`（原文已读 `[]`）；本 reviewer 未新增一次 detector/overlay 运行，不把作者执行称为独立执行。首次实际 CSP 阻止 overlay 的证据仍有效，本轮未降低 CSP。

## 独立实际执行

`pnpm exec playwright test tests/e2e/web-console.spec.ts tests/e2e/web-server.spec.ts --workers=1 --reporter=line`：退出 **0，12/12通过，11.5秒**，日志 `ui-final-e2e.log`。11项为构建前端+模拟API/WS；第12项为实际HTTP、SQLite worker、调度/归档文件及浏览器，外部 herdr/Agent 采用 FakeHerdr。这是本 reviewer 独立执行，不是引用作者的12项结果。

另对冻结样例服务执行独立只读浏览器走查：桌面、390px、200%文本、Agent页和弹窗；页面 console/pageerror均为空。结果 `ui-final-browser.json`，截图 `ui-final-desktop.png`、`ui-final-narrow.png`、`ui-final-narrow-detail.png`、`ui-final-narrow-viewport.png`、`ui-final-text200.png`、`ui-final-agents.png`；SHA-256见 `ui-final-screenshot-hashes.json`。已实际查看窄屏视口和200%截图；前者选择任务后详情立即处于视口内。

真实服务E2E生成的本次图片与结果证据已另存 `ui-final-image-preview.png`、`ui-final-real-service.png`；焦点与SSE测量为 `ui-final-suite-focus.json`、`ui-final-sse-latency.json`，不拿首次旧构建截图关闭修复。

## 前次发现逐项处理

| ID | 独立复验及证据 | 结论 |
| --- | --- | --- |
| A-01 选择任务后详情不可见 | 实际390×844触摸点击；标题获焦，边界x37/y17.625/w185.0625/h23.90625，完整在视口。关闭回原任务按钮；合成触摸E2E也通过。 | fixed |
| A-02 路径错误不可行动 | 真实服务E2E提交不存在目录，显示具体创建/纠正目录提示；字段保留、service项目数0；纠正后正常创建。 | fixed（HTTP/UI行为；后端实现不在本review范围） |
| A-03 / B-04 Modal还焦 | 独立样例页Escape/取消/关闭按钮三路径全部回“新建任务”；独立E2E再覆盖成功提交还焦和嵌套图片预览关闭还焦。 | fixed |
| B-01 未决operation_id刷新丢失 | 模拟测试核对SHA-256签名+ID存储、正文不落盘、刷新后同ID、成功/明确拒绝清除；真实服务完成写入后故意丢回复，刷新重新填同内容重试，SQLite项目数仍1。 | fixed，限定根指定sessionStorage同页签刷新边界 |
| B-02 终端协议未校验 | parseMessage验证v1、判别类型、字段、epoch/control token；独立E2E未知版本、缺协议、未知type、畸形state和迟到epoch全部禁输入/关闭，帧副作用0；正常控制/断线不重放仍通过。 | fixed |
| B-03 placeholder低对比度 | 浏览器计算色为rgb(100,112,132)，白底rgb(255,255,255)；对应#647084，sRGB对比度**5.00868:1**，超过4.5:1。 | fixed |
| B-05 触控目标偏小 | 390px实际主要button/input/select全部≥44px，关闭44×44；独立E2E touch tap和CDP touch swipe使表格scrollLeft增加。 | fixed；Chromium合成触控，非物理手机兼容声明 |

B-01的边界保留：sessionStorage不覆盖关闭页签后重建会话，也不保存原表单正文；这按根 agent 指定实现范围记录。同页签刷新已由实际服务证明，不能扩称所有断线/重启恢复均已验证。原高问题在此次指定刷新路径内关闭，原报告不删除。

## 新增预览与SSE复核

- PNG来自真实归档HTTP、CSP允许同源blob；naturalWidth=1，关闭dialog后fetch旧blob失败（已revoke）。支持的栅格MIME只限PNG/JPEG/GIF/WebP，其他MIME拒绝预览；文本只接受text/plain。JPEG/GIF/WebP目前有代码路径核对，没有逐一做图片解码实例测试。
- Markdown原始脚本/远程图片移除，实际浏览器没有相应外部请求；JSON按两空格缩进，纯文本按归档字节展示。task/attempt与SQLite产物归属、只一次prompt均断言通过。HTML/SVG等不在允许预览MIME中。
- SSE校验`meteor-flow.events/v1`及snapshot/change序号；未知协议测试明确关闭实时通知、快照读取仍可操作。真实服务E2E把1000ms轮询延至60000ms，初始snapshot到达后持久化设置，依赖change事件使UI更新。独立本次测量13.32675ms、sequence=2、1个样本，**不是p95/负载性能验收**。本机真实网络/DB，herdr边界模拟。
- 初次旧服务模块MIME空白阻塞在新冻结构建中不再出现，实际页面正常、浏览器无错误。

## 保留发现 F-01 [P2 / medium] Markdown内嵌归档图片和主动链接尚未实现

位置：`apps/web/src/Tasks.tsx` 的 `Summary`（allowlist）、`ArtifactPreview` Markdown分支。类别：Implementation Integrity / 已确认技术方案§8的预览范围。

已确认技术方案写明“Markdown图片全部经artifact ID映射，外链只显示可点击文本且需用户主动打开”。当前Summary完全不允许img/a且没有artifact映射参数，所以会移除合法的内嵌归档图片和链接行为；用户仍可独立打开/下载产物。现有测试证明的是脚本和远程资源不自动加载，不能证明本地内嵌图片或主动链接可用。此结论由允许标签列表及调用方确定，未把安全净化本身当作漏洞。

影响：带图的报告在Markdown预览中信息不完整，链接无法按确认方案使用；可下载查看，故为medium/P2而非新的high。建议在后续实现中只将明确归属的归档图片映射到artifact ID，主动外链保留安全属性和明确用户操作；补真实归档图片/失效引用/外部URL未自动请求测试。未实现前在交付范围列为明确限制。本 reviewer 不擅自改源码或替用户接受该差距。

## 六类场景及关卡边界

| 场景 | 本轮证据与适用范围 |
| --- | --- |
| 状态迁移 | 实际service任务从queued到成功/释放占用；mock终端坏协议失权；SSE改变暂停提示。 |
| 幂等 | 真实已提交项目丢回复→同页签刷新重试→SQLite count=1；pending禁止重复及明确4xx清除。 |
| 时序 | readonly不发resize；控制后用户输入才发；未知/旧代消息拒绝；断线无补发。 |
| 恢复 | 快照过期保持旧展示/禁写→读取恢复；SSE断线/不兼容降级提示；弹窗与详情返回焦点。 |
| 关联 | 切换attempt冻结输入/结果一致；产物task/attempt归属与SQLite断言；Blob生命周期绑定预览关闭。 |
| 隔离 | temp服务/DB/端口/浏览器；净化/CSP/MIME约束；无外部资源请求；未触碰用户真实agent。 |

仅覆盖上述前端和局部真实服务链路；真实herdr/Agent、全后端竞争与恢复、高负载性能由根后续记录。本轮不存在新critical/high；不能据此签署整体验收。

## 更新后的技术评分

| Accessibility | Performance | Responsive | Theming | Implementation Integrity | 合计 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 3 | 3 | 3 | 3 | **15/20，Good** |

可访问性、焦点及触控已明显改善；未做屏幕阅读器全覆盖，性能未做目标负载；浅色tokens仍有局部常量，Markdown预览范围仍有F-01，因此不授予满分。优点保留：工作台结构及不同状态分离清楚、终端按需加载且有界、协议错误安全降级、预览不会自动执行脚本/发外部请求。

Questions skipped: 当前授权内修复的独立复查；无新增设计决策。F-01保留为未关闭medium，交根综合处理，人工验收仍pending。

## 2026-10-07 F-01 / M01 关闭补充

F-01已由独立 reviewer 执行增量代码审查与3项真实浏览器测试后关闭；详见 [ui-f01-review.md](ui-f01-review.md)。当前构建为index-VXk26kR3.js，范围/截图/源码/测试指纹另列ui-f01-*，不覆盖上述首次复查证据。内嵌归档图片、冻结id+sha范围和主动安全外链已补齐；rawHTML、远程/未知资源仍不执行或自动请求。本增量无新增critical/high/medium。

前文“保留F-01”是当时历史结论，现由本节更新为fixed。Implementation Integrity从3调整为4，技术审查评分更新为**16/20，Good**；其他维度不重评。A/B此前关闭边界不变，13项最新全套由根agent执行；人工验收仍pending。
