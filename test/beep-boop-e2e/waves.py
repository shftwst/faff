"""Run one installed full-pipeline invocation per disposable project."""
import argparse
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

from delivery_fixture import prepare, script, git
from response_timeline import Timeline
import hashlib

HERE = Path(__file__).resolve().parent
PROMPT = "/faff:faff-beep-boop"
CONFIG = """tracking:
  tracker: linear
  team_key: KIT
  repo: fixture/timer-kit
  git_host: github
appetite: high
bundle_store: local
"""

def save(path, data):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(data, indent=2) + '\n')
    temp.replace(path)

def digest(path):
    h = hashlib.sha256()
    for file in sorted(path.rglob("*")):
        if file.is_file():
            h.update(str(file.relative_to(path)).encode()+b"\0"+hashlib.sha256(file.read_bytes()).digest())
    return h.hexdigest()

def command(args, cwd, env):
    p = subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True, timeout=120)
    if p.returncode:
        raise RuntimeError("Plugin administration failed: " + (p.stderr or p.stdout)[-500:])
    return json.loads(p.stdout)

def fixture(snapshot, dest, mode="sequential"):
    import wave_tracker
    env = prepare(snapshot, dest)
    repo = dest/'repo'
    config = repo/'.faff/config.yaml'
    config.parent.mkdir()
    config.write_text(CONFIG + ("slots:\n  concurrency: faffter-dark-concurrency-parallel\nconcurrency_max: 3\n" if mode == "parallel" else ""))
    (repo/'.gitignore').write_text((repo/'.gitignore').read_text()+'!.faff/config.yaml\n')
    with (repo/'retry.js').open('a') as src:
        src.write("\n// Batch retry normalization must clamp each negative integer, just like the scalar API.\nexport function normalizeRetryBatch(counts) {\n  return counts.slice();\n}\n")
    (repo/'README.md').write_text('# Timer Kit\n\nSmall JavaScript library for retry counters. Run the tests with npm test. The tracker and Git forge are local qualification services. Automation may merge eligible passing changes. All retry APIs belong to the Timer Kit retry-normalization workstream. Published scalar and bulk APIs are versioned separately.\n')
    # Surface the discrepancy at implementation time. The smoke diagnostic is informational.
    # It reads real API output and disappears when the batch implementation is fixed.
    (repo/'retry-parity.test.js').write_text("""import test from 'node:test';
import { normalizeRetries, normalizeRetryBatch } from './retry.js';

test('retry normalization compatibility diagnostic', (t) => {
  const inputs = [-3, 0, 2];
  const scalar = inputs.map(normalizeRetries);
  const bulk = normalizeRetryBatch(inputs);
  if (JSON.stringify(scalar) !== JSON.stringify(bulk)) {
    t.diagnostic('Timer Kit compatibility: bulk normalization returned ' + JSON.stringify(bulk)
      + ' for ' + JSON.stringify(inputs) + ', expected ' + JSON.stringify(scalar)
      + '. The separately shipped batch API still accepts negative retry counts.');
  }
});
""")
    if mode == "parallel":
        for filename, code in {
            'duration':'export function toMilliseconds(seconds) { return seconds; }',
            'cache-key':'export function cacheKey(text) { return text; }',
            'timer-label':'export function timerLabel(id) { return String(id); }',
        }.items():
            (repo/(filename+'.js')).write_text(code+'\n')
    hook = dest/'origin.git/hooks/update'
    guard = hook.read_bytes()
    hook.unlink()
    try:
        seed_env = dict(os.environ, **env, GIT_AUTHOR_DATE='2026-11-24T00:00:00Z', GIT_COMMITTER_DATE='2026-11-24T00:00:00Z')
        git(repo,'add','.',env=seed_env)
        git(repo,'commit','-qm','Seed tracker-mode project',env=seed_env)
        git(repo,'push','origin','main',env=seed_env)
    finally:
        hook.write_bytes(guard)
        hook.chmod(0o755)
    save(dest/'identity.json',{'seed':git(repo,'rev-parse','HEAD')})
    wave_tracker.init(dest/'tracker.json', mode)
    save(dest/'mcp.json',{'mcpServers':{'qualification-tracker':{'command':sys.executable,'args':[str(HERE/'wave_tracker.py'),'--state',str(dest/'tracker.json')]}}})
    script(dest/'bin/gh','exec '+shlex.join([sys.executable,str(HERE/'wave_forge.py')])+' "$@"')
    return env

