import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../plugin/skills/faff/bin/faff", import.meta.url));

function cli(root, args, input) {
  const env = { ...process.env };
  for (const name of ["FAFF_RUN_DIR", "FAFF_SESSION_ID", "FAFF_DECISION_CORRELATION_ID", "FAFF_DECISION_ISSUE"]) delete env[name];
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: root, env, input: input === undefined ? undefined : JSON.stringify(input), encoding: "utf8",
  });
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "faff-next-prep-queue-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
  writeFileSync(join(root, ".faffrc.yaml"), [
    "tracking:", "  label_prefix: mini", "  control_labels:",
    "    automate: green-light", "    parked: manual-hold", "",
  ].join("\n"));
  return root;
}

const issue = (id, fields = {}) => ({
  id, status: "backlog", spec: "none", labels: ["green-light"], blocked: false, ...fields,
});
const snapshot = (issues, fields = {}) => ({ complete: true, issues, ...fields });
const args = ["next", "prep-queue"];

test("prep-queue preserves scoped dispatch order and the real per-issue next/eligibility outcomes", (t) => {
  const root = fixture(t);
  const issues = [
    issue("RUN-3"),
    issue("RUN-8", { status: "todo" }),
    issue("RUN-9", { spec: "high", awaiting_spec_review: true }),
    issue("RUN-6", { spec: "medium", labels: ["green-light", "mini-awaiting-spec-review"] }),
    issue("RUN-20", { spec: "high", labels: ["green-light", "manual-hold"], awaiting_spec_review: true }),
    issue("RUN-4", { labels: ["faff-automate"] }),
    issue("RUN-7", { status: "todo", spec: "high" }),
    issue("RUN-5", { status: "cancelled" }),
    issue("RUN-1", { status: "done" }),
    issue("RUN-2", { status: "duplicate" }),
  ];
  const ids = [];
  for (const row of issues) {
    const eligible = cli(root, ["eligible", ...row.labels.flatMap((label) => ["--label", label])]);
    assert.equal(eligible.status, 0, eligible.stderr);
    const result = cli(root, [
      "next", "--status", row.status, "--spec", row.spec,
      ...(eligible.stdout.trim() === "true" ? [] : ["--not-eligible"]),
      ...(row.labels.includes("manual-hold") ? ["--parked"] : []),
      ...(row.awaiting_spec_review || row.labels.includes("mini-awaiting-spec-review") ? ["--awaiting-spec-review"] : []),
    ]);
    assert.equal(result.status, 0, result.stderr);
    if (JSON.parse(result.stdout).next === "prep") ids.push(row.id);
  }
  assert.deepEqual(ids, ["RUN-3", "RUN-8", "RUN-9", "RUN-6"]);
  const result = cli(root, [...args, "--root", root], snapshot([
    ...issues, issue("RUN-12", { blocked: true }), issue("RUN-13", { status: "in-progress" }),
  ]));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { prep: ids });
});

test("prep-queue agrees with Graft's real prep handoff on the same observed state", (t) => {
  const root = fixture(t);
  const issues = [issue("RUN-3"), issue("RUN-6", { labels: [] }), issue("RUN-7", { labels: ["green-light", "manual-hold"] })];
  const result = cli(root, args, snapshot(issues));
  assert.equal(result.status, 0, result.stderr);
  const got = JSON.parse(result.stdout).prep;
  for (const row of issues) {
    const admit = cli(root, ["graft", "admit", "--mode", "autonomous", "--facts", "-", "--root", root, "--json"], {
      issue: row.id, status: row.status, labels: row.labels,
      spec: { found: false, confidence: "none" }, externally_blocked: false,
      claimed_at: null, tracker: { mode: "tracker", configured: true, pinned: false, reachable: true },
    });
    assert.equal(admit.status, 0, admit.stderr);
    assert.equal(got.includes(row.id), JSON.parse(admit.stdout).disposition === "needs-prep");
  }
});

test("prep-queue fails closed on partial snapshots, malformed rows, and invalid options", (t) => {
  const root = fixture(t);
  const result = cli(root, args, snapshot([]));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { prep: [] });
  for (const input of [
    snapshot([], { complete: false }),
    snapshot([], { complete: undefined }),
    snapshot([issue("RUN-1"), issue("run-1")]),
    snapshot([issue("RUN-1", { blocked: undefined })]),
    snapshot([issue("RUN-1", { labels: [null] })]),
    snapshot([issue("RUN-1", { awaiting_spec_review: "no" })]),
    snapshot([issue("RUN-1", { spec: "unknown" })]),
  ]) {
    const failed = cli(root, args, input);
    assert.equal(failed.status, 2, failed.stderr);
    assert.equal(failed.stdout, "");
    assert.match(failed.stderr, /faff next prep-queue/);
  }
  const invalid = cli(root, [...args, "--unknown"], snapshot([]));
  assert.equal(invalid.status, 2);
  assert.equal(invalid.stdout, "");
});

test("the normal prep queue uses the batch and retains its per-issue fallback", () => {
  const prompt = readFileSync(new URL("../plugin/skills/faff-beep-boop/SKILL.md", import.meta.url), "utf8");
  const queue = prompt.slice(prompt.indexOf("### 2. Prep queue build"), prompt.indexOf("### 3. Prep queue drain"));
  assert.match(queue, /faff next prep-queue/);
  assert.match(queue, /Dispatch the returned `prep` IDs/);
  assert.match(queue, /On a batch error with complete observations.+per-issue transition/);
});

test("wave prep includes reachable dependents and respects every external blocker", t => {
  const blocked = (id, ...ids) => issue(id, { blocked: true, open_blockers: ids });
  const result = cli(fixture(t), args, snapshot([
    blocked("KIT-18", "KIT-17"), blocked("KIT-19", "KIT-20"),
    issue("KIT-20", { labels: [] }), issue("KIT-17"),
    blocked("KIT-22", "KIT-18", "KIT-19"), blocked("KIT-23", "KIT-24"),
    blocked("KIT-24", "KIT-23"), blocked("KIT-25", "outside"),
    blocked("KIT-26", "KIT-18", "KIT-27"), issue("KIT-27", { status: "todo", spec: "high" }),
  ]));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).prep, ["KIT-18", "KIT-17", "KIT-26"]);
});

test("prep plan retains waits through specced issues and admits independent roots together", t => {
  const blocked = (id, blockers, facts = {}) => issue(id, { blocked: true, open_blockers: blockers, ...facts });
  const result = cli(fixture(t), [...args, "--plan"], snapshot([
    blocked("C", ["bridge"]), blocked("bridge", ["a"], { status: "todo", spec: "high" }),
    issue("A"), issue("B"), blocked("D", ["outside"]),
  ]));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    prep: ["C", "A", "B"], wait_for: { C: ["A"], A: [], B: [] },
  });
});
