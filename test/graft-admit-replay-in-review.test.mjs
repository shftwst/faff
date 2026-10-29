// FAFF-1414 — the In Review slice of the post-fix decision-corpus replay. Grading the corpus found
// 14 `next` records for In Review issues where `next` said graft (or prep, for a spec-`none` read)
// and the drain skipped every one as claimed-by-peer. This replays those 14 records, by correlation
// id, through `faff graft admit --mode autonomous` with no build-claim ref (the corpus has none):
// each must give claimed-by-peer, and each record's own `next` verdict must be reproduced unchanged,
// so the divergence is the claim rule's alone. FAFF-1434 imports this expectation for its full replay.
// An ordinary node --test case; it gates nothing beyond the test run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const CLI = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const CORPUS = join(REPO, "verification", "reports", "FAFF-974-post-fix-fidelity", "decision-corpus.jsonl");

const RUNS_X3 = ["run-20261027-162841-beepboop-list-36511a", "run-20261027-185215-beepboop-list-1456d4", "run-20261027-185806-beepboop-list-620a46", "run-20261027-191711-beepboop-list-7a746f"];
const IN_REVIEW_IDS = [
  "run-20261026-213652-beepboop-list-31f750/FAFF-1403/next/1",
  "run-20261027-024440-beepboop-list-fa4ec4/FAFF-1403/next/2",
  ...RUNS_X3.flatMap((run) => ["FAFF-1292", "FAFF-1207", "FAFF-1205"].map((issue) => `${run}/${issue}/next/1`)),
];

function corpusNextRecords() {
  const byId = new Map();
  for (const line of readFileSync(CORPUS, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line);
    if (rec.type === "decision-capture" && rec.data && rec.data.kernel === "next") byId.set(rec.data.correlation_id, rec);
  }
  return byId;
}

// The facts each record's own normalised_inputs imply: its status, its spec confidence, and an
// eligible label set when it was eligible. No claim ref is planted: the corpus records none.
function factsFor(rec) {
  const ni = rec.data.normalised_inputs;
  const labels = [];
  if (ni.eligible) labels.push("faff-automate");
  if (ni.parked) labels.push("faff-parked");
  if (ni.awaitingSpecReview) labels.push("faff-awaiting-spec-review");
  return {
    issue: rec.issue,
    status: ni.status,
    labels,
    spec: { found: ni.spec !== "none", confidence: ni.spec },
    externally_blocked: ni.blocked,
    claimed_at: null,
    tracker: { mode: "tracker", configured: true, pinned: false, reachable: true },
  };
}

test("the corpus holds all 14 named In Review records", () => {
  const byId = corpusNextRecords();
  assert.equal(IN_REVIEW_IDS.length, 14);
  for (const id of IN_REVIEW_IDS) {
    assert.ok(byId.has(id), `correlation id missing from the corpus: ${id}`);
    assert.equal(byId.get(id).data.normalised_inputs.status, "in-review", id);
  }
});

test("each In Review record replays to claimed-by-peer with its own next verdict unchanged", () => {
  const byId = corpusNextRecords();
  const root = mkdtempSync(join(tmpdir(), "faff-graft-admit-replay-"));
  spawnSync("git", ["-C", root, "init", "-q"]);
  writeFileSync(join(root, ".faffrc.yaml"), "bundle_store: local\n");
  writeFileSync(join(root, "spec.md"), "## Scenarios\n\n```\nGiven a spec\nWhen it is graded\nThen it is admissible\n```\n\n## 8. DONE\n\n- [ ] the command MUST exit 0\n");
  for (const id of IN_REVIEW_IDS) {
    const rec = byId.get(id);
    assert.ok(rec, `correlation id missing from the corpus: ${id}`);
    const env = { ...process.env };
    delete env.FAFF_RUN_DIR;
    delete env.FAFF_SESSION_ID;
    const r = spawnSync("node", [CLI, "graft", "admit", "--json", "--mode", "autonomous", "--facts", "-", "--spec-file", join(root, "spec.md"), "--root", root, "--now", rec.ts],
      { cwd: root, encoding: "utf8", input: JSON.stringify(factsFor(rec)), env });
    assert.equal(r.status, 0, `${id}: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.disposition, "claimed-by-peer", `${id}: ${r.stdout}`);
    assert.equal(out.kernels.next.step, rec.data.verdict, `${id}: next verdict not reproduced`);
  }
});