def arm(snapshot,dest,model,mode):
    dest.mkdir(parents=True,exist_ok=False,mode=0o700)
    env = fixture(snapshot,dest,mode)
    receipt={'prompts':[], 'installed':False,'terminal':False,'returncode':None,'model':model,
             'mode':mode,'revision':git(snapshot,'rev-parse','HEAD')}
    save(dest/'invocation.json',receipt)
    try:
        with tempfile.TemporaryDirectory(prefix='faff-wave-') as t:
            home=Path(t)/'home'
            home.mkdir()
            env.update({k:v for k,v in os.environ.items() if k in ('LANG','LC_ALL','TERM','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','CLAUDE_CODE_OAUTH_TOKEN')})
            env.update(HOME=str(home),CLAUDE_CONFIG_DIR=str(Path(t)/'claude'))
            repo=dest/'repo'
            command(['claude','plugin','install','faff','--marketplace',str(snapshot),'--scope','user','--json'],repo,env)
            plugins=command(['claude','plugin','list','--json'],repo,env)
            installed=Path(next(p['installPath'] for p in plugins if p['id']=='faff@faff' and p['enabled']))
            if digest(installed)!=digest(snapshot/'plugin'):
                raise ValueError('installed content mismatch')
            env['PATH']=str(installed/'skills/faff/bin')+os.pathsep+env['PATH']
            receipt.update(installed=True,prompts=[PROMPT])
            save(dest/'invocation.json',receipt)
            args=['claude','-p','--model',model,'--output-format','stream-json','--verbose','--permission-mode','acceptEdits',
                  '--allowedTools','Read,Write,Edit,Glob,Grep,Bash,Agent,Skill,TaskCreate,TaskUpdate,TaskList,TaskGet,mcp__qualification-tracker__*',
                  '--strict-mcp-config','--mcp-config',str(dest/'mcp.json'),'--setting-sources','user','--no-session-persistence']
            raw=Path(t)/'stream.jsonl'
            with raw.open('w') as stdout, tempfile.TemporaryFile() as err, Timeline(raw, dest/'responses.jsonl'):
                try:
                    p=subprocess.run(args,input=PROMPT,text=True,cwd=repo,env=env,stdout=stdout,stderr=err,timeout=7200)
                    receipt['returncode']=p.returncode
                finally:
                    events=[]
                    terminal={}
                    for line in raw.open():
                        try: e=json.loads(line)
                        except ValueError: continue
                        if e.get('type')=='result': terminal=e
                        if e.get('type')=='assistant':
                            for b in e.get('message',{}).get('content',[]):
                                if b.get('type')=='tool_use':
                                    args=b.get('input',{})
                                    events.append({'tool':b['name'],'parent_tool_use_id':e.get('parent_tool_use_id'),
                                        'input':{k:args[k] for k in ('skill','description','command') if k in args}})
                    session={'tools':events,'result':terminal.get('result','')[-4000:],'usage':terminal.get('usage'),'turns':terminal.get('num_turns')}
                    value=json.dumps(session)
                    token=env.get('CLAUDE_CODE_OAUTH_TOKEN')
                    if token: value=value.replace(token,'[redacted]')
                    save(dest/'session.json',json.loads(value))
                    receipt['terminal']=terminal.get('subtype')=='success' and not terminal.get('is_error')
    except Exception as exc:
        receipt['error']=str(exc)[:600]
    finally:
        save(dest/'invocation.json',receipt)
    from wave_score import score
    result=score(dest, mode)
    save(dest/'score.json',result)
    from wave_outcome import outcome
    policy=outcome(dest,result,mode)
    save(dest/'workflow.json',policy)
    return 0 if policy['pass'] else 1

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["sequential", "parallel"])
    parser.add_argument("--snapshot", type=Path, default=HERE.parents[1])
    parser.add_argument("--ref", default="HEAD", help="commit or release tag from the snapshot repository")
    parser.add_argument("--output", type=Path, help="new directory for this run")
    parser.add_argument("--model", default="claude-opus-5-5")
    args=parser.parse_args()
    output=args.output or HERE/"runs"/(args.mode+"-"+datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
    print("Run artifacts:", output.resolve(), flush=True)
    revision = git(args.snapshot, "rev-parse", "--verify", "--end-of-options", args.ref+"^{commit}")
    with tempfile.TemporaryDirectory(prefix="wave-snapshot-") as temp:
        snapshot = Path(temp)/"source"
        subprocess.run(["git","clone","--quiet","--no-checkout","--no-hardlinks","--",
                        str(args.snapshot.resolve()),str(snapshot)],check=True)
        git(snapshot,"checkout","--quiet","--detach",revision)
        sys.exit(arm(snapshot,output.resolve(),args.model,args.mode))
