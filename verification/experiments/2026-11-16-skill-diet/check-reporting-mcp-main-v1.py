"""Check the committed measured reporting source before acceptance accounting."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import json
import subprocess

EVIDENCE = Path(__file__).resolve().parent
ROOT = EVIDENCE.parents[2]
SOURCE = ROOT / 'plugin/skills/faff-beep-boop/SKILL.md'


def digest(value):
    return hashlib.sha256(value).hexdigest()


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


source_commit = git('rev-parse', 'HEAD').decode().strip()
expected = json.loads((EVIDENCE / 'beep-reporting-v1-source-review.json').read_text())['candidate_sha256']
assert digest(SOURCE.read_bytes()) == expected
assert digest(git('show', source_commit + ':plugin/skills/faff-beep-boop/SKILL.md')) == expected
assert not git('status', '--porcelain', '--', 'plugin').strip()
tests = ['control-parity-reporting', 'run-summary', 'rendering-routing', 'control-parity-mcp-bridge', 'control-parity-mcp-native', 'control-parity-reporting-drafts', 'control-parity-reporting-provenance']
commands = [
    ('tests', ['node', '--test', '--test-concurrency=4', *['test/' + name + '.test.mjs' for name in tests]]),
    ('adapter-lint', ['node', 'plugin/skills/faff/bin/faff', 'validate-adapters']),
    ('rule-inventory', ['node', 'plugin/skills/faff/bin/faff', 'rule-inventory', 'check', '--base', 'a8509086ad28fa0e55cf3d1d818f2055294e663b', '--json']),
]


def check(item):
    name, command = item
    path = 'deterministic-checks/beep-reporting-mcp-v1-main-' + name + '.txt'
    with (EVIDENCE / path).open('x') as log:
        result = subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
    return {'check': name, 'command': command, 'exit_code': result.returncode, 'path': path, 'sha256': digest((EVIDENCE / path).read_bytes())}


with ThreadPoolExecutor(max_workers=3) as pool:
    checks = list(pool.map(check, commands))
assert git('rev-parse', 'HEAD').decode().strip() == source_commit
assert digest(SOURCE.read_bytes()) == expected
assert not git('status', '--porcelain', '--', 'plugin').strip()
record = {'schema': 1, 'status': 'pass' if all(row['exit_code'] == 0 for row in checks) else 'fail', 'source_commit': source_commit, 'source_sha256': expected, 'checker_sha256': digest(Path(__file__).read_bytes()), 'checks': checks}
with (EVIDENCE / 'beep-reporting-mcp-v1-main-integration.json').open('x') as target:
    json.dump(record, target, indent=2)
    target.write('\n')
print(json.dumps(record))
raise SystemExit(0 if record['status'] == 'pass' else 1)
