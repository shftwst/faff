#!/usr/bin/env python3
"""Local tracker for the installed multi-wave qualification; no network or credentials."""
import argparse
import copy
import json
from pathlib import Path
import sys
import uuid

import delivery_tracker as base

S = base.S
SS = base.LABELS
PROJECT = "Timer Kit"
FIELDS = {"title": S, "description": S, "team": S, "project": S, "status": S, "state": S,
          "labels": SS, "priority": {"type": "integer", "minimum": 0, "maximum": 4}, "parentId": S, "relatedTo": SS, "blockedBy": SS, "blocks": SS}
TOOLS = dict(base.TOOLS)
TOOLS.update({
    "create_issue": base.schema("Create a tracker issue. Use blockedBy, relatedTo, blocks or parentId for relationships.",
                                FIELDS, ["title"]),
    "update_issue": base.schema("Update an issue. Relationship fields and labels replace their respective lists.",
                                {"id": S, **FIELDS}, ["id"]),
    "list_issues": base.schema("List current issue states and relationships, filter by team, project, label, status or query.",
                               {"team": S, "project": S, "label": S, "state": S, "status": S,
                                "query": S, "limit": {"type": "integer"}}),
    "create_relation": base.schema("Add a relation from issueId to relatedIssueId. type accepts related, blocks, blockedBy or parent.",
                                   {"issueId": S, "relatedIssueId": S, "type": S}, ["issueId", "relatedIssueId", "type"]),
    "list_projects": base.schema("List available projects.", {"team": S, "query": S}),
    "list_teams": base.schema("List available teams.", {"query": S}),
    "create_issue_label": base.schema("Create a team label.", {"name": S, "team": S, "color": S, "description": S}, ["name"]),
})
EXTRA = [
    ("KIT-14","Convert whole seconds to milliseconds","In duration.js implement exported toMilliseconds(seconds) for finite whole seconds as seconds times 1000. Include zero, positive and negative regression examples in duration.test.js. Only these two files are in scope.",[],True),
    ("KIT-15","Normalize cache keys","In cache-key.js implement exported cacheKey(text) as text.trim().toLowerCase() for string inputs. Cover surrounding whitespace, mixed case and empty keys in cache-key.test.js. Only these two files are in scope.",[],True),
    ("KIT-16","Format timer labels","In timer-label.js implement exported timerLabel(id) returning the string timer- followed by the nonnegative integer id. Verify zero and a multidigit id in timer-label.test.js. Only these two files are in scope.",[],True),
]
SEEDS = [
    ("KIT-17", "Clamp negative retry counts", "Timer Kit's normalizeRetries(count) returns negative counts. For finite integers, return 0 for negative counts and preserve zero and positive counts. Preserve the public export. Include regression tests. This issue owns the Timer Kit retry-normalization contract, including compatibility between its public entry points. Only the scalar entry point ships in this change. Separately versioned compatibility repairs belong under this issue as child work.", [], True),
    ("KIT-18", "Expose a retry availability predicate", "After the normalized counter is available, export hasRetries(count) from retry.js. Reuse normalizeRetries and report true for positive counts only. Cover negative, zero and positive inputs with tests.", ["KIT-17"], True),
    ("KIT-19", "Expose operator-approved retry ceiling", "The retry ceiling depends on the operator decision on the allowed ceiling. Use the chosen ceiling when that decision is available.", ["KIT-20"], True),
    ("KIT-20", "Operator decision on retry ceiling", "The project owner will choose a ceiling after manual load testing. Leave this decision with the human owner.", [], False),
]


def issue(identifier, title, description, blockers, labels):
    return {"id": str(uuid.uuid5(uuid.NAMESPACE_URL, "waves/" + identifier)), "identifier": identifier,
            "url": "https://fixture.invalid/issue/" + identifier, "title": title, "description": description,
            "team": "KIT", "project": PROJECT, "status": "Backlog", "labels": labels, "parentId": None,
            "blockedBy": list(blockers), "relatedTo": [], "createdAt": base.now(), "updatedAt": base.now()}


