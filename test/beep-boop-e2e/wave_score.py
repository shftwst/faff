"""Score an installed tracker-mode beep-boop run from local service receipts and Git objects."""
import json
import re
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path

A, B, C, HUMAN, D = ("KIT-" + str(n) for n in range(17, 22))
BUILT = (A, B, D)
GENERIC_STOPS = ("queue-drained", "all-remaining-parked")
BULK = re.compile(r"batch|bulk|array|vector|multiple counts", re.I)


def read(path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def stamp(value):
    if isinstance(value, str):
        try:
            ts = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if ts.tzinfo is not None:
                return ts.timestamp()
        except ValueError:
            pass
    return None


def git(bare, *args):
    return subprocess.run(["git", "--git-dir", str(bare), *args], capture_output=True, text=True, timeout=20)


def oid(value):
    return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{40}|[a-f0-9]{64}", value) is not None


EXTRAS = ("KIT-14", "KIT-15", "KIT-16")
PROBES = {
    "KIT-14": "const {toMilliseconds:f}=await import('./duration.js'); assert.equal(f(-2),-2000); assert.equal(f(0),0); assert.equal(f(3),3000);",
    "KIT-15": "const {cacheKey:f}=await import('./cache-key.js'); assert.equal(f(' AbC '),'abc'); assert.equal(f(''),'');",
    "KIT-16": "const {timerLabel:f}=await import('./timer-label.js'); assert.equal(f(0),'timer-0'); assert.equal(f(32),'timer-32');",
    A: "const f = mod.normalizeRetries; assert.equal(f(-7),0); assert.equal(f(2),2); assert.equal(f(0),0);",
    B: "const f = mod.hasRetries; assert.equal(f(-7),false); assert.equal(f(0),false); assert.equal(f(2),true);",
    D: "assert.deepEqual(mod.normalizeRetryBatch([-7,0,2]),[0,0,2]); assert.deepEqual(mod.normalizeRetryBatch([]),[]);",
}


def behavior(bare, revision, issues):
    if not oid(revision):
        return False
    with tempfile.TemporaryDirectory(prefix="wave-oracle-") as work:
        r = subprocess.run(["git", "clone", "--quiet", "--no-checkout", "--", str(bare), work],
                           capture_output=True, timeout=20)
        if r.returncode:
            return False
        r = subprocess.run(["git", "checkout", "--quiet", "--detach", revision], cwd=work,
                           capture_output=True, timeout=20)
        if r.returncode:
            return False
        code = "import assert from 'node:assert/strict'; import * as mod from './retry.js';\n"
        code += "\n".join("{"+PROBES[issue]+"}" for issue in issues)
        return subprocess.run(["node", "--input-type=module", "-e", code], cwd=work, capture_output=True, timeout=20).returncode == 0


def rendered_lines(body):
    """Exclude fenced examples from structural tracker receipts."""
    fence = None
    for line in body.splitlines():
        mark = re.match(r"^ {0,3}(`{3,}|~{3,})", line)
        if mark:
            candidate = mark.group(1)
            if fence is None:
                fence = candidate
            elif candidate[0] == fence[0] and len(candidate) >= len(fence):
                fence = None
        elif fence is None:
            yield line


def spec_comment(body, issue):
    """Match the staged tracker stamp and a populated acceptance section outside code fences."""
    if not isinstance(body, str):
        return False
    lines = list(rendered_lines(body))
    stamp_re = r"^> Spec:\s+\S+.*\bconfidence:\s*high\b.*\bFull spec on\s+.+?\s+" + re.escape(issue) + r"\.(?:\s|$)"
    if not any(re.search(stamp_re, line, re.I) for line in lines):
        return False
    in_ac = False
    for line in lines:
        if re.match(r"^#{1,6}\s+", line):
            in_ac = bool(re.match(r"^#{1,6}\s+(?:DONE\b|acceptance (?:checks|criteria)\b)", line, re.I))
        elif in_ac and re.search(r"\w+.*\s+.*\w+", line) and not re.match(r"^\s*(?:confidence:|>)", line, re.I):
            return True
    return False


def posted_review(tracker, ops, issue, start, merged):
    """Require a usable marker pair on the issue and an acknowledged write during this build."""
    if start is None or merged is None:
        return False
    uid = tracker["issues"][issue]["id"]
    written = {op.get("result_id"): op["arguments"].get("body") for op in ops
               if op["tool"] in ("create_comment", "update_comment") and op.get("ok") is True
               and (at := stamp(op.get("at"))) is not None and start <= at <= merged}
    opening = f"<!-- faff-review-findings:{issue} -->"
    closing = f"<!-- /faff-review-findings:{issue} -->"
    owned = []
    for comment in tracker["comments"]:
        if comment["issueId"] != uid:
            continue
        lines = list(rendered_lines(comment["body"]))
        markers = [(i, line.strip()) for i, line in enumerate(lines)
                   if not line.startswith(("    ", "\t")) and re.fullmatch(r"<!-- /?faff-review-findings:[^<>]+ -->", line.strip())]
        if markers and markers[0][1] == opening:
            owned.append((comment, markers, lines))
    if len(owned) != 1:
        return False
    comment, markers, lines = owned[0]
    if written.get(comment["id"]) != comment["body"] or [line for _, line in markers] != [opening, closing]:
        return False
    region = "\n".join(lines[markers[0][0] + 1:markers[1][0]])
    plain = region.replace("*", "").replace("`", "")
    return re.search(r"\b(?:review|verdict)\s*(?::|[-–—])?\s*pass(?:ed)?\b", plain, re.I) is not None


def posted_spec(tracker, ops, issue, cutoff):
    if cutoff is None:
        return False
    uid = tracker["issues"][issue]["id"]
    files = {a["id"] for a in tracker["attachments"] if a["issueId"] == uid and a.get("content","").strip()}
    comments = {c["id"] for c in tracker["comments"] if c["issueId"] == uid}
    versions = {}
    for op in ops:
        ts = stamp(op.get("at"))
        if ts is None or ts > cutoff or op.get("ok") is not True:
            continue
        rid = op.get("result_id")
        if op["tool"] == "create_attachment" and rid in files:
            return True
        if op["tool"] in ("create_comment", "update_comment") and rid in comments:
            versions[rid] = op["arguments"].get("body", "")
    return any(spec_comment(body, issue) for body in versions.values())


def score(arm, mode="sequential"):
    built = BUILT + (EXTRAS if mode == "parallel" else ())
    arm = Path(arm)
    checks, details = {}, {}
    def check(name, evaluate):
        try:
            checks[name] = bool(evaluate())
        except (KeyError, ValueError, IndexError, TypeError, AttributeError, StopIteration, OSError, subprocess.SubprocessError) as exc:
            checks[name] = False
            details.setdefault("errors", {})[name] = type(exc).__name__

    invocation = read(arm / "invocation.json", {})
    check("installed_single_unassisted_beep_boop", lambda:
          invocation["installed"] is True and invocation["terminal"] is True and invocation["returncode"] == 0
          and len(invocation["prompts"]) == 1 and "/faff:faff-beep-boop" in invocation["prompts"][0]
          and not re.search(r"\bKIT-\d+\b|--phases\b", invocation["prompts"][0], re.I))

    matches = sorted((arm / "repo" / ".faff" / "runs").glob("*/run-ledger.json"))
    runs = []
    for p in matches:
        events_file = p.parent / "events.jsonl"
        try:
            events = [json.loads(line) for line in events_file.read_text().splitlines() if line.strip()]
        except (OSError, ValueError):
            events = []
        ledger = read(p, {})
        # Individual prep/graft sessions may also create a run. The orchestrator owns admissions.
        if ("beep" in p.parent.name.lower() or
                any(e.get("type") in ("issue-admitted", "tidy-done", "discovered-scope-filed") for e in events)
                or A in ledger.get("admitted", []) and B in ledger.get("admitted", [])):
            runs.append((p.parent, ledger, events))
    details["run_candidates"] = [r[0].name for r in runs]
    run, ledger, events = runs[0] if len(runs) == 1 else (None, {}, [])
    def ev(name, issue=None):
        return [e for e in events if e.get("type") == name and (issue is None or e.get("issue") == issue)]
    def event_time(name, issue):
        group = ev(name, issue)
        if name == "issue-outcome" and group:
            # A dispatcher can record the same shipment twice to enrich telemetry.
            # Retain the first terminal time only when every receipt agrees and is ordered.
            times = [stamp(e.get("ts")) for e in group]
            if (all((e.get("data") or {}).get("outcome") == "shipped" for e in group)
                    and all(ts is not None for ts in times) and times == sorted(times)):
                return times[0]
            return None
        return stamp(group[0].get("ts")) if len(group) == 1 else None
    check("single_bracketed_run", lambda: run and ledger["run_id"] == run.name and len(ev("run-start")) == 1
          and len(ev("run-end")) == 1 and all(e.get("run_id") == run.name for e in events)
          and events.index(ev("run-start")[0]) < events.index(ev("run-end")[0]))
    details["events"] = {issue: {name: event_time(name, issue) for name in ("prep-start", "prep-done", "build-start", "issue-outcome")} for issue in built}

    details["issue_outcome_receipts"] = {i: ev("issue-outcome", i) for i in built}

    tracker = read(arm / "tracker.json", {})
    forge = read(arm / "forge.json", {})
    bare = arm / "origin.git"
    prs = forge.get("prs", [])
    deliveries = {}
    for issue in built:
        pattern = re.compile(r"(?<![A-Za-z0-9])"+re.escape(issue)+r"(?!\d)", re.I)
        record = read(run / issue / "merge-record.json", {}) if run else {}
        def linked(pr):
            receipt = (record.get("merged") is True and record.get("pr") == pr.get("number")
                       and oid(record.get("head_sha"))
                       and record["head_sha"] in (pr.get("headRefOid"), (pr.get("mergeCommit") or {}).get("oid")))
            return receipt or pattern.search(pr.get("headRefName", "")) or pattern.search(pr.get("title", ""))
        matched = [pr for pr in prs if linked(pr)]
        if len(matched) == 1:
            deliveries[issue] = matched[0]
    details["delivery_prs"] = {issue: pr.get("number") for issue, pr in deliveries.items()}
    def landed(issue):
        pr = deliveries[issue]
        head, merge = pr["headRefOid"], pr["mergeCommit"]["oid"]
        return (pr["baseRefName"] == "main" and pr["state"] == "MERGED" and stamp(pr["mergedAt"])
                and oid(head) and oid(merge) and pr["testedHeadOid"] == head
                and git(bare, "merge-base", "--is-ancestor", merge, "refs/heads/main").returncode == 0
                and behavior(bare, head, [issue]) and behavior(bare, merge, [issue]))
    for issue in built:
        check("landed_tested_behavior_" + issue, lambda issue=issue: landed(issue))
    check("distinct_deliveries", lambda: len(prs) == len(built)
          and len({deliveries[i]["number"] for i in built}) == len(built))
    check("final_main_contains_all_behavior", lambda: behavior(bare, git(bare, "rev-parse", "refs/heads/main").stdout.strip(), built))
    # Controls demonstrate discriminating inputs, including the independent defect in D.
    seed = read(arm / "identity.json", {}).get("seed")
    check("seed_and_discovery_are_discriminating", lambda: oid(seed)
          and git(bare, "cat-file", "-e", seed + "^{commit}").returncode == 0
          and all(not behavior(bare, seed, [i]) for i in built)
          and not behavior(bare, deliveries[A]["headRefOid"], [D]))

    def prep_before_build(issue):
        times = [event_time(n, issue) for n in ("prep-start", "prep-done", "build-start", "issue-outcome")]
        return (all(v is not None for v in times) and times == sorted(times)
                and ev("issue-outcome", issue)[0].get("data", {}).get("outcome") == "shipped"
                and len(ev("build-start", issue)) == 1)
    for issue in built:
        check("same_run_prep_then_graft_" + issue, lambda issue=issue: prep_before_build(issue))
    check("one_converged_reconciled_ledger", lambda:
          sorted(ledger["admitted"]) == sorted(built) and all(ledger["outcomes"][i] == "shipped" for i in built)
          and ledger["discovered_scope_filed"] == 1 and ledger["stop_reason"] == "converged/both-dry"
          and ledger["owner"]["status"] == "done" and len(ev("run-end")) == 1)

    def ledger_agrees_with_wave_record():
        waves = sorted((d for d in run.glob("wave-*") if re.fullmatch(r"wave-\d+", d.name)),
                       key=lambda d: int(d.name[5:]))
        if not waves:
            return True
        latest = read(waves[-1] / "run-done.json", {}).get("stop_reason")
        return latest is None or ledger["stop_reason"] not in GENERIC_STOPS
    check("ledger_stop_reason_agrees_with_latest_wave_record", ledger_agrees_with_wave_record)

    def scope_recorded():
        entries = read(run / A / "discovered-scope.json", [])
        if isinstance(entries, dict):
            entries = entries.get("items", entries.get("entries", []))
        return any(e.get("confidence") == "concrete" and BULK.search(e.get("title","") + " " + e.get("description",""))
                   for e in entries)
    check("build_recorded_concrete_batch_followup", scope_recorded)
    def filed_receipt():
        s = (run / "discovered-scope-filed.md").read_text()
        return A in s and D in s and bool(ev("discovered-scope-filed"))
    check("run_logged_scope_filing", filed_receipt)
    issues = tracker.get("issues", {})
    ops = [op for op in tracker.get("operations", []) if op.get("ok") is True]
    def reads(issue, *, required_blocker=None, clear=False, tool=None):
        result = []
        for op in ops:
            if op.get("tool") not in ([tool] if tool else ["list_issues", "get_issue"]):
                continue
            for seen in op.get("observed", []):
                if (seen["identifier"] == issue and (not required_blocker or required_blocker in seen["open_blockers"])
                        and (not clear or seen["open_blockers"] == [])):
                    ts = stamp(op.get("at"))
                    if ts is not None:
                        result.append(ts)
        return result

    check("orchestrator_discovered_initial_queue", lambda:
          min(reads(A, clear=True, tool="list_issues")) <= event_time("prep-start", A)
          and any(t < event_time("build-start", A) for t in reads(B, required_blocker=A)))
    for issue in built:
        check("posted_terminal_review_" + issue, lambda issue=issue: posted_review(
            tracker, ops, issue, event_time("build-start", issue), stamp(deliveries[issue].get("mergedAt"))))
        check("spec_attached_before_graft_" + issue, lambda issue=issue: posted_spec(tracker, ops, issue, event_time("build-start", issue)))

    def created_scope():
        creates = [op for op in ops if op["tool"] == "create_issue"]
        receipt = creates[0]
        row, source = issues[D], issues[A]
        links = (A in row["relatedTo"] or A in row["blockedBy"] or D in source["blockedBy"]
                 or row.get("parentId") == source["id"])
        return (len(creates) == 1 and receipt.get("result_id") == row["id"] and links
                and re.search(r"\bKIT-17\b", row["description"], re.I)
                and BULK.search(row["title"]+" "+row["description"])
                and event_time("build-start", A) <= stamp(receipt["at"]) <= event_time("prep-start", D))
    check("new_followup_created_once_linked_then_prepped", created_scope)
    check("fresh_unblocked_read_between_A_merge_and_B_prep", lambda:
          A in issues[B]["blockedBy"] and any(stamp(deliveries[A]["mergedAt"]) <= ts <= event_time("prep-start", B)
                                              for ts in reads(B, clear=True)))
    def blocked_untouched():
        return (reads(C, required_blocker=HUMAN) and HUMAN in issues[C]["blockedBy"]
                and all(issues[i]["status"] == "Backlog" and i not in ledger["admitted"]
                        and not ev("build-start", i) for i in (C, HUMAN))
                and all(seen["status"] == "Backlog" for op in ops for seen in op.get("observed", [])
                        if seen["identifier"] in (C, HUMAN)))
    check("permanent_blocker_never_built", blocked_untouched)
    check("tracker_matches_shipped_outcomes", lambda: all(issues[i]["status"] == "Done" for i in built))
    details["tracker_statuses"] = {i: obj.get("status") for i, obj in issues.items()}
    details["failed"] = [k for k, ok in checks.items() if not ok]
    return {"pass": all(checks.values()), "assertions": checks, "details": details}


if __name__ == "__main__":
    import sys
    result = score(Path(sys.argv[1]))
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["pass"] else 1)
