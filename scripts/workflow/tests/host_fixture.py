"""Create an isolated, intentionally imperfect candidate for host skill evaluations.

Not a product implementation. Expected findings are evaluated outside the host prompt.
"""
from pathlib import Path
import shutil
import subprocess
import tempfile

SOURCE = Path(__file__).resolve().parents[3]


def create():
    root = Path(tempfile.mkdtemp(prefix='meteor-workflow-host-')).resolve()
    for name in ('.agents', '.claude', '.opencodereview', 'scripts'):
        shutil.copytree(SOURCE / name, root / name, symlinks=True, ignore=shutil.ignore_patterns('__pycache__'))
    for name in ('AGENTS.md', 'CLAUDE.md', '.gitignore'):
        shutil.copy(SOURCE / name, root / name)
    shutil.copytree(SOURCE / 'tasks/002-development-workflow', root / 'tasks/002-development-workflow',
                    ignore=shutil.ignore_patterns('verification-runs'))
    if (SOURCE / '.tools/ocr').is_dir():
        shutil.copytree(SOURCE / '.tools/ocr', root / '.tools/ocr')
    task = root / 'tasks/003-sample'
    task.mkdir()
    (task / 'requirements.md').write_text('''# 独立测试样例需求
此目录只用于验证工作流，不代表 Meteor Flow 产品实现。
R1: 同一个 request_id 重复提交，仅产生一次执行副作用。
R2: 只有当前 attempt 的结果能完成当前任务；旧 attempt 结果不得改变当前状态。
R3: 重试创建新的 attempt；每个队列实例的记录独立。
本样例没有网页或数据库；不要求浏览器 E2E。测试命令：python3 -m unittest test_queue_sample -v。
请评估是否满足需求并报告，不修改候选代码。
''')
    subprocess.run(['git', 'init', '-q', str(root)], check=True)
    subprocess.run(['git', '-C', str(root), 'add', '.'], check=True)
    subprocess.run(['git', '-C', str(root), '-c', 'user.name=Workflow Fixture', '-c', 'user.email=fixture@example.invalid',
                    'commit', '-qm', 'workflow evaluation baseline'], check=True)
    (root / 'queue_sample.py').write_text('''class Queue:
    def __init__(self):
        self.effects = []
        self.attempt = 1
        self.status = "running"

    def submit(self, request_id):
        self.effects.append(request_id)

    def retry(self):
        self.attempt += 1
        self.status = "running"

    def complete(self, attempt):
        self.status = "success"
''')
    (root / 'test_queue_sample.py').write_text('''import unittest
from queue_sample import Queue

class QueueTests(unittest.TestCase):
    def test_repeated_request_has_one_effect(self):
        q = Queue()
        q.submit("r1")
        q.submit("r1")
        self.assertEqual(q.effects, ["r1"])

    def test_old_result_cannot_complete_retry(self):
        q = Queue()
        q.retry()
        q.complete(1)
        self.assertEqual(q.status, "running")

    def test_instances_do_not_share_effects(self):
        first, second = Queue(), Queue()
        first.submit("r1")
        self.assertEqual(second.effects, [])
''')
    return root


if __name__ == '__main__':
    print(create())
