#!/usr/bin/env python3
"""Local workflow records: structural validation, never proof of test execution."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

SCENARIOS = ('state-transition', 'idempotency', 'ordering', 'recovery', 'association', 'isolation')
CHECKS = ('backend', 'e2e', 'ui', 'architecture')
STATUSES = ('pass', 'fail', 'blocked', 'not-run', 'not-applicable')
SKILLS = ('test-master', 'open-code-review-delegate', 'meteor-flow-verification')


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args])


def repo_root():
    return Path(git(Path.cwd(), 'rev-parse', '--show-toplevel').decode().strip()).resolve()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def text(value):
    return isinstance(value, str) and bool(value.strip())


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def inside(base, relative):
    require(text(relative) and not Path(relative).is_absolute(), '必须使用相对路径')
    path = (base / relative).resolve()
    require(path.is_relative_to(base.resolve()), f'路径越界: {relative}')
    return path


def fingerprint(root):
    """Content/mode snapshot includes tracked and nonignored new files, not reports."""
    names = set(git(root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard').split(b'\0'))
    result = hashlib.sha256()
    for name in sorted(n for n in names if n):
        rel = Path(os.fsdecode(name))
        # Only this exact task-local evidence location is exempt from the baseline.
        if is_run_artifact(rel):
            continue
        path = root / rel
        if path.is_symlink():
            mode, data = b'link', os.fsencode(os.readlink(path))
        elif path.is_file():
            mode = b'executable' if path.stat().st_mode & 0o111 else b'file'
            data = path.read_bytes()
        elif not path.exists():
            mode, data = b'deleted', b''
        else:
            raise ValueError(f'不支持的基线文件类型: {rel}')
        result.update(name + b'\0' + mode + b'\0' + hashlib.sha256(data).digest())
    return result.hexdigest()


def is_run_artifact(relative):
    parts = Path(relative).parts
    return len(parts) >= 4 and parts[0] == 'tasks' and parts[2] == 'verification-runs'


def preview_scope(preview):
    """Reports evolve during review; only non-evidence changes form the review scope."""
    result = {key: preview.get(key) for key in ('schema_version', 'repository', 'mode', 'from', 'to', 'commit', 'merge_base')}
    for key in ('reviewable_files', 'excluded_files'):
        result[key] = [f for f in preview[key] if not is_run_artifact(f['path'])]
    return result


def doctor(root):
    lock = load(root / 'scripts/workflow/sources.lock.json')
    for source in lock['skills']:
        require(re.fullmatch('[0-9a-f]{40}', source['commit']), '来源必须固定提交')
        for relative, info in source['files'].items():
            path = inside(root, relative)
            require(path.is_file() and digest(path) == info['sha256'], f'来源文件缺失或未登记变更: {relative}')
    for name in SKILLS:
        source = root / '.agents/skills' / name
        link = root / '.claude/skills' / name
        require((source / 'SKILL.md').is_file(), f'缺少 skill: {name}')
        require(link.is_symlink() and link.resolve() == source.resolve(), f'Claude 链接错误: {name}')
        content = (source / 'SKILL.md').read_text()
        require(content.startswith('---\n') and f'name: {name}\n' in content, f'技能声明错误: {name}')
        for ref in re.findall(r'`(references/[^`\s]+\.md)`', content):
            require(inside(source, ref).is_file(), f'缺失引用: {name}/{ref}')
    require('@AGENTS.md' in (root / 'CLAUDE.md').read_text(), 'Claude 未导入公共规则')
    rule = load(root / '.opencodereview/rule.json')
    require(rule.get('include') and rule.get('rules'), '缺少 OCR 测试纳入或审查规则')
    return 'PASS: skills、双端链接、来源哈希与规则完整；宿主实际加载需要单独验证。'


def report_path(root, arg):
    path = Path(arg).resolve()
    require(path.is_relative_to(root), '报告必须位于仓库内')
    parts = path.relative_to(root).parts
    require(len(parts) == 5 and parts[0] == 'tasks' and parts[2] == 'verification-runs'
            and parts[4] == 'report.json', '报告路径必须为 tasks/NNN-topic/verification-runs/<run>/report.json')
    return path


def init(root, task, run):
    root = root.resolve()
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', run), '非法运行标识')
    task_path = inside(root, task)
    require(task_path.is_dir() and len(Path(task).parts) == 2 and Path(task).parts[0] == 'tasks', '任务目录不存在')
    dest = task_path / 'verification-runs' / run
    require(dest.resolve().is_relative_to(task_path), '运行目录符号链接越界')
    require(not dest.exists(), '运行已存在；使用新标识，禁止覆盖历史')
    data = {
        'schema_version': 1, 'task': task, 'run_id': run,
        'baseline': {'head': git(root, 'rev-parse', 'HEAD').decode().strip(), 'content_sha256': fingerprint(root)},
        'scope': {'kind': 'behavioral', 'requirements': [], 'summary': ''},
        'scenarios': {s: {'applicability': 'applicable', 'reason': '', 'cases': []} for s in SCENARIOS},
        'checks': {c: {'status': 'not-run', 'reason': '', 'evidence': []} for c in CHECKS},
        'commands': [], 'evidence': {},
        'review': {'status': 'not-run', 'author_context': '', 'reviewer_context': '',
                   'preview': '', 'files': [], 'exclusions': [], 'findings': [], 'evidence': []},
        'human_acceptance': {'status': 'pending', 'evidence': []},
    }
    dest.mkdir(parents=True)
    write(dest / 'report.json', data)
    return str((dest / 'report.json').relative_to(root))


def current_preview(root, preview):
    require(preview['schema_version'] == '1', '不支持的 OCR preview 版本')
    require(Path(preview['repository']).resolve() == root, 'OCR preview 来自其他仓库')
    mode = preview['mode']
    require(mode in ('workspace', 'range', 'commit'), '未知 OCR preview 模式')
    args = [sys.executable, str(root / 'scripts/workflow/ocr.py'), 'delegate', 'preview', '--format', 'json']
    if mode == 'range':
        require(text(preview.get('from')) and text(preview.get('to')), 'OCR 缺少比较范围')
        args += ['--from=' + preview['from'], '--to=' + preview['to']]
    elif mode == 'commit':
        require(text(preview.get('commit')), 'OCR 缺少提交')
        args += ['--commit=' + preview['commit']]
    result = subprocess.run(args, cwd=root, capture_output=True, text=True, timeout=60)
    require(result.returncode == 0, '无法核对当前 OCR 范围: ' + result.stderr.strip())
    return json.loads(result.stdout)


def validate(root, path):
    doctor(root)
    data = load(path)
    require(data['schema_version'] == 1, '不支持的报告版本')
    require(data['task'] == str(path.parents[2].relative_to(root)) and data['run_id'] == path.parent.name, '报告归属不一致')
    baseline = data['baseline']
    require(re.fullmatch('[0-9a-f]{40}', baseline['head']), '缺少基线提交')
    require(baseline['content_sha256'] == fingerprint(root), '代码或约束已改变：旧证据失效，请修订并重新验证')
    require(data['scope']['kind'] in ('behavioral', 'non-behavioral'), '未知变更类型')
    require(text(data['scope']['summary']) and data['scope']['requirements'], '缺少变更说明或需求映射')
    evidence = data['evidence']
    require(isinstance(evidence, dict), '证据必须是路径到哈希的映射')
    for relative, expected in evidence.items():
        file = inside(path.parent, relative)
        require(file != path and file.is_file() and file.stat().st_size > 0, f'无效证据: {relative}')
        require(digest(file) == expected, f'证据发生变化: {relative}')

    def refs(values):
        require(isinstance(values, list) and values and all(v in evidence for v in values), '缺少已登记证据')

    blocked = []

    def outcome(item, label):
        require(item['status'] in STATUSES, f'未知状态: {label}')
        if item['status'] in ('pass', 'fail'):
            refs(item['evidence'])
        if item['status'] != 'pass':
            require(text(item.get('reason')), f'{label} 必须说明原因')
        if item['status'] not in ('pass', 'not-applicable'):
            blocked.append(label + ': ' + item['status'])

    require(set(data['scenarios']) == set(SCENARIOS), '必须包含且仅包含六类场景')
    applicable = 0
    for name, group in data['scenarios'].items():
        require(group['applicability'] in ('applicable', 'not-applicable') and text(group['reason']), f'{name} 缺少适用性理由')
        cases = group['cases']
        require(isinstance(cases, list), f'{name} cases 必须为列表')
        if group['applicability'] == 'not-applicable':
            require(not cases, f'{name} 不适用不能同时登记执行用例')
            continue
        applicable += 1
        if not cases:
            blocked.append(name + ': 缺少用例')
        ids = []
        for case in cases:
            require(all(text(case[k]) for k in ('id', 'setup', 'action', 'expected')), f'{name} 用例不完整')
            require(isinstance(case['requirements'], list) and case['requirements'] and all(text(v) for v in case['requirements']), '用例缺少需求编号')
            require(case['status'] != 'not-applicable', '适用类中的用例不能静默跳过')
            if case['status'] in ('pass', 'fail'):
                require(text(case['actual']), '用例缺少实际观察')
            outcome(case, name + '/' + case['id'])
            ids.append(case['id'])
        require(len(set(ids)) == len(ids), f'{name} 用例编号重复')
    if data['scope']['kind'] == 'behavioral':
        require(applicable > 0, '行为变更不能将所有场景标为不适用')
    require(set(data['checks']) == set(CHECKS), '缺少后端/E2E/UI/架构检查')
    for name, item in data['checks'].items():
        outcome(item, name)
    commands = data['commands']
    require(isinstance(commands, list), 'commands 必须为列表')
    successful_evidence = set()
    for command in commands:
        require(text(command['command']), '缺少执行命令')
        outcome(command, command['command'])
        if command['status'] == 'pass':
            require(type(command['exit_code']) is int and command['exit_code'] == 0, '通过的命令退出码必须为 0')
            successful_evidence.update(command['evidence'])
        elif command['status'] == 'fail':
            require(type(command['exit_code']) is int and command['exit_code'] != 0, '失败命令须记录非零退出码')
    for name in ('backend', 'e2e'):
        item = data['checks'][name]
        if item['status'] == 'pass':
            require(set(item['evidence']) & successful_evidence, f'{name} 没有对应成功执行命令')
    review = data['review']
    require(review['status'] in ('pass', 'fail', 'blocked', 'not-run'), '未知 review 状态')
    if review['status'] != 'pass':
        blocked.append('独立审查未通过')
    else:
        require(text(review['author_context']) and text(review['reviewer_context'])
                and review['author_context'] != review['reviewer_context'], '审查必须使用独立上下文')
        refs(review['evidence'])
        refs([review['preview']])
        preview = load(inside(path.parent, review['preview']))
        fresh = current_preview(root, preview)
        require(preview_scope(preview) == preview_scope(fresh), 'OCR preview 与当前范围不符')
        preview = preview_scope(preview)
        # Read actual OCR JSON, never infer a file list from a claimed coverage percentage.
        selected = {(f['path'], f['status']) for f in preview['reviewable_files']}
        recorded = [(f['path'], f['status']) for f in review['files']]
        require(len(recorded) == len(set(recorded)) and set(recorded) == selected, '审查文件清单与 OCR preview 不一致')
        for file in review['files']:
            require(file['outcome'] in ('reviewed', 'skipped'), '未知文件审查结果')
            if file['outcome'] == 'skipped':
                require(text(file.get('reason')), '跳过文件缺少理由')
                blocked.append('审查跳过: ' + file['path'])
        excluded = {(f['path'], f['status'], f['exclude_reason']) for f in preview['excluded_files']}
        recorded_exclusions = [(f['path'], f['status'], f['reason']) for f in review['exclusions']]
        require(len(recorded_exclusions) == len(set(recorded_exclusions)) and set(recorded_exclusions) == excluded, '排除项未全部交代')
        for file in review['exclusions']:
            require(file['outcome'] in ('reviewed-manually', 'not-applicable', 'blocked') and text(file['rationale']), '排除项缺少处理结论')
            if file['status'] == 'deleted' or file['reason'] in ('deleted', 'too_large'):
                require(file['outcome'] in ('reviewed-manually', 'blocked'), '删除/超大文件必须补查影响')
            if file['outcome'] == 'blocked':
                blocked.append('排除项待处理: ' + file['path'])
    for finding in review['findings']:
        require(finding['severity'] in ('critical', 'high', 'medium', 'low') and text(finding['content']), '问题缺少级别/内容')
        require(finding['disposition'] in ('open', 'fixed', 'false-positive', 'deferred'), '未知问题处理结论')
        if finding['disposition'] in ('fixed', 'false-positive'):
            require(text(finding['rationale']), '关闭问题须有依据')
            refs(finding['evidence'])
        elif finding['severity'] in ('critical', 'high'):
            blocked.append('未关闭严重问题: ' + finding['content'])
        else:
            require(text(finding['rationale']), '遗留风险须说明')
    human = data['human_acceptance']
    require(human['status'] in ('pending', 'accepted', 'rejected'), '未知人工验收状态')
    if human['status'] != 'pending':
        refs(human['evidence'])
    if human['status'] == 'rejected':
        blocked.append('人工验收拒绝')
    return blocked


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('doctor')
    start = sub.add_parser('init')
    start.add_argument('task')
    start.add_argument('--run', required=True)
    check = sub.add_parser('check')
    check.add_argument('report')
    evidence = sub.add_parser('evidence')
    evidence.add_argument('report')
    evidence.add_argument('file')
    args = parser.parse_args()
    try:
        root = repo_root()
        if args.command == 'doctor':
            print(doctor(root))
        elif args.command == 'init':
            print(init(root, args.task, args.run))
        elif args.command == 'evidence':
            path = report_path(root, args.report)
            file = Path(args.file).resolve()
            require(file.is_relative_to(path.parent) and file != path and file.is_file() and file.stat().st_size > 0, '证据必须为运行目录内的非空文件，不能是报告本身')
            data = load(path)
            data['evidence'][str(file.relative_to(path.parent))] = digest(file)
            write(path, data)
            print('证据已登记；内容真实性仍需独立审查。')
        else:
            reasons = validate(root, report_path(root, args.report))
            if reasons:
                print('BLOCKED:\n' + '\n'.join('- ' + reason for reason in reasons))
                return 1
            print('READY_FOR_HUMAN_ACCEPTANCE: 记录检查通过；不证明测试充分或代表人工验收。')
        return 0
    except (ValueError, KeyError, TypeError, AttributeError, OSError, subprocess.SubprocessError) as error:
        print(f'INVALID: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
