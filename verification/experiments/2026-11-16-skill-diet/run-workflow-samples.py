"""Run paired interactive workflow fixtures; preserve every operation and failure."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[3]
evidence = Path(__file__).resolve().parent
plan = json.loads(Path(sys.argv[1]).read_text())
bridge = root / 'eval/control-parity/interactive-handoff.mjs'

def write(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')

def worker(args):
    try:
        result = subprocess.run(['box-worker', *args], capture_output=True, text=True, timeout=25)
        return {'exit_code': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr}
    except subprocess.TimeoutExpired as error:
        return {'exit_code': None, 'stdout': str(error.stdout or ''), 'stderr': 'broker client timed out; worker completion is checked separately'}

for sample in plan['samples']:
    out = evidence / 'workflow-runs' / sample['name']
    if out.exists():
        raise SystemExit(f'refusing to overwrite {out}')
    command = ['node', str(root / plan['harness']), plan['runtime_root'], plan['runtime_commit'], str(evidence / sample['policy']), str(evidence / plan['fixture']), str(out)]
    log_path = evidence / 'workflow-runs' / (sample['name'] + '.server.log')
    with log_path.open('x') as log:
        server = subprocess.Popen(command, cwd=root, stdout=log, stderr=subprocess.STDOUT)
        started = time.time()
        while not (out / 'ready.json').exists() and time.time() - started < 30 and server.poll() is None:
            time.sleep(0.1)
        if not (out / 'ready.json').exists():
            raise SystemExit(f'server did not become ready: {sample["name"]}')
        prompt = f'''Execute the isolated workflow fixture task at {out}/task.json. Read that file only; it contains the policy, independent cases, already-resolved executable and tool schemas. Perform the actual fixture operations, rather than answering with a plan or proposed actions. Use Bash only for individual calls through this bridge: node {bridge} call {out} TOOL_NAME JSON_ARGUMENT_OBJECT. The JSON object is one quoted command argument. Use the supplied fixture ports in place of native CLI, human-question and Skill tools. Do not read server code, tracker state, oracle files or other files. Do not edit files, invoke other tools/skills, or execute any workflow outside the fixture ports. Finish only after all cases have reached the boundary specified in the task. Stop after successful finish.'''
        (out / 'worker-prompt.txt').write_text(prompt + '\n')
        write(out / 'worker-manifest.json', {'arm': sample['arm'], 'requested_model': 'claude-opus-5-5', 'effort': 'medium', 'claude_cli': '2.1.325', 'worker': plan.get('worker', 'claude-retry'), 'prompt_sha256': hashlib.sha256((prompt + '\n').encode()).hexdigest(), 'harness_command': command, 'context_reset_requested': True, 'provider_usage': 'unmetered'})
        name = plan.get('worker', 'claude-retry')
        write(out / 'worker-clear.json', worker(['ask', name, '/clear', '--timeout', '1000']))
        write(out / 'worker-after-clear.json', worker(['read', name, '--lines', '25']))
        write(out / 'worker-submission.json', worker(['ask', name, prompt, '--timeout', '1000']))
        while time.time() - started < 510:
            state = worker(['poll', name])
            parsed = json.loads(state['stdout'])
            status = parsed.get('status', {}).get('agent', {}).get('agent_status')
            if (out / 'report.json').exists() and status in ('done', 'idle'):
                break
            if server.poll() is not None and not (out / 'report.json').exists():
                break
            time.sleep(2)
        write(out / 'worker-final-screen.json', worker(['read', name, '--lines', '500']))
        write(out / 'worker-final-state.json', state)
        code = server.wait(timeout=10)
        if not (out / 'report.json').exists():
            raise SystemExit(f'missing report: {sample["name"]}, server exit {code}')
        report = json.loads((out / 'report.json').read_text())
        print(json.dumps({'run': sample['name'], 'status': report['status'], 'cases': [{'id': c['id'], 'pass': c['pass'], 'problems': c['problems']} for c in report['grade']['cases']], 'elapsed_seconds': round(time.time() - started, 1)}), flush=True)
        if code or report['status'] != 'pass':
            raise SystemExit(1)
