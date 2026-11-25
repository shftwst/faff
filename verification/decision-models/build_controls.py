"""Build or verify the small, executable counterexamples for the decision-model study."""
import argparse
import hashlib
import json
from dataclasses import dataclass
from difflib import unified_diff
from pathlib import Path
from textwrap import dedent


def source(text):
    return dedent(text).strip() + "\n"


@dataclass(frozen=True)
class Family:
    group: str
    claim: str
    entry: str
    old: str
    repaired: str
    surviving: str
    common: str
    target: str
    want: object
    adjacent: str
    adjacent_want: object


FAMILIES = [
    Family(
        "control-delivery-retry",
        "When job A is delivered twice through run(), the outbox ends with one A.",
        "def run(outbox, job):\n    return append_once(outbox, job)",
        "def run(outbox, job):\n    outbox.append(job)",
        "def append_once(outbox, job):\n    if job not in outbox:\n        outbox.append(job)",
        "def append_once(outbox, job):\n    if job:\n        outbox.append(job)",
        """
        def deliver(jobs):
            outbox = []
            for job in jobs:
                run(outbox, job)
            return outbox
        """,
        'deliver(["A", "A"])', ["A"], 'deliver(["A", "B"])', ["A", "B"],
    ),
    Family(
        "control-page-continuation",
        "When page 1 has no eligible rows and points to page 2, collect() returns the eligible row on page 2.",
        """
        def collect(pages):
            page, found = 1, []
            while page is not None:
                rows, cursor = pages[page]
                found.extend(rows)
                page = advance(rows, cursor)
            return found
        """,
        """
        def collect(pages):
            found = []
            for rows, _ in pages.values():
                if not rows:
                    break
                found.extend(rows)
            return found
        """,
        "def advance(rows, cursor):\n    return cursor",
        "def advance(rows, cursor):\n    return cursor if rows else None",
        "def first(rows):\n    return {1: (rows, None)}",
        'collect({1: ([], 2), 2: (["R"], None)})', ["R"],
        'collect(first(["R"]))', ["R"],
    ),
    Family(
        "control-revision-match",
        "After revision b replaces revision a on the same branch, lookup() returns no approval from the record for a.",
        """
        def lookup(record, branch, revision):
            return record["vote"] if matches(record, branch, revision) else None
        """,
        """
        def lookup(record, branch, revision):
            return record["vote"] if record["branch"] == branch else None
        """,
        """
        def matches(record, branch, revision):
            return (branch, revision) == (record["branch"], record["revision"])
        """,
        """
        def matches(record, branch, revision):
            return branch == record["branch"] and bool(revision)
        """,
        'def approval():\n    return {"branch": "topic", "revision": "a", "vote": "allow"}',
        'lookup(approval(), "topic", "b")', None,
        'lookup(approval(), "topic", "a")', 'allow',
    ),
    Family(
        "control-display-rounding",
        "The agreed cash display rule rounds 125 cents to 130 cents in ten-cent increments.",
        "def display(cents):\n    return 10 * units(cents)",
        "def display(cents):\n    return (cents // 10) * 10",
        "def units(cents):\n    return (cents + 5) // 10",
        "def units(cents):\n    return round(cents / 10)",
        "def amount(whole, cents):\n    return whole * 100 + cents",
        "display(amount(1, 25))", 130, "display(amount(1, 24))", 120,
    ),
    Family(
        "control-lease-transfer",
        "With slot 3 reassigned from Ana to Bo, Ana's late completion leaves Bo's lease in slot 3.",
        """
        def finish(leases, slot, actor):
            if releasable(leases, slot, actor):
                del leases[slot]
            return leases
        """,
        """
        def finish(leases, slot, actor):
            leases.pop(slot, None)
            return leases
        """,
        "def releasable(leases, slot, actor):\n    return leases.get(slot) == actor",
        "def releasable(leases, slot, actor):\n    return slot in leases",
        """
        def current():
            leases = {3: "Ana"}
            leases[3] = "Bo"
            return leases
        """,
        'sorted(finish(current(), 3, "Ana").items())', [(3, "Bo")],
        'sorted(finish(current(), 3, "Bo").items())', [],
    ),
    Family(
        "control-retry-budget",
        "A failed second attempt ends a job whose configured limit is two total attempts.",
        """
        def next_step(attempt, limit, passed):
            if passed:
                return "done"
            return "retry" if remaining(attempt, limit) else "stop"
        """,
        """
        def next_step(attempt, limit, passed):
            if passed:
                return "done"
            return "retry" if attempt <= limit else "stop"
        """,
        "def remaining(attempt, limit):\n    return attempt < limit",
        "def remaining(attempt, limit):\n    return attempt <= limit",
        "def settings():\n    return {'attempts': 2}",
        "next_step(2, settings()['attempts'], False)", "stop",
        "next_step(1, settings()['attempts'], False)", "retry",
    ),
]