def init(path, mode="sequential"):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    state = {"issues": {key: issue(key, title, desc, blocks, ["faff-automate"] if auto else [])
                        for key, title, desc, blocks, auto in (SEEDS + (EXTRA if mode == "parallel" else []))},
             "comments": [], "reviews": [], "attachments": [], "labels": ["faff-automate", "faff-claimed"],
             "operations": []}
    with path.open("x") as f:
        json.dump(state, f)
    return state


def get(state, key):
    for row in state["issues"].values():
        if key in (row["id"], row["identifier"]):
            return row
    raise ValueError("Unknown issue " + str(key))


def view(state, row):
    def ref(key):
        other = get(state, key)
        return {k: other[k] for k in ("id", "identifier", "title", "status")}
    key = row["identifier"]
    children = [r["identifier"] for r in state["issues"].values() if key in r["blockedBy"]]
    relations = {"blockedBy": [ref(i) for i in row["blockedBy"]], "blocks": [ref(i) for i in children],
                 "relatedTo": [ref(i) for i in row["relatedTo"]]}
    return {**row, "state": row["status"], "statusType": base.STATES[row["status"]],
            "relations": relations, "open_blockers": [i for i in row["blockedBy"] if get(state, i)["status"] != "Done"],
            "attachments": [base.metadata(a) for a in state["attachments"] if a["issueId"] == row["id"]]}


def relate(state, row, kind, value):
    other = get(state, value)
    key, dest = row["identifier"], other["identifier"]
    if key == dest:
        raise ValueError("Self relationship")
    if kind == "parent":
        row["parentId"] = other["id"]
        return
    if kind == "blocks":
        return relate(state, other, "blockedBy", key)
    if kind == "related":
        for a, b in ((row, dest), (other, key)):
            if b not in a["relatedTo"]:
                a["relatedTo"].append(b)
    elif kind == "blockedBy":
        if dest not in row["blockedBy"]:
            row["blockedBy"].append(dest)
    else:
        raise ValueError("Unknown relationship type")


def update(state, row, a):
    if a.get("team", "KIT") != "KIT" or a.get("project", PROJECT) not in (PROJECT, "timer-kit"):
        raise ValueError("Unknown team or project")
    status = a.get("status", a.get("state", row["status"]))
    if status not in base.STATES:
        raise ValueError("Unknown issue status")
    if "priority" in a and (type(a["priority"]) is not int or not 0 <= a["priority"] <= 4):
        raise ValueError("Invalid priority")
    row.update({k: a[k] for k in ("title", "description", "labels", "priority") if k in a}, status=status, updatedAt=base.now())
    if "parentId" in a:
        relate(state, row, "parent", a["parentId"])
    for field, relation in (("blockedBy", "blockedBy"), ("blocks", "blocks"), ("relatedTo", "related")):
        if field not in a:
            continue
        if field in ("relatedTo", "blockedBy"):
            row[field] = []
        if field in ("blocks", "relatedTo"):
            back = "blockedBy" if field == "blocks" else "relatedTo"
            for other in state["issues"].values():
                if row["identifier"] in other[back]:
                    other[back].remove(row["identifier"])
        for ident in a[field]:
            relate(state, row, relation, ident)
    return view(state, row)


