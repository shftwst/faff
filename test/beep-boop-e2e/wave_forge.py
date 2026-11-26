"""Local gh double for installed multi-wave qualification, with tested merges into the arm's own bare main."""
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit

import delivery_forge

SLUG = "fixture/timer-kit"
URL = "https://fixture.invalid/" + SLUG
CHECK = "unit"
flag = delivery_forge.flag


def now():
    return datetime.now(timezone.utc).isoformat()


def git(arm, *args, input=None):
    p = subprocess.run(["git", "--git-dir", str(arm / "origin.git"), *args],
                       capture_output=True, text=True, input=input, timeout=30)
    if p.returncode:
        raise ValueError(p.stderr.strip() or "Git operation failed")
    return p.stdout.strip()


def head(arm, branch):
    return git(arm, "rev-parse", "--verify", "--end-of-options", "refs/heads/" + branch + "^{commit}")


def test_revision(arm, doc, sha):
    results = doc.setdefault("checks", {})
    if sha not in results:
        env = {k: v for k, v in os.environ.items() if k in ("PATH", "LANG", "LC_ALL", "TMPDIR")}
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(["git", "clone", "--quiet", "--no-checkout", str(arm / "origin.git"), tmp],
                           capture_output=True, check=True, timeout=30)
            # The proposed merge commit can still be unreachable from published refs.
            subprocess.run(["git", "-C", tmp, "fetch", "-q", "origin", sha], capture_output=True, check=True, timeout=30)
            subprocess.run(["git", "-C", tmp, "checkout", "-q", "--detach", sha], check=True, timeout=30)
            test = subprocess.run(["node", "--test"], cwd=tmp, env=env, capture_output=True, text=True, timeout=60)
            passed = test.returncode == 0 and re.search(r"(?m)^# pass [1-9][0-9]*$", test.stdout) is not None
            results[sha] = {"head_sha": sha, "name": CHECK, "status": "completed",
                            "conclusion": "success" if passed else "failure", "completed_at": now()}
    return results[sha]


def refresh(arm, doc, pr):
    if pr["state"] == "OPEN":
        pr["headRefOid"] = head(arm, pr["headRefName"])
        check = test_revision(arm, doc, pr["headRefOid"])
        pr["testedHeadOid"] = check["head_sha"]
        pr["statusCheckRollup"] = [{"__typename": "CheckRun", "name": CHECK, "status": "COMPLETED",
                                    "conclusion": check["conclusion"].upper()}]
        pr["mergeStateStatus"] = "CLEAN" if check["conclusion"] == "success" and not pr["isDraft"] else "BLOCKED"
    return pr


def select(arm, doc, args):
    value = args[2] if len(args) > 2 and not args[2].startswith("-") else subprocess.check_output(
        ["git", "branch", "--show-current"], text=True).strip()
    for pr in reversed(doc["prs"]):
        if value in (pr["url"], str(pr["number"]), pr["headRefName"]):
            return refresh(arm, doc, pr)
    raise ValueError("no pull request found")


def merge(arm, doc, args, pr):
    doc["merge_attempts"] += 1
    sha = pr["headRefOid"]
    if pr["state"] != "OPEN" or pr["isDraft"] or pr["mergeStateStatus"] != "CLEAN":
        raise ValueError("PR is closed, draft, or has failing checks")
    if flag(args, "--match-head-commit") != sha:
        raise ValueError("expected published feature head (--match-head-commit)")
    base = head(arm, "main")
    tree = git(arm, "merge-tree", "--write-tree", base, sha).splitlines()[0]
    commit = ["commit-tree", tree, "-p", base]
    if "--squash" not in args:
        commit += ["-p", sha]
    merged = git(arm, *commit, input=pr["title"] + "\n")
    if test_revision(arm, doc, merged)["conclusion"] != "success":
        raise ValueError("combined tree fails tests")
    if head(arm, pr["headRefName"]) != sha:
        raise ValueError("head changed while checking merge")
    updates = ["start", f"update refs/heads/main {merged} {base}"]
    if "--delete-branch" in args:
        updates.append(f"delete refs/heads/{pr['headRefName']} {sha}")
    else:
        updates.append(f"verify refs/heads/{pr['headRefName']} {sha}")
    git(arm, "update-ref", "--stdin", input="\n".join(updates + ["prepare", "commit", ""]))
    pr.update(state="MERGED", mergedAt=now(), mergeCommit={"oid": merged}, baseBeforeMerge=base)
    return {"merged": True, "sha": merged, "head_sha": sha, "number": pr["number"]}


