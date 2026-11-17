"""Retain raw scores and continue only after the hash-bound label assessment passes."""
import json
from pathlib import Path
import subprocess
import sys
root = Path(__file__).resolve().parents[3]
evidence = Path(__file__).resolve().parent
plan = json.loads(Path(sys.argv[1]).read_text())
for sample in plan['samples']:
    path = evidence / (sample['name'] + '-queue-plan.json')
    with path.open('x') as stream:
        json.dump({**plan, 'samples': [sample]}, stream, indent=2)
        stream.write('\n')
    result = subprocess.run(['python3', str(evidence / 'run-literal-workflow-samples.py'), str(path)], cwd=root)
    subprocess.run(['node', str(evidence / 'assess-wtf-format.mjs'), str(path)], cwd=root, check=True)
    assessment = json.loads((evidence / 'workflow-runs' / sample['name'] / 'assessment.json').read_text())
    if assessment['status'] != 'pass':
        raise SystemExit('WTF sample failed beyond the permitted label separator equivalence')
