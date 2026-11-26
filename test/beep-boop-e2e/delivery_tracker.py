#!/usr/bin/env python3
"""Disposable stdio MCP tracker and scripted reviewer. All data is confined to --state."""
import argparse
import base64
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import uuid


def schema(description, properties, required=()):
    return {"description": description, "inputSchema": {"type": "object", "properties": properties,
            "required": list(required), "additionalProperties": False}}


S = {"type": "string"}
LABELS = {"type": "array", "items": S}
TOOLS = {
    "get_issue": schema("Read a fixture issue by identifier or id, including current labels, status, and attachments.",
                        {"id": S, "includeRelations": {"type": "boolean"}}, ["id"]),
    "list_issues": schema("List fixture issues, optionally filtering by status, team, or query.",
                         {"status": S, "team": S, "query": S, "limit": {"type": "integer"}}),
    "update_issue": schema("Update fixture issue fields. Labels replace the list when provided.",
                           {"id": S, "title": S, "description": S, "status": S, "state": S, "labels": LABELS}, ["id"]),
    "list_issue_statuses": schema("List workflow statuses.", {"team": S}),
    "list_issue_labels": schema("List available issue labels.", {"team": S}),
    "list_comments": schema("Read the issue's comment thread.", {"issueId": S}, ["issueId"]),
    "create_comment": schema("Append a comment to the issue.", {"issueId": S, "body": S}, ["issueId", "body"]),
    "update_comment": schema("Edit an existing fixture comment.", {"id": S, "body": S}, ["id", "body"]),
    "create_attachment": schema("Attach a spec to the issue. Provide UTF-8 content or base64Content. Every version gets its own id.",
                               {"issueId": S, "filename": S, "title": S, "content": S, "base64Content": S,
                                "contentType": S, "subtitle": S}, ["issueId", "filename"]),
    "list_attachments": schema("List attachment versions, titles and hashes.", {"issueId": S}, ["issueId"]),
    "get_attachment": schema("Read full attachment text and its digest.", {"id": S}, ["id"]),
    "submit_spec_review": schema("Send a specific attachment revision to the fixture's independent spec reviewer.",
                                {"attachmentId": S}, ["attachmentId"]),
}
STATES = {"Backlog": "backlog", "Todo": "unstarted", "In Progress": "started", "In Review": "started", "Done": "completed"}


def now():
    return datetime.now(timezone.utc).isoformat()


def initial(args):
    issue = {"id": str(uuid.uuid5(uuid.NAMESPACE_URL, "qualification/" + args.issue)),
             "identifier": args.issue, "title": args.title, "description": args.description,
             "team": args.issue.rsplit("-", 1)[0], "status": "Backlog", "labels": ["faff-automate"]}
    return {"issue": issue, "comments": [], "attachments": [], "reviews": [], "operations": []}


