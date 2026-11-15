from pathlib import Path
import hashlib
import json
import sys

root = Path(__file__).resolve().parent
seal = json.loads((root / 'SEAL.json').read_text())
expected = {row['path']: row for row in seal['files']}
actual = {str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and p.name != 'SEAL.json'}
errors = []
for name in sorted(actual - expected.keys()):
    errors.append(f'unlisted file: {name}')
for name, row in expected.items():
    p = root / name
    if not p.is_file():
        errors.append(f'missing file: {name}')
        continue
    b = p.read_bytes()
    if len(b) != row['bytes'] or hashlib.sha256(b).hexdigest() != row['sha256']:
        errors.append(f'changed file: {name}')
print(json.dumps({'source_commit': seal['source_commit'], 'files': len(expected), 'errors': errors}, indent=2))
sys.exit(bool(errors))
