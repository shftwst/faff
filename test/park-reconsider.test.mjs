// FAFF-993 — the git-only Unpark contract: the pure re-entry decision (`classifyReEntry`), the
// symlink-safe repo-root confinement (`confine`), and the shared `apply_git_only_unpark` write helper
// parameterised by ledger-write authority (own-live-run autonomous / cross-run-readonly interactive).
// In-process requires of the factory lib; real on-disk markers + ledgers under a temp root.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const pr = require(join(REPO, "plugin", "skills", "faff", "bin", "lib", "park-reconsider.js"));
const { EVENT_TYPES, EVENT_ISSUE_SCOPED } = require(join(REPO, "plugin", "skills", "faff", "bin", "lib", "events.js"));

const NOW = "2026-09-05T12:00:00Z";
const NOW_MS = Date.parse(NOW);
const BEFORE = "2026-09-01T00:00:00Z"; // parked strictly before NOW

function freshRoot() { return mkdtempSync(join(tmpdir(), "pr993-")); }

// Build a git-only prep marker with a machine park + a config-file cited input at `ref`.
function writeMarker(root, key, { runDir, disposition = "parked", fingerprint = "sha256:old", ref = ".faffrc.yaml" } = {}) {
  const dir = join(root, ".faff", "prep");
  mkdirSync(dir, { recursive: true });
  const marker = {
    issue: key, spec_produced: true, attached: false, disposition,
    owner: runDir ? { run_dir: runDir } : {},
    park: { reconsider: "machine", cause_class: "config-fault", parked_at: BEFORE,
            cited_input: { kind: "config-file", ref, keys: ["k"], fingerprint } },
  };
  writeFileSync(join(dir, `${key}.json`), JSON.stringify(marker, null, 2) + "\n");
  return marker;
}
function readMarker(root, key) { return JSON.parse(readFileSync(join(root, ".faff", "prep", `${key}.json`), "utf8")); }

// Build a run dir with a run-ledger.json. `ownerStatus`/`heartbeat` drive runIsHeld for the interactive
// cross-run branches; `outcomes` seeds the own-live-run clear. `malformed` writes unparseable bytes.
function writeRunDir(root, runId, { outcomes = {}, ownerStatus = "done", heartbeat = BEFORE, malformed = false } = {}) {
  const runDir = join(root, ".faff", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  if (malformed) writeFileSync(join(runDir, "run-ledger.json"), "{ this is not json ");
  else writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({
    run_id: runId, admitted: Object.keys(outcomes), outcomes,
    owner: { status: ownerStatus, session_id: "s", epoch: 1, last_heartbeat: heartbeat },
  }, null, 2) + "\n");
  return runDir;
}

// ---------------------------------------------------------------------------
// classifyReEntry — the fail-closed pure decision (spec §3 "The re-entry decision").
// ---------------------------------------------------------------------------
test("classifyReEntry: machine park + changed in-root fingerprint → reconsider", () => {
  const cause = { reconsider: "machine", parked_at: BEFORE, cited_input: { kind: "config-file", ref: ".faffrc.yaml", fingerprint: "sha256:a" } };
  assert.deepEqual(pr.classifyReEntry(cause, "sha256:b", true, NOW), { reconsider: true, reason: "input-changed" });
});
test("classifyReEntry: fail-closed table (human / unchanged / out-of-root / unreadable)", () => {
  const m = (fp) => ({ reconsider: "machine", parked_at: BEFORE, cited_input: { kind: "config-file", ref: ".faffrc.yaml", fingerprint: fp } });
  assert.equal(pr.classifyReEntry({ reconsider: "human", cited_input: null }, "sha256:x", true, NOW).reason, "human-park");
  assert.equal(pr.classifyReEntry({ cause_class: "x", parked_at: BEFORE }, "sha256:x", true, NOW).reason, "human-park"); // legacy record
  assert.equal(pr.classifyReEntry(m("sha256:a"), "sha256:a", true, NOW).reason, "input-unchanged");
  assert.equal(pr.classifyReEntry(m("sha256:a"), "sha256:b", false, NOW).reason, "ref-outside-repo-root"); // fail-closed
  assert.equal(pr.classifyReEntry(m("sha256:a"), null, true, NOW).reason, "fingerprint-unreadable");       // fail-closed
  for (const r of ["human-park", "input-unchanged", "ref-outside-repo-root", "fingerprint-unreadable", "input-changed"]) assert.ok(pr.REENTRY_REASONS.has(r));
});

