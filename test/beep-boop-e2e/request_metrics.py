"""Observed response windows in an installed delivery fixture."""
from collections import defaultdict
from datetime import datetime


def instant(text):
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def graft_windows(rows):
    contexts = defaultdict(list)
    dispatches = {c["id"] for r in rows for c in r["tools"].values()
                  if c["name"] in ("Agent", "Task")}
    for r in rows:
        if r["parent"] in dispatches:
            contexts[r["parent"]].append(r)
    windows = defaultdict(list)
    ambiguous = 0
    for responses in contexts.values():
        starts = [(i, c.get("verify_issue")) for i, r in enumerate(responses)
                  for c in r["tools"].values() if c.get("verify_build")]
        if not starts:
            continue
        issues = {issue for _, issue in starts}
        if len(issues) != 1 or None in issues:
            ambiguous += 1
            continue
        windows[issues.pop()].append(len(responses) - starts[0][0])
    return dict(by_issue=dict(windows), ambiguous_worker_contexts=ambiguous)


def wave_windows(rows, events, recorded_waves):
    parents = [r for r in rows if not r["parent"]]
    starts = sorted(instant(e["ts"]) for e in events if e["type"] in ("prep-start", "build-start"))
    checkpoints = sorted(instant(r["at"]) for r in parents
                         if any(c.get("wave_checkpoint") for c in r["tools"].values()))
    spans = []
    for end in checkpoints:
        start = next((s for s in starts if (not spans or s > spans[-1][1]) and s <= end), None)
        if start is not None:
            spans.append((start, end))
    if not spans or recorded_waves != list(range(1, len(spans) + 1)) or starts[-1] > spans[-1][1]:
        return dict(by_wave=None, outside_or_unattributed=len(parents))
    counts = {n:sum(start <= instant(r["at"]) <= end for r in parents)
              for n, (start, end) in enumerate(spans, 1)}
    return dict(by_wave=counts, outside_or_unattributed=len(parents) - sum(counts.values()))


def request_metrics(rows, events, recorded_waves, shipped):
    graft = graft_windows(rows)
    per_issue = {issue:sum(counts) for issue, counts in graft["by_issue"].items()}
    covered = set(per_issue).intersection(shipped)
    return dict(shipped_issues=sorted(shipped),
                all_responses_per_shipped_issue=len(rows)/len(shipped) if shipped else None,
                parent_responses=wave_windows(rows, events, recorded_waves),
                graft_verification_to_return=dict(**graft, shipped_without_window=sorted(shipped-covered),
                    mean_per_covered_shipped_issue=sum(per_issue[i] for i in covered)/len(covered) if covered else None))
