"""Contract tests against the installed pinned OCR binary; skipped when not installed."""
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import unittest
from host_fixture import create, SOURCE

spec = importlib.util.spec_from_file_location('workflow_check_integration', SOURCE / 'scripts/workflow/check.py')
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class OCRIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not (SOURCE / '.tools/ocr').is_dir():
            raise unittest.SkipTest('先运行 python3 scripts/workflow/ocr.py install 才能验证真实 CLI')
        cls.root = create()
        cls.addClassCleanup(shutil.rmtree, cls.root)
        (cls.root / 'ignored.generated.py').write_text('GENERATED = True\n')
        deleted = cls.root / 'deleted.generated.py'
        deleted.write_text('GENERATED = True\n')
        check.git(cls.root, 'add', 'deleted.generated.py')
        check.git(cls.root, '-c', 'user.name=Workflow Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'deletion fixture')
        deleted.unlink()

    def run_ocr(self, *args):
        return subprocess.run([sys.executable, str(self.root / 'scripts/workflow/ocr.py'), *args],
                              cwd=self.root, text=True, capture_output=True, timeout=60)

    def test_preview_includes_test_and_reports_real_exclusion_schema(self):
        result = self.run_ocr('delegate', 'preview', '--format', 'json')
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data['schema_version'], '1')
        self.assertIn('test_queue_sample.py', {f['path'] for f in data['reviewable_files']})
        self.assertIn(('ignored.generated.py', 'user_exclude'), {(f['path'], f['exclude_reason']) for f in data['excluded_files']})
        self.assertIn(('deleted.generated.py', 'deleted', 'user_exclude'),
                      {(f['path'], f['status'], f['exclude_reason']) for f in data['excluded_files']})
        self.assertEqual(check.preview_scope(data), check.preview_scope(check.current_preview(self.root, data)))

    def test_rule_contains_project_requirements(self):
        result = self.run_ocr('delegate', 'rule', '--format', 'json', 'test_queue_sample.py')
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertIn('idempotency', json.dumps(data))
        self.assertIn('independent context', json.dumps(data))

    def test_evidence_growth_is_outside_scope(self):
        before = json.loads(self.run_ocr('delegate', 'preview', '--format', 'json').stdout)
        directory = self.root / 'tasks/003-sample/verification-runs/integration'
        directory.mkdir(parents=True, exist_ok=True)
        (directory / 'log.txt').write_text('local evidence\n')
        after = check.current_preview(self.root, before)
        self.assertEqual(check.preview_scope(before), check.preview_scope(after))

    def test_rejects_other_repository_and_unknown_schema(self):
        data = json.loads(self.run_ocr('delegate', 'preview', '--format', 'json').stdout)
        for field, value in (('repository', '/unrelated/repository'), ('schema_version', '999'), ('mode', 'invented')):
            with self.subTest(field=field), self.assertRaises(ValueError):
                check.current_preview(self.root, dict(data, **{field: value}))

    def test_does_not_allow_managed_mode_or_rule_override(self):
        for args in (('review',), ('scan',), ('delegate', 'preview', '--repo=/tmp'),
                     ('delegate', 'rule', '--rule=other.json', 'test_queue_sample.py')):
            with self.subTest(args=args):
                self.assertEqual(self.run_ocr(*args).returncode, 2)


if __name__ == '__main__':
    unittest.main()