@contextmanager
def store(args):
    args.state.parent.mkdir(parents=True, exist_ok=True)
    with args.state.with_suffix(".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = json.loads(args.state.read_text()) if args.state.exists() else initial(args)
        yield state
        with tempfile.NamedTemporaryFile(mode="w", dir=args.state.parent, delete=False) as f:
            json.dump(state, f, indent=2)
            f.write("\n")
        os.replace(f.name, args.state)


def select(rows, key):
    for row in rows:
        if row["id"] == key:
            return row
    raise ValueError("Unknown fixture record: " + key)


def metadata(row):
    return {k: v for k, v in row.items() if k != "content"}


def issue_view(state):
    row = state["issue"]
    return {**row, "state": row["status"], "statusType": STATES[row["status"]],
            "attachments": [metadata(a) for a in state["attachments"]]}


def review(state, attachment):
    prior = next((r for r in state["reviews"] if r["sha256"] == attachment["sha256"]), None)
    if prior:
        return prior
    # The scripted round checks an explicit, machine-verifiable acceptance example.
    # Both Object.is and the exact expected sign distinguish zero from negative zero in JS.
    acceptance = re.search(r"Object\.is\(\s*[\w.$]+\(\s*-0\s*\)\s*,\s*-0\s*\)", attachment["content"])
    approved = bool(state["reviews"] and acceptance)
    objections = [] if approved else [
        {"lens": "QA", "severity": "major", "claim": "Preserve JavaScript negative zero. Give a positive acceptance example "
         "using Object.is(<publicFunction>(-0), -0) that must evaluate to true. Resubmit the revised attachment."}]
    result = {"attachmentId": attachment["id"], "sha256": attachment["sha256"],
              "verdict": "approve" if approved else "revise", "objections": objections,
              "round": len(state["reviews"]) + 1}
    state["reviews"].append(result)
    return result


def apply(state, name, a):
    spec = TOOLS[name]["inputSchema"]
    if not isinstance(a, dict) or set(a) - set(spec["properties"]) or set(spec["required"]) - set(a):
        raise ValueError(f"Invalid arguments for {name}")
    for k, v in a.items():
        kind = spec["properties"][k]["type"]
        if not ((kind == "string" and isinstance(v, str)) or (kind == "boolean" and type(v) is bool)
                or (kind == "integer" and type(v) is int) or (kind == "array" and isinstance(v, list)
                and all(isinstance(x, str) for x in v))):
            raise ValueError("Wrong value type for " + k)
    row = state["issue"]
    key = a.get("issueId", a.get("id") if name in ("get_issue", "update_issue") else None)
    if key is not None and key not in (row["identifier"], row["id"]):
        raise ValueError("Issue outside fixture")
    if name == "get_issue":
        return issue_view(state)
    if name == "list_issues":
        hit = (a.get("status", row["status"]) == row["status"] and a.get("team", row["team"]) == row["team"]
               and a.get("query", "").lower() in (row["identifier"] + " " + row["title"] + " " + row["description"]).lower())
        return {"issues": [issue_view(state)] if hit and a.get("limit", 1) > 0 else [],
                "pageInfo": {"hasNextPage": False}}
    if name == "update_issue":
        status = a.get("status", a.get("state", row["status"]))
        if status not in STATES:
            raise ValueError("Unknown issue status")
        row.update({k: a[k] for k in ("title", "description", "labels") if k in a}, status=status)
        return issue_view(state)
    if name == "list_issue_statuses":
        return [{"id": k, "name": k, "type": v} for k, v in STATES.items()]
    if name == "list_issue_labels":
        return [{"id": k, "name": k} for k in sorted(set(row["labels"]) | {"faff-automate", "faff-claimed"})]
    if name == "list_comments":
        return state["comments"]
    if name in ("create_comment", "update_comment"):
        if name == "create_comment":
            obj = {"id": str(uuid.uuid4()), "issueId": row["id"], "createdAt": now(),
                   "author": {"id": "fixture-agent", "name": "Qualification worker"}}
            state["comments"].append(obj)
        else:
            obj = select(state["comments"], a["id"])
        obj["body"] = a["body"]
        return obj
    if name == "create_attachment":
        if ("content" in a) == ("base64Content" in a):
            raise ValueError("Specify exactly one attachment body")
        body = a["content"] if "content" in a else base64.b64decode(a["base64Content"], validate=True).decode("utf8")
        obj = {"id": str(uuid.uuid4()), "issueId": row["id"], "createdAt": now(),
               "filename": a["filename"], "title": a.get("title", a["filename"]), "content": body,
               "sha256": hashlib.sha256(body.encode()).hexdigest()}
        state["attachments"].append(obj)
        return metadata(obj)
    if name == "list_attachments":
        return [metadata(obj) for obj in state["attachments"]]
    if name == "get_attachment":
        return select(state["attachments"], a["id"])
    return review(state, select(state["attachments"], a["attachmentId"]))


def call(args, name, params):
    with store(args) as state:
        try:
            value = apply(state, name, params)
            row = {"tool": name, "arguments": params, "ok": True, "at": now()}
            if isinstance(value, dict):
                row["result_id"] = value.get("id", value.get("attachmentId"))
            state["operations"].append(row)
            return value
        except (KeyError, ValueError, TypeError) as exc:
            error = str(exc)
            state["operations"].append({"tool": name, "arguments": params, "ok": False, "error": error, "at": now()})
    raise ValueError(error)


def rpc(args, request):
    method = request.get("method")
    if "id" not in request:
        return
    reply = {"jsonrpc": "2.0", "id": request["id"]}
    params = request.get("params", {})
    if method == "initialize":
        supported = {"2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"}
        version = params.get("protocolVersion")
        result = {"protocolVersion": version if version in supported else "2025-06-18",
                  "capabilities": {"tools": {}}, "serverInfo": {"name": "qualification-tracker", "version": "1"}}
    elif method == "ping":
        result = {}
    elif method == "tools/list":
        result = {"tools": [{"name": name, **definition} for name, definition in TOOLS.items()]}
    elif method == "tools/call":
        try:
            value = call(args, params["name"], params.get("arguments", {}))
            result = {"content": [{"type": "text", "text": json.dumps(value)}]}
        except (KeyError, ValueError) as exc:
            result = {"isError": True, "content": [{"type": "text", "text": str(exc)}]}
    else:
        return {**reply, "error": {"code": -32601, "message": "Unknown method"}}
    return {**reply, "result": result}


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--state", required=True, type=Path)
    p.add_argument("--issue", default="KIT-17")
    p.add_argument("--title", default="Clamp negative retry counts")
    p.add_argument("--description", default="Clamp negative retry counts to zero. Preserve positive counts, zero and the existing public API.")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--init", action="store_true")
    mode.add_argument("--dump", action="store_true")
    mode.add_argument("--call", choices=TOOLS)
    p.add_argument("--arguments", default="{}")
    args = p.parse_args()
    if args.init or args.dump:
        with store(args) as state:
            print(json.dumps(state))
    elif args.call:
        try:
            print(json.dumps(call(args, args.call, json.load(sys.stdin) if args.arguments == "-" else json.loads(args.arguments))))
        except ValueError as err:
            sys.exit(str(err))
    else:
        for line in sys.stdin:
            try:
                result = rpc(args, json.loads(line))
            except (ValueError, TypeError, AttributeError):
                result = {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Invalid request"}}
            if result:
                print(json.dumps(result), flush=True)
