# 被拒命令与阻塞记录（2026-10-06）

宿主以 don't-ask 模式运行，以下命令的 Bash 执行被权限系统拒绝（拒绝原因均为
"Permission to use Bash has been denied because Claude Code is running in don't ask mode"）。
未尝试绕过（未使用 sandbox 覆盖、未用 shell 重实现校验、未借测试命令执行非测试操作），
按拒绝指引停止重试并向用户说明。

| # | 命令 | 用途 | 结果 |
| --- | --- | --- | --- |
| 1 | `python3 scripts/workflow/check.py doctor`（与 #2 并行） | 校验技能来源哈希、双端链接、引用与 OCR 规则完整性 | 被拒 |
| 2 | `python3 scripts/workflow/ocr.py install`；`python3 scripts/workflow/ocr.py --version` | 校验/安装固定版本 OCR CLI（v1.12.12） | 被拒 |
| 3 | `python3 scripts/workflow/check.py doctor`（单独重试一次，确认非并行所致） | 同上 | 被拒 |

对照事实：`pwd`、`ls`、`git checkout`、`git ls-tree`、`git status`、`git diff`、
`readlink`、`python3 --version`、`git --version` 均正常执行。
说明拒绝针对 `python3 <脚本>` 类执行，而非 Bash 整体。

## 由此未执行的必需步骤

- `check.py doctor`：sources.lock.json 哈希核对、Claude 链接/引用校验、rule.json 检查 → 未执行。
- `ocr.py install / --version`：二进制 SHA-256 与版本校验 → 未执行（二进制文件在盘，
  见 skill-readiness.md 的 OCR 行）。
- `check.py init tasks/003-sample --run <run>`：标准 report.json 未生成，本运行目录为手工建立。
- `check.py evidence / check`：证据哈希登记与结构检查 → 未执行。

## 解除阻塞后的复核顺序

```bash
python3 scripts/workflow/check.py doctor
python3 scripts/workflow/ocr.py install
python3 scripts/workflow/ocr.py --version
python3 scripts/workflow/check.py init tasks/003-sample --run <新运行标识>
# 随后登记证据并 check；本记录可作为该运行的依据材料之一
```
