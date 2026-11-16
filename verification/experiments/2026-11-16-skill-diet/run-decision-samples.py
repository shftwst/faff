"""Record bounded decision probes in the authenticated Claude worker."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[3]
evidence = Path(__file__).resolve().parent
plan = json.loads(Path(sys.argv[1]).read_text())
worker = plan.get('worker', 'claude-retry')
fixture = evidence / plan['fixture']
oracle = evidence / plan['oracle']

def tool(args):
    completed = subprocess.run(['box-worker', *args], capture_output=True, text=True, timeout=25)
    return {'exit_code': completed.returncode, 'stdout': completed.stdout, 'stderr': completed.stderr}

def write(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')

for sample in plan['samples']:
    run = evidence / 'runs' / sample['name']
    if run.exists():
        raise SystemExit(f'refusing to overwrite existing run {run}')
    source = evidence / sample['policy'] if sample.get('policy') else None
    policy = source.read_bytes() if source else b''
    run.mkdir()
    policy_instruction = f'Read the policy at {source} and the fixtures at {fixture}.' if source else f'No policy is supplied for this control. Read only the fixtures at {fixture}; answer using your existing knowledge.'
    prompt = f'''This is a bounded skill-fidelity measurement, not an implementation or review task. {policy_instruction} Apply the policy, when supplied, to every independent case using the fixture's output schema. Do not execute any proposed workflow action, invoke skills, inspect oracle files, read other files or modify source. Write your raw JSON answer to {run}/response.json with the file-writing tool, then stop. Do not add explanations.'''
    (run / 'prompt.txt').write_text(prompt + '\n')
    chars = len(policy.decode().encode('utf-16-le')) // 2
    write(run / 'manifest.json', {
        'schema': 1, 'kind': 'decision-smoke', 'skill': plan['skill'], 'arm': sample['arm'],
        'model': 'claude-opus-5-5', 'effort': 'medium', 'context_reset_requested': True,
        'source_baseline_commit': 'a8509086ad28fa0e55cf3d1d818f2055294e663b',
        'input_sha256': hashlib.sha256(fixture.read_bytes()).hexdigest(),
        'policy_sha256': hashlib.sha256(policy).hexdigest(), 'policy_bytes': len(policy),
        'estimated_policy_tokens': (chars + 3) // 4,
        'prompt_sha256': hashlib.sha256((prompt + '\n').encode()).hexdigest(),
        'limitations': ['interactive worker decisions, not workflow effects', 'provider usage unmetered', 'cases within a response are correlated'],
    })
    write(run / 'clear.json', tool(['ask', worker, '/clear', '--timeout', '1000']))
    write(run / 'after-clear-screen.json', tool(['read', worker, '--lines', '35']))
    started = time.time()
    result = tool(['ask', worker, prompt, '--timeout', '1000'])
    response = run / 'response.json'
    while time.time() - started < 300:
        state = tool(['poll', worker])
        parsed = json.loads(state['stdout'])
        status = parsed.get('status', {}).get('agent', {}).get('agent_status')
        if response.exists() and status in ('done', 'idle'):
            result['completion'] = parsed
            break
        time.sleep(2)
    result['elapsed_seconds'] = time.time() - started
    write(run / 'worker-result.json', result)
    write(run / 'final-screen.json', tool(['read', worker, '--lines', '60']))
    if not response.exists():
        print(json.dumps({'run': run.name, 'status': 'missing-response'}), flush=True)
        raise SystemExit(2)
    graded = subprocess.run(['node', str(root / 'eval/skill-diet.mjs'), 'grade-decisions', str(response), str(oracle), str(run / 'grade.json')], cwd=root)
    grade = json.loads((run / 'grade.json').read_text())
    print(json.dumps({'run': run.name, 'status': grade['status'], 'passed': grade['passed'], 'total': grade['total']}), flush=True)
    if sample['arm'] == 'candidate' and graded.returncode:
        raise SystemExit(1)
