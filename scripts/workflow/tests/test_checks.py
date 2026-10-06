"""Behavioral acceptance tests for workflow gates; no product claims."""
import copy
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('workflow_check', SOURCE / 'scripts/workflow/check.py')
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        for directory in ('.agents', '.claude', '.opencodereview', 'scripts'):
            shutil.copytree(SOURCE / directory, self.root / directory, symlinks=True, ignore=shutil.ignore_patterns('__pycache__'))
        for file in ('CLAUDE.md', 'AGENTS.md', '.gitignore'):
            shutil.copy(SOURCE / file, self.root / file)
        task = self.root / 'tasks/001-example'
        task.mkdir(parents=True)
        (task / 'requirements.md').write_text('R1: one durable effect per request.\n')
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        check.git(self.root, 'add', '.')
        check.git(self.root, '-c', 'user.name=Workflow Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture')
        self.path = self.root / check.init(self.root, 'tasks/001-example', 'sample')
        self.data = check.load(self.path)
        log = self.path.parent / 'checks.log'
        log.write_text('Synthetic fixture evidence only. Sample assertion passed.\n')
        preview = self.path.parent / 'preview.json'
        check.write(preview, {'reviewable_files': [{'path': 'sample.py', 'status': 'modified'}],
                             'excluded_files': [{'path': 'removed.py', 'status': 'deleted', 'exclude_reason': 'deleted'}]})
        self.data['evidence'] = {p.name: check.digest(p) for p in (log, preview)}
        self.data['scope'] = {'kind': 'behavioral', 'requirements': ['R1'], 'summary': 'Independent checker fixture'}
        for name in check.SCENARIOS:
            self.data['scenarios'][name] = {'applicability': 'applicable', 'reason': 'Exercise fixture gate', 'cases': [{
                'id': name + '-1', 'requirements': ['R1'], 'setup': 'empty temporary store', 'action': 'submit twice',
                'expected': 'one effect', 'status': 'pass', 'actual': 'one effect', 'evidence': ['checks.log']}]}
        for name in check.CHECKS:
            self.data['checks'][name] = {'status': 'pass', 'reason': '', 'evidence': ['checks.log']}
        self.data['commands'] = [{'command': 'fixture-test-command', 'status': 'pass', 'exit_code': 0, 'evidence': ['checks.log']}]
        self.data['review'] = {'status': 'pass', 'author_context': 'fixture-author', 'reviewer_context': 'fixture-reviewer',
            'preview': 'preview.json', 'files': [{'path': 'sample.py', 'status': 'modified', 'outcome': 'reviewed'}],
            'exclusions': [{'path': 'removed.py', 'status': 'deleted', 'reason': 'deleted', 'outcome': 'reviewed-manually', 'rationale': 'Checked callers'}],
            'findings': [], 'evidence': ['checks.log']}
        # Unit-test the gate against a stable selector result; actual CLI contract is integration-tested separately.
        self.expected_preview = check.load(preview)
        self.preview_mock = patch.object(check, 'current_preview', return_value=self.expected_preview)
        self.preview_mock.start()
        self.addCleanup(self.preview_mock.stop)

    def validate(self):
        check.write(self.path, self.data)
        return check.validate(self.root, self.path)

    def test_complete_record_is_ready_but_not_accepted(self):
        self.assertEqual(self.validate(), [])
        self.assertEqual(self.data['human_acceptance']['status'], 'pending')

    def test_each_unfinished_status_blocks(self):
        for status in ('fail', 'blocked', 'not-run'):
            with self.subTest(status=status):
                self.data['checks']['e2e'].update(status=status, reason='Environment unavailable')
                self.assertTrue(self.validate())

    def test_missing_scenario_rejected(self):
        del self.data['scenarios']['recovery']
        with self.assertRaisesRegex(ValueError, '六类'):
            self.validate()

    def test_case_failure_cannot_hide_under_other_passes(self):
        case = copy.deepcopy(self.data['scenarios']['ordering']['cases'][0])
        case.update(id='ordering-2', status='fail', reason='Late result overwrote cancellation')
        self.data['scenarios']['ordering']['cases'].append(case)
        self.assertTrue(self.validate())

    def test_behavior_cannot_exempt_all_scenarios(self):
        for group in self.data['scenarios'].values():
            group.update(applicability='not-applicable', cases=[])
        with self.assertRaisesRegex(ValueError, '所有场景'):
            self.validate()

    def test_invalid_baseline_after_code_change(self):
        (self.root / 'sample.py').write_text('effect_count += 1\n')
        with self.assertRaisesRegex(ValueError, '旧证据失效'):
            self.validate()

    def test_report_artifacts_do_not_invalidate_baseline(self):
        (self.path.parent / 'notes.md').write_text('review notes')
        self.assertEqual(self.validate(), [])

    def test_tampered_log_rejected(self):
        (self.path.parent / 'checks.log').write_text('Changed result')
        with self.assertRaisesRegex(ValueError, '证据发生变化'):
            self.validate()

    def test_missing_evidence_rejected(self):
        self.data['scenarios']['isolation']['cases'][0]['evidence'] = []
        with self.assertRaisesRegex(ValueError, '证据'):
            self.validate()

    def test_nonzero_exit_cannot_be_pass(self):
        self.data['commands'][0]['exit_code'] = 1
        with self.assertRaisesRegex(ValueError, '退出码'):
            self.validate()

    def test_backend_pass_requires_executed_command(self):
        self.data['commands'] = []
        with self.assertRaisesRegex(ValueError, '成功执行命令'):
            self.validate()

    def test_self_review_rejected(self):
        self.data['review']['reviewer_context'] = 'fixture-author'
        with self.assertRaisesRegex(ValueError, '独立上下文'):
            self.validate()

    def test_incomplete_review_blocks(self):
        self.data['review']['status'] = 'not-run'
        self.assertTrue(self.validate())

    def test_missing_preview_file_entry_rejected(self):
        self.data['review']['files'] = []
        with self.assertRaisesRegex(ValueError, '文件清单'):
            self.validate()

    def test_stale_or_empty_preview_cannot_hide_changes(self):
        file = self.path.parent / 'preview.json'
        check.write(file, {'reviewable_files': [], 'excluded_files': []})
        self.data['evidence'][file.name] = check.digest(file)
        self.data['review'].update(files=[], exclusions=[])
        with self.assertRaisesRegex(ValueError, '当前范围'):
            self.validate()

    def test_deleted_file_cannot_be_exempted(self):
        self.data['review']['exclusions'][0]['outcome'] = 'not-applicable'
        with self.assertRaisesRegex(ValueError, '必须补查'):
            self.validate()

    def test_deleted_generated_file_also_requires_review(self):
        preview = self.path.parent / 'preview.json'
        self.expected_preview['excluded_files'][0]['exclude_reason'] = 'user_exclude'
        check.write(preview, self.expected_preview)
        self.data['evidence'][preview.name] = check.digest(preview)
        self.data['review']['exclusions'][0].update(reason='user_exclude', outcome='not-applicable')
        with self.assertRaisesRegex(ValueError, '必须补查'):
            self.validate()

    def test_skipped_file_blocks(self):
        self.data['review']['files'][0].update(outcome='skipped', reason='Too large')
        self.assertTrue(self.validate())

    def test_unaccounted_exclusion_rejected(self):
        self.data['review']['exclusions'] = []
        with self.assertRaisesRegex(ValueError, '排除项'):
            self.validate()

    def test_unresolved_high_cannot_be_deferred(self):
        self.data['review']['findings'] = [{'severity': 'high', 'content': 'duplicate side effects', 'disposition': 'deferred'}]
        self.assertTrue(self.validate())

    def test_false_positive_needs_evidence(self):
        self.data['review']['findings'] = [{'severity': 'high', 'content': 'suspected duplication', 'disposition': 'false-positive', 'rationale': 'Checked', 'evidence': []}]
        with self.assertRaisesRegex(ValueError, '证据'):
            self.validate()

    def test_path_escape_and_external_symlink_rejected(self):
        for name in ('../outside.log', '/tmp/outside.log'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                check.inside(self.path.parent, name)
        (self.path.parent / 'escape').symlink_to(self.root / 'AGENTS.md')
        with self.assertRaisesRegex(ValueError, '越界'):
            check.inside(self.path.parent, 'escape')

    def test_reject_overwriting_history(self):
        with self.assertRaisesRegex(ValueError, '运行已存在'):
            check.init(self.root, 'tasks/001-example', 'sample')

    def test_init_rejects_escaping_evidence_directory(self):
        task = self.root / 'tasks/002-escape'
        task.mkdir()
        with tempfile.TemporaryDirectory() as outside:
            (task / 'verification-runs').symlink_to(outside)
            with self.assertRaisesRegex(ValueError, '越界'):
                check.init(self.root, 'tasks/002-escape', 'sample')
            self.assertFalse((Path(outside) / 'sample').exists())

    def test_broken_claude_link_detected(self):
        link = self.root / '.claude/skills/test-master'
        link.unlink()
        link.symlink_to('/missing-skill')
        with self.assertRaisesRegex(ValueError, '链接'):
            check.doctor(self.root)

    def test_changed_vendored_skill_detected(self):
        (self.root / '.agents/skills/test-master/references/unit-testing.md').write_text('drift')
        with self.assertRaisesRegex(ValueError, '来源文件'):
            check.doctor(self.root)


if __name__ == '__main__':
    unittest.main()
