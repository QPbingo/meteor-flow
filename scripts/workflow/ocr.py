#!/usr/bin/env python3
"""Pinned, checksum-verified OCR delegate runner. No global installation or LLM config."""
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]


def binary_info():
    lock = json.loads((ROOT / 'scripts/workflow/sources.lock.json').read_text())['ocr_cli']
    system = {'Darwin': 'darwin', 'Linux': 'linux', 'Windows': 'windows'}.get(platform.system())
    arch = {'arm64': 'arm64', 'aarch64': 'arm64', 'x86_64': 'amd64', 'AMD64': 'amd64'}.get(platform.machine())
    if not system or not arch:
        raise ValueError('不支持此平台；禁止自动改用未固定的系统 OCR')
    name = f'opencodereview-{system}-{arch}' + ('.exe' if system == 'windows' else '')
    return lock, name, ROOT / '.tools/ocr' / lock['version'] / name


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    args = sys.argv[1:]
    try:
        lock, name, binary = binary_info()
        expected = lock['assets'][name]
        if args == ['install']:
            binary.parent.mkdir(parents=True, exist_ok=True)
            if binary.exists() and sha(binary) == expected:
                print(f'已安装 {lock["version"]}: {binary}')
                return 0
            url = f'https://github.com/alibaba/open-code-review/releases/download/{lock["version"]}/{name}'
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(dir=binary.parent, delete=False) as out:
                    temporary = Path(out.name)
                    with urllib.request.urlopen(url, timeout=60) as response:
                        while chunk := response.read(1024 * 1024):
                            out.write(chunk)
                if sha(temporary) != expected:
                    raise ValueError('下载文件 SHA-256 不匹配，未安装')
                temporary.chmod(0o755)
                os.replace(temporary, binary)
            finally:
                if temporary and temporary.exists():
                    temporary.unlink()
            print(f'已安装并校验 {lock["version"]}: {binary}')
            return 0
        if args != ['--version'] and not (len(args) >= 2 and args[:2] in (['delegate', 'preview'], ['delegate', 'rule'])):
            raise ValueError('仅支持 install、--version、delegate preview、delegate rule；不启用托管 review/scan')
        if not binary.is_file() or sha(binary) != expected:
            raise ValueError('OCR 缺失或校验失败；先执行 python3 scripts/workflow/ocr.py install')
        if args != ['--version']:
            if any(a.split('=')[0] in ('--repo', '--rule') for a in args):
                raise ValueError('仓库与规则由项目入口固定，不能用参数替换')
            args += ['--repo', str(ROOT), '--rule', str(ROOT / '.opencodereview/rule.json')]
        return subprocess.call([str(binary), *args], cwd=ROOT)
    except (OSError, ValueError, KeyError) as error:
        print(f'OCR BLOCKED: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
