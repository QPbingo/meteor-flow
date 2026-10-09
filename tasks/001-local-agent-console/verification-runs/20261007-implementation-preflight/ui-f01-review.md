# F-01 / M01 增量独立复查

日期：2026-10-07。状态：**F-01 已修复并关闭，本增量无新增 critical/high/medium 发现**。独立 reviewer：`/root/ui_technical_review`。适用：`Markdown.tsx`、`Tasks.tsx`、`styles.css` 与两份 web E2E；不重做已关闭的 A/B 设计循环、不修改业务代码。人工验收仍 pending。

## 基线与技能

延续同一审查上下文已加载的项目 verification、test-master、OCR、Playwright、Impeccable、capture-constraints；本轮 doctor 退出0。读作者 web-f01-report 及源码/调用方/测试，独立检查作者 hashes 与实际文件，执行前后均无不一致。准确指纹为 `ui-f01-hashes.json`，主构建 `index-VXk26kR3.js`（SHA-256 `977e3f5665a2e2b3c6750de0d6dc6accce77526cc9ea5fe240b1d4017f7ae350`）。Node24.21.0、项目Playwright1.63.0/Chromium环境不变，无下载/升级。

OCR preview/rule均实际退出0；原文 `ui-f01-ocr-preview.json`、`ui-f01-ocr-rules.json`。增量5/5文件reviewed，workspace165条中的其余160条为本轮范围外，逐项记录 `ui-f01-ocr-coverage.json`。新增 Markdown 文件完整阅读，Tasks相关调用和两份测试完整增量已检查；没有扩大到未冻结后端。

## 独立测试

实际命令：`pnpm exec playwright test tests/e2e/web-console.spec.ts tests/e2e/web-server.spec.ts --workers=1 --reporter=line -g 'Markdown|browser creates'`。

结果：**退出0，3/3通过，6.3秒**。原始日志 `ui-f01-e2e.log`。两项为模拟API边界测试，一项为真实UI/HTTP/SQLite worker/collector/文件归档链路，唯一外部代理边界是FakeHerdr。服务、数据库、浏览器、外链目的地均隔离；主动打开链接由context route在本机拦截，未连接外网；资源由测试finally清理。

本次实际截图另存 `ui-f01-markdown.png`，已视觉检查；哈希 `ui-f01-screenshot-hashes.json`。1×1PNG是否成功不能靠截图肉眼判断，测试已断言naturalWidth=1以及blob生命周期。当前整个E2E集合有13项；本 reviewer仅重跑3项增量，不将旧12项通过改称新基线全套通过，根 agent负责最后全套。

## 核验结论

| 要求 | 独立核对与实际证据 | 结果 |
| --- | --- | --- |
| 当前结果归属 | Tasks先按taskId+attemptId筛选；旧attempt、其他task都不进入Summary候选。实际API请求只出现允许的ID。 | pass |
| Markdown文件相对图片 | sourcePath父目录解析；同一rootId匹配；根内`../pixel.png`真实解码成功。绝对/协议URL/反斜杠/控制字符/query/fragment/越根被拒绝；同路径跨root歧义不猜测。 | pass（正向与歧义/越界运行；其余格式源码核对） |
| 冻结依赖 | 同task/attempt且在冻结artifacts的id+sha256内；secret-id、changed-id、foreign/old均未请求，frozen-id成功。 | pass |
| MIME/大小后建图 | 元数据>20MiB不请求；response状态、Content-Type和已知Content-Length先校验，blob读取后再核验size/abort，成功后才创建img/blob。wrong MIME保留alt、不渲染；只接受PNG/JPEG/GIF/WebP。 | pass（元数据超限/错误MIME有运行证据；响应header/blob超限分支静态核对，未伪称各分支均注入测试） |
| HTML与远程隔离 | rawHTML renderer先转义再净化；span映射标记只由renderer生成。原始img/a/script不能成为元素。远程Markdown/raw图片零请求；window.bad未设置，危险scheme无链接。 | pass |
| 主动外链 | 仅完整HTTP(S)，target=_blank、noopener noreferrer、referrerpolicy=no-referrer；实际点击前无外部请求，点击后本地拦截目的地打开且opener=null。 | pass |
| 资源与恢复 | 按ID合并读取，轮询后blob仍同一URL；切换tab或关闭预览旧blob不可读取。cleanup abort未完成读取并revoke；失败回退alt。 | pass（去重/abort竞态实现静态检查，轮询/回收实际执行） |

映射只使用归档元数据和artifact ID，不把Markdown路径交给后端任意文件读取。新模块只依赖React、净化/解析器与共享Artifact类型，Tasks传入明确范围；没有引入后端依赖。解析结果净化后只允许受限标记，实际图片通过核验成功后的DOM创建，修复了作者首轮detector提示的空src破图问题。作者当前 `web-f01-detect.json` 为`[]`，本 reviewer已读；没有另跑一轮detector/overlay。

## 六类场景

- 状态迁移：alt→验证成功图片，错误MIME/未知图片继续alt；切换视图清理。
- 幂等：无新业务写入；同ID分组、轮询不重新替换图片；真实主流程数据库项目count1、prompt1。
- 时序：先范围、MIME/大小检查再显示；外链必须点击；卸载后中止请求并撤销资源。
- 恢复：图片失败不改读工作目录或远程降级；保留文字；blob释放有实际断言。
- 关联：当前task/attempt/root/sourcePath与冻结id+sha三类范围分别核对。
- 隔离：rawHTML转义、远程0请求、危险scheme不导航、外链无opener；独立临时服务及模拟herdr边界。

F-01原缺口已补齐，可关闭；此前A/B关闭结论沿用，未再次宣称其在新构建全套重跑。此次没有新增需要作者修复的high/medium。整体真实herdr兼容、负载性能和人工验收仍由根工作流判定。

Questions skipped: 已确认方案漏项的授权内增量复查，无新增范围或人工决策。
