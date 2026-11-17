"""Capture repeated interactive Claude decision probes; never execute workflow effects."""
from pathlib import Path
import hashlib
import json
import subprocess
import time

root = Path(__file__).resolve().parents[3]
evidence = Path(__file__).resolve().parent
worker = 'claude-retry'
fixture = evidence / 'fixtures/gateway-input.json'
oracle = evidence / 'fixtures/gateway-oracle.json'

def tool(args, timeout=330):
    completed = subprocess.run(['box-worker', *args], capture_output=True, text=True, timeout=timeout)
    return {'exit_code': completed.returncode, 'stdout': completed.stdout, 'stderr': completed.stderr}

def write(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')

# The first baseline and v1 candidate are already recorded. Repeats use the final
# v2 heading-compatible candidate; alternating order is declared before these runs.
schedule = [('candidate', 1)]
for n in range(2, 6):
    schedule.extend([(arm, n) for arm in (['baseline', 'candidate'] if n % 2 == 0 else ['candidate', 'baseline'])])
for arm, n in schedule:
    run = evidence / 'runs' / (f'gateway-baseline-{n}' if arm == 'baseline' else f'gateway-candidate-v2-{n}')
    if (run / 'grade.json').exists():
        continue
    run.mkdir()
    source = evidence / ('baseline/gateway.md' if arm == 'baseline' else 'candidates/gateway-v2.md')
    prompt = f'''This is a bounded skill-fidelity measurement, not an implementation or review task. Read exactly these two files: policy {source}; task fixtures {fixture}. Apply that policy to every independent case using the fixture's output schema. Do not execute any proposed workflow action, invoke skills, read other files, inspect oracle files, or modify source. Write your raw JSON answer to {run}/response.json with the file-writing tool, then stop. Do not add explanations.'''
    (run / 'prompt.txt').write_text(prompt + '\n')
    policy = source.read_bytes()
    chars = len(policy.decode().encode('utf-16-le')) // 2
    write(run / 'manifest.json', {
        'schema': 1, 'kind': 'decision-smoke', 'skill': 'faff', 'arm': arm,
        'model': 'claude-opus-5-5', 'effort': 'medium', 'context_reset_requested': True,
        'source_commit': 'a8509086ad28fa0e55cf3d1d818f2055294e663b',
        'input_sha256': hashlib.sha256(fixture.read_bytes()).hexdigest(),
        'policy_sha256': hashlib.sha256(policy).hexdigest(), 'policy_bytes': len(policy),
        'estimated_policy_tokens': (chars + 3) // 4,
        'prompt_sha256': hashlib.sha256((prompt + '\n').encode()).hexdigest(),
        'limitations': ['interactive worker decisions, not workflow effects', 'provider usage unmetered', 'cases within a response are correlated'],
    })
    write(run / 'clear.json', tool(['ask', worker, '/clear', '--timeout', '1000'], 20))
    write(run / 'after-clear-screen.json', tool(['read', worker, '--lines', '35'], 20))
    started = time.time()
    result = tool(['ask', worker, prompt, '--timeout', '1000'], 20)
    response = run / 'response.json'
    while time.time() - started < 300:
        state = tool(['poll', worker], 20)
        parsed = json.loads(state['stdout'])
        status = parsed.get('status', {}).get('agent', {}).get('agent_status')
        if response.exists() and status in ('done', 'idle'):
            result['completion'] = parsed
            break
        time.sleep(2)
    result['elapsed_seconds'] = time.time() - started
    write(run / 'worker-result.json', result)
    write(run / 'final-screen.json', tool(['read', worker, '--lines', '60'], 20))
    if not response.exists():
        print(json.dumps({'run': run.name, 'status': 'missing-response'}), flush=True)
        raise SystemExit(2)
    graded = subprocess.run(['node', str(root / 'eval/skill-diet.mjs'), 'grade-gateway', str(response), str(oracle), str(run / 'grade.json')], cwd=root)
    grade = json.loads((run / 'grade.json').read_text())
    print(json.dumps({'run': run.name, 'status': grade['status'], 'passed': grade['passed'], 'total': grade['total']}), flush=True)
    if arm == 'candidate' and graded.returncode:
        raise SystemExit(1)
