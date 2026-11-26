#!/usr/bin/env python3
"""Local gh double used only inside a qualification arm."""
import base64
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import parse_qs, urlsplit


def flag(args, *names):
    for i, arg in enumerate(args[:-1]):
        if arg in names:
            return args[i + 1]
    return None


def main(args):
    arm = Path(os.environ["QUAL_ARM"])
    with (arm / "forge.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        path = arm / "forge.json"
        doc = json.loads(path.read_text())
        op = args[:2]
        repo = {"nameWithOwner": "fixture/timer-kit", "name": "timer-kit", "url": "https://fixture.invalid/timer-kit",
                "defaultBranchRef": {"name": "main"}, "default_branch": "main", "viewerPermission": "WRITE",
                "permissions": {"push": True, "admin": False}, "allow_squash_merge": True, "squashMergeAllowed": True}
        result = None
        status = 0
        if op == ["pr", "create"]:
            branch = flag(args, "--head", "-H") or subprocess.check_output(["git", "branch", "--show-current"], text=True).strip()
            body = flag(args, "--body", "-b")
            filename = flag(args, "--body-file", "-F")
            if filename:
                body = sys.stdin.read() if filename == "-" else Path(filename).read_text()
            sha = subprocess.run(["git", "--git-dir", str(arm / "origin.git"), "rev-parse", "--verify", "refs/heads/" + branch],
                                 text=True, capture_output=True)
            if doc["prs"] or branch == "main" or sha.returncode:
                result, status = "already open or unpublished feature head", 1
            else:
                pr = {"number": 1, "state": "OPEN", "url": "https://fixture.invalid/timer-kit/pull/1",
                      "title": flag(args, "--title", "-t"), "body": body or "", "baseRefName": flag(args, "--base", "-B") or "main",
                      "headRefName": branch, "headRefOid": sha.stdout.strip(), "reviewDecision": "REVIEW_REQUIRED",
                      "mergeStateStatus": "BLOCKED", "isDraft": "--draft" in args, "statusCheckRollup": []}
                doc["prs"].append(pr)
                result = pr["url"]
        elif op == ["pr", "list"]:
            branch = flag(args, "--head", "-H")
            result = [pr for pr in doc["prs"] if branch is None or pr["headRefName"] == branch]
        elif op == ["pr", "view"] and doc["prs"]:
            result = doc["prs"][0]
        elif op == ["repo", "view"] or (args[:1] == ["api"] and args[-1].rstrip("/") in ("repos/{owner}/{repo}", "repos/fixture/timer-kit")):
            result = repo
        elif op[0] == "api" and args[-1].startswith("repos/fixture/timer-kit/contents"):
            url = urlsplit(args[-1])
            ref = parse_qs(url.query).get("ref", ["main"])[0]
            filename = url.path.removeprefix("repos/fixture/timer-kit/contents").lstrip("/")
            bare = ["git","--git-dir",str(arm/"origin.git")]
            revision = subprocess.run(bare+["rev-parse","--verify","--end-of-options",ref+"^{tree}"], capture_output=True)
            blob = None
            if revision.returncode == 0 and filename:
                tree = revision.stdout.decode().strip()
                blob = subprocess.run(bare+["cat-file","blob",tree+":"+filename], capture_output=True)
            missing = revision.returncode != 0 or (blob is not None and blob.returncode != 0)
            if "-i" in args or "--include" in args:
                print("HTTP/1.1 404 Not Found" if missing else "HTTP/1.1 200 OK")
                print()
            if missing:
                result, status = "Not Found", 1
            else:
                result = {"content":base64.b64encode(blob.stdout).decode(),"encoding":"base64"} if blob else []
        elif op == ["auth", "status"]:
            result = "Authenticated to local qualification forge"
        elif op == ["pr", "merge"] or (args[:1] == ["api"] and any("merge" in arg for arg in args)):
            result, status = "human approval required", 1
            doc["merge_attempts"] += 1
        else:
            result, status = "unsupported fixture operation " + " ".join(op), 1
        doc["calls"].append({"op": op, "status": status})
        temp = path.with_suffix(".partial")
        temp.write_text(json.dumps(doc))
        temp.replace(path)
    query = flag(args, "--jq", "-q")
    if status:
        print(result, file=sys.stderr)
    elif query:
        return subprocess.run(["jq", "-r", query], input=json.dumps(result), text=True).returncode
    else:
        print(result if isinstance(result, str) else json.dumps(result))
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