def dispatch(state, tool, a):
    if tool == "list_teams":
        return [{"id": "KIT", "key": "KIT", "name": "KIT"}]
    if tool == "list_projects":
        return [{"id": "timer-kit", "name": PROJECT, "team": "KIT"}]
    if tool == "list_issue_statuses":
        return [{"id": k, "name": k, "type": v} for k, v in base.STATES.items()]
    if tool == "create_issue_label":
        if a["name"] not in state["labels"]:
            state["labels"].append(a["name"])
        return {"id": a["name"], "name": a["name"]}
    if tool == "list_issue_labels":
        all_labels = set(state["labels"]).union(*(r["labels"] for r in state["issues"].values()))
        return [{"id": k, "name": k} for k in sorted(all_labels)]
    if tool == "list_issues":
        rows = (r for r in state["issues"].values()
                if a.get("state", a.get("status", r["status"])) == r["status"]
                and a.get("team", "KIT") == "KIT" and a.get("project", PROJECT) in ("timer-kit", PROJECT)
                and ("label" not in a or a["label"] in r["labels"])
                and a.get("query", "").casefold() in " ".join(r[k] for k in ("identifier", "title", "description")).casefold())
        results = [view(state, r) for r in rows]
        limit = max(0, a.get("limit", len(results)))
        return {"issues": results[:limit], "pageInfo": {"hasNextPage": len(results) > limit}}
    if tool == "create_issue":
        key = "KIT-" + str(max(int(k.split("-")[1]) for k in state["issues"]) + 1)
        row = issue(key, a["title"], "", [], [])
        state["issues"][key] = row
        return update(state, row, a)
    if tool in ("get_issue", "update_issue", "create_relation"):
        row = get(state, a.get("id", a.get("issueId")))
        if tool == "update_issue":
            return update(state, row, a)
        if tool == "create_relation":
            relate(state, row, a["type"], a["relatedIssueId"])
        return view(state, row)
    key = a.get("issueId")
    if key is None:
        table = "comments" if tool == "update_comment" else "attachments"
        key = base.select(state[table], a.get("id", a.get("attachmentId")))["issueId"]
    row = get(state, key)
    partition = {k: [i for i in state[k] if i["issueId"] == row["id"]] for k in ("comments", "attachments", "reviews")}
    if tool == "submit_spec_review":
        attachment = base.select(partition["attachments"], a["attachmentId"])
        prior = next((r for r in partition["reviews"] if r["sha256"] == attachment["sha256"]), None)
        if prior:
            return prior
        result = {"issueId": row["id"], "attachmentId": attachment["id"], "sha256": attachment["sha256"],
                  "verdict": "approve" if attachment["content"].strip() else "revise",
                  "objections": [] if attachment["content"].strip() else ["Supply a nonempty spec."],
                  "round": len(partition["reviews"]) + 1}
        state["reviews"].append(result)
        return result
    value = base.apply({"issue": row, **partition}, tool, a)
    for k in partition:
        state[k] = [i for i in state[k] if i["issueId"] != row["id"]] + partition[k]
    return value


def call(path, tool, args):
    if not path.exists():
        raise ValueError("Tracker not initialized")
    options = argparse.Namespace(state=path)
    with base.store(options) as stored:
        state = copy.deepcopy(stored)
        op = {"tool": tool, "arguments": args, "at": base.now(), "sequence": len(stored["operations"]) + 1}
        try:
            schema = TOOLS[tool]["inputSchema"]
            if (not isinstance(args, dict) or set(args) - schema["properties"].keys()
                    or set(schema["required"]) - args.keys()):
                raise ValueError("Invalid arguments for " + tool)
            value = dispatch(state, tool, args)
            rows = value.get("issues", [value]) if isinstance(value, dict) else []
            op["observed"] = [{k: r[k] for k in ("identifier", "status", "open_blockers")} for r in rows if "open_blockers" in r]
            if isinstance(value, dict):
                op["result_id"] = value.get("id", value.get("attachmentId"))
            op["ok"] = True
            stored.update(state)
        except (KeyError, ValueError, TypeError, AttributeError) as exc:
            op.update(ok=False, error=str(exc))
        stored["operations"].append(op)
    if not op["ok"]:
        raise ValueError(op["error"])
    return value


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--state", type=Path, required=True)
    p.add_argument("--init", action="store_true")
    args = p.parse_args()
    if args.init:
        init(args.state)
        return
    # Reuse the existing qualification MCP handshake, discovery and error envelopes.
    base.TOOLS.update(TOOLS)
    base.call = lambda opts, tool, params: call(opts.state, tool, params)
    for line in sys.stdin:
        request = json.loads(line)
        reply = base.rpc(args, request)
        if reply is not None:
            print(json.dumps(reply), flush=True)


if __name__ == "__main__":
    main()