def execute(family, entry, decision, expression):
    # Only these local fixture definitions execute. Model packets and predictions never do.
    local = {}
    for excerpt in (family.common, decision, entry):
        exec(source(excerpt), local)
    return eval(expression, local)


def diff(before, after):
    return "".join(unified_diff(
        source(before).splitlines(keepends=True), source(after).splitlines(keepends=True),
        fromfile="a/entry.py", tofile="b/entry.py",
    ))


def packet(family, decision, show_decision, expression):
    excerpt = "Test setup:\n" + source(family.common)
    if show_decision:
        excerpt = "Additional excerpt from entry.py:\n" + source(decision) + "\n" + excerpt
    observed = execute(family, family.entry, decision, expression)
    check = f"Executed check in this revision:\nassert {expression} == {observed!r}\nResult: passed."
    if family.group == "control-display-rounding" and expression == family.target:
        check += f"\nPrevious assertion for this example: assert {expression} == {family.want!r}"
    return [
        {"id": "E1", "text": diff(family.old, family.entry)},
        {"id": "E2", "text": excerpt},
        {"id": "E3", "text": check},
    ]


def build():
    cases = []
    for index, family in enumerate(FAMILIES):
        old = execute(family, family.old, family.repaired, family.target)
        repaired = execute(family, family.entry, family.repaired, family.target)
        surviving = execute(family, family.entry, family.surviving, family.target)
        if old == family.want or surviving == family.want or repaired != family.want:
            raise ValueError(f"Regression witness failed: {family.group}")
        for decision in (family.repaired, family.surviving):
            if execute(family, family.entry, decision, family.adjacent) != family.adjacent_want:
                raise ValueError(f"Neighbouring test failed: {family.group}")
        # The incomplete packet is observationally identical under both possible implementations.
        incomplete = packet(family, family.repaired, False, family.adjacent)
        if incomplete != packet(family, family.surviving, False, family.adjacent):
            raise ValueError(f"Missing-evidence case exposes its implementation: {family.group}")
        for label, decision, verdict_value in (
            ("supported", family.repaired, repaired),
            ("contradicted", family.surviving, surviving),
            ("insufficient", None, None),
        ):
            if decision is None:
                evidence = incomplete
                basis = (f"The two completions both pass {family.adjacent}, and produce the same "
                         f"three displayed records. On {family.target} one returns {repaired!r} "
                         f"and the other returns {surviving!r}.")
            else:
                # Vary whether code or a direct observation resolves the claim across families.
                show_decision = (index + (label == "contradicted")) % 3 != 0
                expression = family.adjacent if show_decision else family.target
                if family.group == "control-display-rounding":
                    expression = family.target
                evidence = packet(family, decision, show_decision, expression)
                basis = (f"The baseline returns {old!r}. Executing {family.target} in the "
                         f"displayed revision yields {verdict_value!r}. The claim requires {family.want!r}.")
            digest = hashlib.sha256(json.dumps(evidence, sort_keys=True).encode()).hexdigest()
            cases.append(dict(id="ctrl-" + digest[:12], group=family.group, claim=family.claim,
                              evidence=evidence, expected=label, basis=basis))
    return sorted(cases, key=lambda case: case["id"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="Regenerate controls.json")
    args = parser.parse_args()
    target = Path(__file__).with_name("controls.json")
    cases = build()
    contents = json.dumps(cases, indent=2, ensure_ascii=False) + "\n"
    if args.write:
        target.write_text(contents)
    elif target.read_text() != contents:
        raise SystemExit("controls.json differs from the replayed cases")
    print(f"{len(cases)} cases across {len(FAMILIES)} families verified")