def operate(arm, doc, args, endpoint):
    op = tuple(args[:2])
    if op == ("repo", "view") or endpoint in ("repos/" + SLUG, "repos/{owner}/{repo}"):
        return {"nameWithOwner": SLUG, "name": "timer-kit", "owner": {"login": "fixture"}, "url": URL,
                "defaultBranchRef": {"name": "main"}, "default_branch": "main", "viewerPermission": "ADMIN",
                "permissions": {"push": True, "admin": True}, "allow_squash_merge": True, "allow_merge_commit": True,
                "squashMergeAllowed": True, "mergeCommitAllowed": True, "isPrivate": True}
    if endpoint == "user":
        return {"login": "fixture-runner", "id": 1, "type": "User"}
    if endpoint == f"repos/{SLUG}/rules/branches/main":
        return [{"type": "pull_request", "parameters": {"required_approving_review_count": 0,
                                                       "require_code_owner_review": False}},
                {"type": "required_status_checks", "parameters": {"required_status_checks": [{"context": CHECK}]}}]
    match = re.fullmatch(r"repos/fixture/timer-kit/commits/([a-f0-9]{40})/(status|check-runs)", endpoint or "")
    if match:
        sha, action = match.groups()
        if action == "status":
            return {"state": "pending", "statuses": []}
        return {"total_count": 1, "check_runs": [test_revision(arm, doc, sha)]}
    if op == ("pr", "create"):
        branch = flag(args, "--head", "-H") or subprocess.check_output(["git", "branch", "--show-current"], text=True).strip()
        base = flag(args, "--base", "-B") or "main"
        if branch == base or base != "main":
            raise ValueError("base must be main; head must be a published feature branch")
        if any(p["headRefName"] == branch and p["state"] == "OPEN" for p in doc["prs"]):
            raise ValueError("PR already exists for head")
        sha = head(arm, branch)
        body = flag(args, "--body", "-b") or ""
        fname = flag(args, "--body-file", "-F")
        if fname:
            body = sys.stdin.read() if fname == "-" else Path(fname).read_text()
        number = len(doc["prs"]) + 1
        pr = {"number": number, "url": f"{URL}/pull/{number}", "baseRefName": base, "headRefName": branch,
              "headRefOid": sha, "title": flag(args, "--title", "-t") or branch, "body": body, "state": "OPEN",
              "author": {"login": "fixture-runner"}, "createdAt": now(), "mergedAt": None, "mergeCommit": None,
              "reviewDecision": "", "isDraft": "--draft" in args, "mergeable": "MERGEABLE"}
        doc["prs"].append(refresh(arm, doc, pr))
        return pr["url"]
    if op == ("pr", "list"):
        state = (flag(args, "--state", "-s") or "open").upper()
        branch, base = flag(args, "--head", "-H"), flag(args, "--base", "-B")
        return [refresh(arm, doc, pr) for pr in doc["prs"] if (not branch or pr["headRefName"] == branch)
                and (not base or base == pr["baseRefName"]) and (state == "ALL" or state == pr["state"]
                or (state == "CLOSED" and pr["state"] == "MERGED"))]
    if op in (("pr", "view"), ("pr", "merge"), ("pr", "checks"), ("pr", "ready")):
        pr = select(arm, doc, args)
        if op[1] == "view":
            return pr
        if op[1] == "merge":
            return merge(arm, doc, args, pr)
        if op[1] == "ready":
            pr["isDraft"] = False
            return refresh(arm, doc, pr)
        check = pr["statusCheckRollup"][0]
        if "--json" in args:
            return [{"name": CHECK, "state": check["conclusion"], "bucket": "pass" if check["conclusion"] == "SUCCESS" else "fail"}]
        if check["conclusion"] != "SUCCESS":
            raise ValueError("unit\tfail\t0s")
        return "unit\tpass\t0s"
    raise ValueError("unsupported qualification forge operation " + " ".join(args[:3]))


def main(args):
    arm = Path(os.environ["QUAL_ARM"]).resolve()
    raw = next((x for x in args[1:] if x.startswith(("repos/", "/repos/")) or x == "user"), "")
    endpoint = urlsplit(raw.lstrip("/")).path.rstrip("/").replace("{owner}/{repo}", SLUG)
    if ((args[:1] == ["api"] and endpoint.startswith(f"repos/{SLUG}/contents"))
            or args[:2] == ["auth", "status"]):
        # The one-arm forge implements these read operations with the real bare Git tree.
        if raw:
            args = ["-i" if a == "-I" else a for a in args if a != raw]
            args.append(raw.lstrip("/").replace("{owner}/{repo}", SLUG))
        return delivery_forge.main(args)
    with (arm / "forge.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        path = arm / "forge.json"
        doc = json.loads(path.read_text())
        try:
            result = operate(arm, doc, args, endpoint)
            status = 0
        except (ValueError, subprocess.SubprocessError, OSError) as exc:
            result, status = str(exc), 1
        receipt = {"op": args[:2], "status": status, "at": now()}
        if endpoint:
            receipt["endpoint"] = endpoint
        if status:
            receipt["error"] = result
        if args[:2] == ["pr", "merge"] and not status:
            receipt["result"] = result
        doc["calls"].append(receipt)
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
