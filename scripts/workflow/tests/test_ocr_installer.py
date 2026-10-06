"""Failure-window tests for the local tool installer."""
import contextlib
import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location('workflow_ocr_installer', Path(__file__).resolve().parents[1] / 'ocr.py')
ocr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ocr)


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.binary = self.directory / 'ocr-test'
        self.contents = b'verified binary fixture'
        self.lock = {'version': 'fixture', 'assets': {'ocr-test': hashlib.sha256(self.contents).hexdigest()}}
        self.info = patch.object(ocr, 'binary_info', return_value=(self.lock, 'ocr-test', self.binary))
        self.info.start()
        self.addCleanup(self.info.stop)

    def install(self):
        with patch.object(ocr.sys, 'argv', ['ocr.py', 'install']), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return ocr.main()

    def test_verified_install_is_idempotent_and_offline(self):
        self.binary.write_bytes(self.contents)
        with patch.object(ocr.urllib.request, 'urlopen', side_effect=AssertionError('unexpected network')):
            self.assertEqual(self.install(), 0)
            self.assertEqual(self.install(), 0)
        self.assertEqual(self.binary.read_bytes(), self.contents)

    def test_interrupted_download_preserves_existing_file_and_cleans_partial(self):
        self.binary.write_bytes(b'previous unverified binary')
        with patch.object(ocr.urllib.request, 'urlopen', side_effect=urllib.error.URLError('interrupted')):
            self.assertEqual(self.install(), 2)
        self.assertEqual(self.binary.read_bytes(), b'previous unverified binary')
        self.assertEqual(list(self.directory.iterdir()), [self.binary])

    def test_hash_mismatch_does_not_install(self):
        with patch.object(ocr.urllib.request, 'urlopen', return_value=io.BytesIO(b'bad download')):
            self.assertEqual(self.install(), 2)
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_success_after_failed_attempt(self):
        with patch.object(ocr.urllib.request, 'urlopen', side_effect=urllib.error.URLError('offline')):
            self.assertEqual(self.install(), 2)
        with patch.object(ocr.urllib.request, 'urlopen', return_value=io.BytesIO(self.contents)):
            self.assertEqual(self.install(), 0)
        self.assertEqual(self.binary.read_bytes(), self.contents)


if __name__ == '__main__':
    unittest.main()
