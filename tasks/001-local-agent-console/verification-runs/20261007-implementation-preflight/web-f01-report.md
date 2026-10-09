# F-01 / M01 Markdown 预览增量修复

日期：2026-10-07。状态：作者修复与增量复验完成，待独立 reviewer 复查；人工验收仍 pending。适用范围：apps/web/src/Markdown.tsx、Tasks.tsx、styles.css 与两份 web E2E。依据：已确认 technical-design §8、独立复查 F-01/M01 和根 agent 的明确补齐指令；没有新增选型或后端修改。

## 开发前检查

沿用本执行上下文完整加载的 capture-constraints、meteor-flow-verification、test-master、Playwright、Impeccable、OCR 委托。复读 capture-constraints 完整 index/rules，R-002 的本机 Node 24.21.0/锁定依赖目标不变，R-001 不适用。复读 technical-design §8、Artifact/FrozenDependency 契约，并核对本地 Marked 17.0.6 renderer 类型及 DOMPurify 3.4.16 净化实现；无网络下载和库升级。前轮 A/B 已关闭问题不重新扩大审查，只保留相关回归覆盖。

## 最终行为

- 结果摘要仅在所选 attempt 的已归档产物范围匹配 sourcePath；同路径在多个输出根匹配时拒绝猜测，显示图片 alt。
- Markdown 文件的图片路径相对其 sourcePath 父目录解析，且必须属于同一 rootId。允许根内 `../`，越过根、绝对路径、反斜杠、控制字符、协议 URL、query/fragment 均不映射。解析只查归档元数据，不读取工作目录路径。
- 冻结依赖摘要仅匹配该快照列出的 artifact id/sha256，并再次限定 taskId/attemptId；上游新执行或同 ID 不同哈希不能进入范围。
- 图片请求固定为 `/api/v1/artifacts/<encoded-id>/content`，元数据和响应均限制 20 MiB；只接受 PNG/JPEG/GIF/WebP Content-Type。获取成功才创建 blob image；请求、解码或格式失败保留 alt。离开/替换内容时中止请求并 revoke 所有对象 URL，同一摘要重复引用同一 ID 只取一次。1 秒快照校准不会移除已显示图片。
- Markdown 外链只接受完整 HTTP/HTTPS 地址，带 `target=_blank`、`rel="noopener noreferrer"`、`referrerpolicy=no-referrer`。只在用户主动点击时导航；javascript/data/file/custom scheme 仅显示链接文字。远程图片没有请求入口。
- Marked raw HTML renderer 转义全部原始 HTML，然后 DOMPurify 白名单净化。用户原始 img/a/script 不会变成元素，也不能伪造图片映射标记；归档图片由核验响应后的 DOM 创建。

## 实际增量验证

Node PATH：`/tmp/meteor-flow-node-design-probe-20261006/node_modules/node/bin`；Chromium 使用仓库 `.tools/playwright`，正常 sandbox escalation、独立测试上下文。

| 命令 / 用例 | 结果与证据 |
| --- | --- |
| `pnpm --filter @meteor-flow/web build` | 退出 0，web-f01-build.log |
| `pnpm exec tsc --noEmit` | 退出 0，web-f01-typecheck.log |
| `pnpm exec playwright test tests/e2e/web-console.spec.ts tests/e2e/web-server.spec.ts --workers=1 --reporter=list -g 'Markdown\|browser creates'` | 3/3 通过，web-f01-playwright.log；只复验本增量及实际服务主流程，没有把旧全套 12 项结果换成新基线 |
| `impeccable detect --json apps/web/src` | 最终退出 0、[]，web-f01-detect.json |

模拟 API 用例验证：当前执行图片可见；旧 attempt、其他任务、多 root 同路径、超过元数据限额、越界/远程不请求；返回 text/plain 的伪图片不渲染；冻结依赖只读 ID+哈希匹配项。实际请求 ID 精确为 current-id/text-id/frozen-id，没有 secret/changed/foreign 请求。状态轮询更新后仍保留同一 blob URL；切换页签撤销旧 URL。

真实 Console/HTTP/SQLite/collector E2E 验证：任务结果摘要显示归档 pixel.png；docs/report.md 内 `../pixel.png` 显示 naturalWidth=1 的 blob 图片；远程 Markdown 图片/raw HTML 图片零请求；合法外链属性完整、其他 scheme 不产生链接；raw HTML 无 script/onerror 元素，window.bad 未设置。测试点击合法外链后打开独立窗口且 opener=null，目的地由测试 context 本地拦截，未连接外网。关闭 Markdown 预览后 blob URL 不可读取。其余项目创建幂等、确认 Agent、任务成功、结果归属数据库断言同一主流程继续通过。herdr 边界仍为 FakeHerdr，不声明实际 herdr/Agent 集成。

截图：web-f01-markdown.png。准确源码、测试和构建哈希：web-f01-hashes.json。本记录不替代独立 OCR。

## 六类场景

| 类别 | 需求 / 增量证据 |
| --- | --- |
| 状态迁移 | R08/R11：alt→安全归档图片；格式失败仍为 alt；切换页签撤销资源。 |
| 幂等 | R02：不增加写入；重复图片 ID 合并读取、轮询保持同一 DOM/URL；实际服务主流程仍只建一次项目/派发一次。 |
| 时序 | R09/R11：先映射允许 ID、核验 MIME/限额，再创建图片；导航只有显式点击后发生；离开时 abort 阻断迟到响应。 |
| 恢复 | R11/R12：未知、歧义、失败、超限显示 alt，不转读任意路径或自动远程降级。 |
| 关联 | R05/R08/R11：task/attempt、sourcePath/rootId、冻结 ID+SHA-256 三层范围核验。 |
| 隔离 | R10/R14：remote 不请求、raw HTML 转义、危险 scheme 无链接、外链 opener 隔离；专用测试数据和本地拦截目的地。 |

## 保留失败与处理

首次 3 项测试为 1 通过/2 失败，web-f01-first-failure.log 保留。原因是严格 URI 正则同样作用于 renderer 生成的 data-artifact-id/target/rel/referrerpolicy，导致映射标记被移除。核对 DOMPurify 3.4.16 源码后，仅把这四个固定非 URI 属性列入 ADD_URI_SAFE_ATTR，href 仍限定 HTTP/HTTPS；复验通过。

detector 首次指出延迟填 src 的 img 可能短暂显示 broken-image（web-f01-detect-initial.json）。已改为先显示 span alt，读取和 MIME 校验通过后才创建带有效 blob src 的 img；解码错误也回退 alt。最终 detector 零项、三项 E2E 再次通过。没有丢弃发现或将作者判断当作独立关闭。

Questions skipped: 原技术方案内的漏项补齐已明确授权。无人工验收签署；F-01/M01 最终关闭由独立 reviewer 判断。