// ---------------------------------------------------------------------------
// confine — symlink-safe repo-root containment (spec §"Repo-root confinement"). The lexical
// resumecheck model would pass an in-root symlink escaping the tree; realpath containment rejects it.
// ---------------------------------------------------------------------------
test("confine: in-root true, parent-escape false, in-root symlink escaping the tree false", () => {
  const root = freshRoot();
  writeFileSync(join(root, "real.txt"), "x");
  assert.equal(pr.confine(root, "real.txt"), true);
  assert.equal(pr.confine(root, "../../../etc"), false);
  assert.equal(pr.confine(root, null), false);
  // an in-root path that is a symlink resolving OUTSIDE the repo root must fail closed
  const outside = mkdtempSync(join(tmpdir(), "pr993-out-"));
  writeFileSync(join(outside, "secret"), "s");
  mkdirSync(join(root, ".faff", "tmp"), { recursive: true });
  symlinkSync(join(outside, "secret"), join(root, ".faff", "tmp", "link"));
  assert.equal(pr.confine(root, ".faff/tmp/link"), false, "an escaping symlink is rejected before any read");
});

// ---------------------------------------------------------------------------
// apply_git_only_unpark — own-live-run (autonomous): ledger outcome cleared FIRST, then the marker.
// ---------------------------------------------------------------------------
test("own-live-run: clears the ledger `parked` outcome then the marker, returns the event", () => {
  const root = freshRoot();
  const runDir = writeRunDir(root, "run-A", { outcomes: { "FAFF-1": "parked" } });
  const marker = writeMarker(root, "FAFF-1", { runDir });
  const res = pr.apply_git_only_unpark(root, marker, "FAFF-1", marker.park, "resume-reconsider", "sha256:old", "sha256:new", "own-live-run", NOW_MS);
  assert.equal(res.unparked, true);
  assert.equal(res.ledger_cleared, true);
  assert.equal(res.event.type, "park-reconsidered");
  assert.equal(res.event.data.via, "resume-reconsider");
  const led = JSON.parse(readFileSync(join(runDir, "run-ledger.json"), "utf8"));
  assert.equal(led.outcomes["FAFF-1"], undefined, "the parked outcome is cleared");
  const m2 = readMarker(root, "FAFF-1");
  assert.equal(m2.disposition, undefined);
  assert.equal(m2.park, undefined, "the park sub-object is dropped");
});

test("own-live-run concurrency/idempotency: a second clear is a no-op; ledger + marker stay consistent", () => {
  const root = freshRoot();
  const runDir = writeRunDir(root, "run-A", { outcomes: { "FAFF-1": "parked" } });
  const marker = writeMarker(root, "FAFF-1", { runDir });
  const first = pr.apply_git_only_unpark(root, marker, "FAFF-1", marker.park, "resume-reconsider", "sha256:old", "sha256:new", "own-live-run", NOW_MS);
  assert.equal(first.unparked, true);
  // Re-run on the SAME (already-cleared) state — the outcome is already gone → idempotent no-op, still unparked.
  const again = pr.apply_git_only_unpark(root, marker, "FAFF-1", marker.park, "resume-reconsider", "sha256:old", "sha256:new", "own-live-run", NOW_MS);
  assert.equal(again.unparked, true, "second clear is idempotent, never a double-clear failure");
  const led = JSON.parse(readFileSync(join(runDir, "run-ledger.json"), "utf8"));
  assert.equal(led.outcomes["FAFF-1"], undefined);
  assert.equal(readMarker(root, "FAFF-1").disposition, undefined);
});

test("own-live-run: a present-but-malformed ledger REFUSES (no bare strip)", () => {
  const root = freshRoot();
  const runDir = writeRunDir(root, "run-A", { malformed: true });
  const marker = writeMarker(root, "FAFF-1", { runDir });
  const res = pr.apply_git_only_unpark(root, marker, "FAFF-1", marker.park, "resume-reconsider", "sha256:old", "sha256:new", "own-live-run", NOW_MS);
  assert.equal(res.unparked, false);
  assert.match(res.reason, /malformed/);
  assert.equal(readMarker(root, "FAFF-1").disposition, "parked", "the marker is NOT stripped on a refuse");
});

