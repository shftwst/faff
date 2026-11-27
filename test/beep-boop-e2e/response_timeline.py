"""Observe complete stream-json records without retaining prompt or tool contents."""
import json
import re
import threading
from datetime import datetime, timezone


def record(event, at):
    if event.get("type") != "assistant":
        return None
    message = event.get("message", {})
    if not message.get("id"):
        return None
    calls = []
    for block in message.get("content", []):
        if block.get("type") != "tool_use":
            continue
        name = block.get("name")
        args = block.get("input", {})
        # Record issue keys and known command categories only.
        keys = sorted(set(re.findall(r"\bKIT-\d+\b", str(args.get("description", "")) +
                                    " " + str(args.get("id", "")) + " " + str(args.get("command", "")))))
        cmd = str(args.get("command", ""))
        categories = [tag for tag in ("heartbeat", "sentry", "checkpoint", "run-ledger",
                      "evidence", "decision-capture", "git ", "gh pr", "npm test")
                      if tag in cmd]
        calls.append({"id": block.get("id"), "name": name, "issues": keys, "categories": categories})
    usage = {k: v for k, v in (message.get("usage") or {}).items() if isinstance(v, int)}
    return {"at": at, "response": message["id"], "parent": event.get("parent_tool_use_id"),
            "model": message.get("model"), "tools": calls, "usage": usage}


class Timeline:
    def __init__(self, raw, target):
        self.raw = raw
        self.target = target
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self.observe)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.stop.set()
        self.thread.join()

    def observe(self):
        with self.raw.open("rb") as source, self.target.open("x") as out:
            while True:
                start = source.tell()
                line = source.readline()
                if line.endswith(b"\n"):
                    try:
                        row = record(json.loads(line), datetime.now(timezone.utc).isoformat())
                    except ValueError:
                        continue
                    if row:
                        print(json.dumps(row), file=out, flush=True)
                elif self.stop.is_set():
                    break
                else:
                    source.seek(start)
                    self.stop.wait(0.2)
