import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from delivery_fixture import prepare


class LocalMerge(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.arm = Path(temp.name)
        self.repo = self.arm / "repo"
        env = prepare(Path(__file__).resolve().parents[2], self.arm)
        self.env = {**os.environ, **env, "GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "commit.gpgsign", "GIT_CONFIG_VALUE_0": "false"}
        self.seed = self.git("rev-parse", "HEAD")

    def run_cmd(self, command):
        return subprocess.run(command, cwd=self.repo, env=self.env, capture_output=True, text=True, timeout=30)

    def git(self, *args):
        p = self.run_cmd(["git", *args])
        self.assertEqual(p.returncode, 0, p.stderr)
        return p.stdout.strip()

    def gh(self, *args, success=True):
        p = self.run_cmd([sys.executable, str(Path(__file__).resolve().with_name("wave_forge.py")), *args])
        self.assertEqual(p.returncode == 0, success, (args, p.stderr, p.stdout))
        return p.stdout.strip()

    def publish(self, branch, contents):
        self.git("fetch", "-q", "origin")
        self.git("checkout", "-qb", branch, "origin/main")
        (self.repo / f"{branch}.js").write_text(contents)
        self.git("add", ".")
        self.git("commit", "-qm", branch)
        self.git("push", "-qu", "origin", branch)
        self.gh("pr", "create", "--head", branch, "--base", "main", "--title", branch)
        return self.git("rev-parse", "HEAD")

    def test_stale_head_failed_and_multiple_landings(self):
        bad = self.publish("bad.test", "throw new Error('red');\n")
        self.gh("pr", "merge", "1", "--squash", "--match-head-commit", bad, success=False)
        self.assertEqual(self.git("ls-remote", "origin", "main").split()[0], self.seed)
        for number, branch in ((2, "first"), (3, "second")):
            sha = self.publish(branch, "export const n = 1;\n")
            checks = json.loads(self.gh("api", "--paginate", f"repos/fixture/timer-kit/commits/{sha}/check-runs?per_page=100",
                                        "--jq", ".check_runs[] | {head_sha,name,status,conclusion} | @json"))
            self.assertEqual(checks["head_sha"], sha)
            self.assertEqual(checks["conclusion"], "success")
            self.gh("pr", "merge", str(number), "--squash", "--match-head-commit", self.seed, success=False)
            self.gh("pr", "merge", str(number), "--squash", "--delete-branch", "--match-head-commit", sha)
            self.assertEqual(self.git("ls-remote", "origin", branch), "")
            pr = json.loads(self.gh("pr", "view", str(number), "--json", "state,mergeCommit"))
            self.assertEqual(pr["state"], "MERGED")
            self.assertEqual(pr["mergeCommit"]["oid"], self.git("ls-remote", "origin", "main").split()[0])
            self.assertEqual(pr["testedHeadOid"], sha)
        prs = json.loads(self.gh("pr", "list", "--state", "all", "--json", "state"))
        self.assertEqual([p["state"] for p in prs], ["OPEN","MERGED","MERGED"])
        self.assertEqual(self.gh("api", "user", "--jq", ".login"), "fixture-runner")


if __name__ == "__main__":
    unittest.main()
