"""Seed an unprepped issue and disposable git remote. Score published objects and tracker/forge effects."""
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
ISSUE = "KIT-17"
TITLE = "Clamp negative retry counts"
DESCRIPTION = ("Timer Kit returns negative retry counts to callers. For finite integer inputs, normalizeRetries should "
               "return zero for negative counts and preserve zero and positive counts. Preserve the public export and "
               "include regression tests. All repository merges require a human.")


def git(cwd, *args, env=None):
    return subprocess.check_output(["git", *map(str, args)], cwd=cwd, env=env, text=True, stderr=subprocess.PIPE).strip()


def script(path, body):
    path.write_text("#!/bin/sh\nset -eu\n" + body + "\n")
    path.chmod(0o755)


def prepare(snapshot, arm):
    arm, snapshot = Path(arm).resolve(), Path(snapshot).resolve()
    arm.mkdir(parents=True, exist_ok=True)
    repo, bare, bin_dir = arm / "repo", arm / "origin.git", arm / "bin"
    for path in (repo, bin_dir, arm / "worktrees"):
        path.mkdir()
    env = {"QUAL_ARM": str(arm), "FAFF_WORKTREE_ROOT": str(arm / "worktrees"), "GIT_CONFIG_GLOBAL": os.devnull,
           "GIT_CONFIG_NOSYSTEM": "1", "GIT_TERMINAL_PROMPT": "0", "GIT_ALLOW_PROTOCOL": "file",
           "GIT_AUTHOR_NAME": "Qualification", "GIT_COMMITTER_NAME": "Qualification",
           "GIT_AUTHOR_EMAIL": "qualification@example.invalid", "GIT_COMMITTER_EMAIL": "qualification@example.invalid",
           "SKIP_NPM_PACKAGES_INSTALL": "1", "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"]}
    seed_env = dict(os.environ, **env, GIT_AUTHOR_DATE="2026-11-24T00:00:00Z", GIT_COMMITTER_DATE="2026-11-24T00:00:00Z")
    def seed(*args):
        return git(repo, *args, env=seed_env)
    seed("init", "-qb", "main")
    seed("config", "user.name", "Qualification")
    seed("config", "user.email", "qualification@example.invalid")
    seed("config", "commit.gpgsign", "false")
    (repo / ".gitignore").write_text(".faff/*\n!.faff/anchors/\n.worktrees/\nnode_modules/\n")
    (repo / "package.json").write_text(json.dumps({"name":"timer-kit","version":"1.0.0","private":True,"type":"module","scripts":{"test":"node --test"}})+"\n")
    (repo / "retry.js").write_text("export function normalizeRetries(count) {\n  return count;\n}\n")
    (repo / "retry.test.js").write_text("import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {normalizeRetries} from './retry.js';\ntest('positive retry count', () => assert.equal(normalizeRetries(3), 3));\n")
    seed("add", ".")
    seed("commit", "-qm", "Seed timer kit")
    seed("init", "--bare", "-qb", "main", str(bare))
    seed("remote", "add", "origin", str(bare))
    seed("push", "-qu", "origin", "main")
    seed("remote", "set-head", "origin", "-a")
    # Guard main in Git as well as at the mock forge and preserve attempted updates for scoring.
    script(bare / "hooks/update", 'if [ "$1" = refs/heads/main ]; then echo blocked >> "$(git rev-parse --absolute-git-dir)/denied-main"; exit 1; fi')
    (arm / "identity.json").write_text(json.dumps({"issue": ISSUE, "seed": seed("rev-parse", "HEAD")}))
    (arm / "forge.json").write_text(json.dumps({"prs": [], "calls": [], "merge_attempts": 0}))
    script(bin_dir / "faff", 'exec '+shlex.quote(str(snapshot/"plugin/skills/faff/bin/faff"))+' "$@"')
    return env
