"""Summarise an instrumented run. Pass one or more run directories."""
import argparse
from collections import Counter, defaultdict
from datetime import datetime
import json
from pathlib import Path

CLASSES = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")
SHARED = {f"KIT-{i}" for i in range(14, 19)}


def load_responses(path):
    messages = {}
    for line in path.read_text().splitlines():
        row = json.loads(line)
        msg = messages.setdefault(row["response"], dict(row, tools={}, usage={}))
        for call in row["tools"]:
            msg["tools"][call["id"]] = call
        for key, value in row["usage"].items():
            msg["usage"][key] = max(msg["usage"].get(key, 0), value)
    return list(messages.values())


def aggregate(rows):
    return dict(responses=len(rows), **{k:sum(r["usage"].get(k,0) for r in rows) for k in CLASSES})


def analyze(arm):
    rows = load_responses(arm/"responses.jsonl")
    ledger = next((arm/"repo/.faff/runs").glob("*beep*/events.jsonl"), None)
    phases = []
    if ledger:
        phase = "startup"
        for line in ledger.read_text().splitlines():
            event = json.loads(line)
            kind = event["type"]
            if kind == "prep-start":
                phase = "prep"
            elif kind == "issue-admitted":
                phase = "admission"
            elif kind == "build-start":
                phase = "build"
            elif kind == "discovered-scope-filed":
                phase = "discovery/re-entry"
            elif kind == "run-end":
                phase = "close"
            else:
                continue
            phases.append((datetime.fromisoformat(event["ts"].replace("Z","+00:00")),phase))
    owners = {c["id"]:r for r in rows for c in r["tools"].values() if c["name"] in ("Task","Agent")}
    grouped = defaultdict(list)
    previous = {}
    opportunities = defaultdict(list)
    for r in rows:
        actor = "worker" if r["parent"] else "parent"
        ts = datetime.fromisoformat(r["at"])
        phase = next((phase for at,phase in reversed(phases) if at <= ts),"startup")
        calls = list(r["tools"].values())
        keys = {i for c in calls for i in c["issues"]}
        ancestor = r
        seen = set()
        while ancestor["parent"] in owners and ancestor["parent"] not in seen:
            dispatch = ancestor["parent"]
            seen.add(dispatch)
            ancestor = owners[dispatch]
            keys.update(ancestor["tools"][dispatch]["issues"])
        if keys and keys <= SHARED:
            scope = "shared"
        elif keys == {"KIT-21"}:
            scope = "extra"
        elif keys == {"KIT-19"} or keys == {"KIT-20"}:
            scope = "blocked"
        else:
            scope = "mixed/unassigned"
        grouped["role/"+actor].append(r)
        grouped["phase/"+phase+"/"+actor].append(r)
        grouped["scope/"+scope].append(r)
        # Consecutive responses in one model context with homogeneous call types.
        # These are screening candidates, not proof the underlying operations can be fused.
        def classify(c):
            if c["name"] in ("mcp__qualification-tracker__get_issue","mcp__qualification-tracker__list_comments",
                             "mcp__qualification-tracker__list_issues"):return "tracker reads"
            if c["name"] in ("TaskCreate","TaskUpdate","TaskList","TaskGet"):return "task bookkeeping"
            if c["name"] == "Read":return "file reads"
            if c["name"] == "Bash" and set(c["categories"]) & {"sentry","checkpoint","heartbeat","run-ledger","decision-capture"}:
                return "workflow bookkeeping"
            return None
        kinds = {classify(c) for c in calls}
        kind = next(iter(kinds)) if len(kinds)==1 else None
        prior = previous.get(r["parent"])
        if kind and prior == (kind,phase):
            opportunities[kind].append(r)
        previous[r["parent"]] = (kind,phase)
    result = dict(total=aggregate(rows),groups={k:aggregate(v) for k,v in grouped.items()},
                  adjacent={k:aggregate(v) for k,v in opportunities.items()})
    for file in ("workflow","session","invocation"):
        f=arm/(file+".json")
        if f.exists():
            obj=json.loads(f.read_text())
            result[file] = {k:obj[k] for k in ("pass","checks","turns","usage","revision","terminal","returncode") if k in obj}
    result["merges"]=sum(pr["state"]=="MERGED" for pr in json.loads((arm/"forge.json").read_text())["prs"])
    return result


if __name__=="__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("arms",nargs="+",type=Path)
    print(json.dumps({p.name:analyze(p) for p in parser.parse_args().arms},indent=2))