// ---------------------------------------------------------------------------
// apply_git_only_unpark — cross-run-readonly (interactive): NEVER writes the earlier run's Evidence
// ledger. Branches: terminal → marker-alone; absent/rotated → marker-alone; live → refuse; malformed → refuse.
// ---------------------------------------------------------------------------
test("cross-run-readonly: earlier run TERMINAL → marker cleared alone, earlier ledger bytes UNCHANGED", () => {
  const root = freshRoot();
  const runDir = writeRunDir(root, "run-old", { outcomes: { "FAFF-2": "parked" }, ownerStatus: "done" });
  const before = readFileSync(join(runDir, "run-ledger.json"), "utf8");
  const marker = writeMarker(root, "FAFF-2", { runDir });
  const res = pr.apply_git_only_unpark(root, marker, "FAFF-2", marker.park, "interactive-reprep", "sha256:old", null, "cross-run-readonly", NOW_MS);
  assert.equal(res.unparked, true);
  assert.equal(res.ledger_cleared, false);
  assert.equal(res.ledger_note, "earlier-run-terminal");
  assert.equal(res.event.data.via, "interactive-reprep");
  assert.equal(readFileSync(join(runDir, "run-ledger.json"), "utf8"), before, "the earlier run's Evidence ledger is byte-for-byte unchanged");
  assert.equal(readMarker(root, "FAFF-2").disposition, undefined, "only the marker moved");
});

test("cross-run-readonly: rotated/absent owner.run_dir → marker cleared alone, note absent-run", () => {
  const root = freshRoot();
  const marker = writeMarker(root, "FAFF-3", { runDir: join(root, ".faff", "runs", "run-gone") }); // never created
  const res = pr.apply_git_only_unpark(root, marker, "FAFF-3", marker.park, "interactive-reprep", "sha256:old", null, "cross-run-readonly", NOW_MS);
  assert.equal(res.unparked, true);
  assert.equal(res.ledger_note, "absent-run");
  assert.equal(readMarker(root, "FAFF-3").disposition, undefined);
});

test("cross-run-readonly: still-LIVE earlier run → REFUSE, marker NOT stripped", () => {
  const root = freshRoot();
  // running owner + a heartbeat AT now → runIsHeld true
  const runDir = writeRunDir(root, "run-live", { outcomes: { "FAFF-4": "parked" }, ownerStatus: "running", heartbeat: NOW });
  const marker = writeMarker(root, "FAFF-4", { runDir });
  const res = pr.apply_git_only_unpark(root, marker, "FAFF-4", marker.park, "interactive-reprep", "sha256:old", null, "cross-run-readonly", NOW_MS);
  assert.equal(res.unparked, false);
  assert.match(res.reason, /earlier-run-live/);
  assert.equal(readMarker(root, "FAFF-4").disposition, "parked", "a live earlier run leaves the park standing");
});

test("cross-run-readonly: present-but-malformed earlier ledger → REFUSE, marker NOT stripped", () => {
  const root = freshRoot();
  const runDir = writeRunDir(root, "run-bad", { malformed: true });
  const marker = writeMarker(root, "FAFF-5", { runDir });
  const res = pr.apply_git_only_unpark(root, marker, "FAFF-5", marker.park, "interactive-reprep", "sha256:old", null, "cross-run-readonly", NOW_MS);
  assert.equal(res.unparked, false);
  assert.match(res.reason, /malformed/);
  assert.equal(readMarker(root, "FAFF-5").disposition, "parked");
});

// ---------------------------------------------------------------------------
// Event registration — park-reconsidered is run-scoped (parity with run-resume): registered, NOT issue-scoped.
// ---------------------------------------------------------------------------
test("park-reconsidered is a registered run-scoped event type (not issue-scoped)", () => {
  assert.equal(EVENT_TYPES.has("park-reconsidered"), true);
  assert.equal(EVENT_ISSUE_SCOPED.has("park-reconsidered"), false);
});
