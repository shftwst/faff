"""Continue planned samples after only the recorded heading-spelling difference."""
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[3]
evidence = Path(__file__).resolve().parent
plan = json.loads(Path(sys.argv[1]).read_text())
for sample in plan['samples']:
    single = {**plan, 'samples': [sample]}
    path = evidence / (sample['name'] + '-plan.json')
    with path.open('x') as stream:
        json.dump(single, stream, indent=2)
        stream.write('\n')
    result = subprocess.run(['python3', str(evidence / 'run-workflow-samples.py'), str(path)], cwd=root)
    report = json.loads((evidence / 'workflow-runs' / sample['name'] / 'report.json').read_text())
    failed = [case for case in report['grade']['cases'] if not case['pass']]
    heading_only = failed and all(case['id'] == 'voice-source' and case['problems'] == ['rule-answer'] and case['value'] == {'file': 'AGENTS.md', 'heading': '# Writing style'} for case in failed)
    if result.returncode and not heading_only:
        raise SystemExit(result.returncode)
