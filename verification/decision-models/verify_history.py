"""Verify the historical evidence against objects in a full local Git checkout."""
import argparse
from functools import lru_cache
import json
from pathlib import Path
import re
import subprocess
import sys


def unique_fields(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate field {key!r}")
        result[key] = value
    return result


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_fields)


def verify(directory, repo):
    cases = read_json(directory / "history-cases.json")
    sources = read_json(directory / "history-sources.json")
    ids = [case["id"] for case in cases]
    if not ids or len(ids) != len(set(ids)) or set(ids) != set(sources):
        raise ValueError("case IDs must be unique and match source IDs")

    @lru_cache(maxsize=None)
    def git(*args):
        return subprocess.check_output(
            ["git", "-C", str(repo), *args], stderr=subprocess.PIPE
        )

    commits = set()
    count = 0
    for case in cases:
        case_id = case["id"]
        entry = sources[case_id]
        commit = entry["commit"]
        if not re.fullmatch("[0-9a-f]{40}", commit):
            raise ValueError(f"{case_id}: expected a full Git commit ID")
        if git("cat-file", "-t", commit).strip() != b"commit":
            raise ValueError(f"{case_id}: {commit} is not a commit")
        commits.add(commit)
        ranges = entry["excerpts"]
        if not ranges or len(ranges) != len(case["evidence"]):
            raise ValueError(f"{case_id}: evidence count differs from source ranges")
        for index, (span, evidence) in enumerate(zip(ranges, case["evidence"]), 1):
            name = span["path"]
            blob = git("rev-parse", "--verify", f"{commit}:{name}").strip().decode()
            if blob != span["blob"]:
                raise ValueError(f"{case_id} E{index}: wrong blob for {name}")
            lines = git("cat-file", "blob", blob).decode("utf-8").splitlines()
            first, last = span["first"], span["last"]
            if type(first) is not int or type(last) is not int or not 1 <= first <= last <= len(lines):
                raise ValueError(f"{case_id} E{index}: invalid line range for {name}")
            exact = name + "\n" + "\n".join(lines[first - 1:last])
            if evidence["id"] != f"E{index}" or evidence["text"] != exact:
                raise ValueError(f"{case_id} E{index}: evidence differs from {name}:{first}-{last}")
            count += 1
    return len(ids), count, len(commits)


def main():
    directory = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=directory, help="Git checkout containing the historical commits")
    args = parser.parse_args()
    try:
        cases, excerpts, commits = verify(directory, args.repo)
    except subprocess.CalledProcessError as error:
        print("Git could not resolve the source in the selected checkout.", file=sys.stderr)
        print(error.stderr.decode(errors="replace").strip(), file=sys.stderr)
        return 1
    except (ValueError, KeyError, OSError, TypeError) as error:
        print(f"Historical evidence check failed: {error}", file=sys.stderr)
        return 1
    print(f"Verified {excerpts} source excerpts for {cases} cases at {commits} commits.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
