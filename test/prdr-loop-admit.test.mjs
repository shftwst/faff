// FAFF-495 — Loop-path PRDR author+admit: a machine-authored (`provenance: loop`) PRDR either
// admits through the two-phase YAGNI gate and lands via `faff prdr accept --actor loop`, or parks
// with the refusing phase's reason. This is an INTEGRATION test of the documented Step-5c sequence
// (faff-plot/SKILL.md → "Step 5c — admit or park the loop-PRDR") composed from the already-shipped
// gates — it drives the real `faff prdr yagni` / `admit` / `accept` CLIs in the documented order,
// with the LLM proposer/challenger stubbed as explicit flag values (a test has no model to call).
//
// It proves the ticket's ACs on the mechanical legs:
//   - a loop-PRDR admits through both phases (yagni survived + admit) and lands Accepted; OR
//   - it parks with the refusing phase's reason (yagni trace-reject / Phase-1 reject / Phase-2
//     overturned / Phase-2 inconclusive / admit-refused) and is NEVER silently dropped (the
//     Proposed record stays in place, recoverable);
//   - `faff prdr accept --actor loop` REFUSES a non-admit verdict (the loop can't land a refusal);
//   - the gate CLIs are byte-unchanged — this test only composes them.
// The real end-to-end (a genuinely loop-authored PRDR) is a human-supervised holdout-shaped
// criterion, out of this ticket's DoD (FAFF-317 / FAFF-474 eval-coverage decomposition).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const SKILL = join(REPO, "plugin", "skills", "faff-plot", "SKILL.md");

const prdr = (args, cwd = REPO) => spawnSync(process.execPath, [BIN, "prdr", ...args], { cwd, encoding: "utf8" });
const git = (cwd, ...a) => {
  const r = spawnSync("git", a, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
};

// A temp git repo whose default branch is `main`, docs/prdr present, with one committed Proposed
// loop-PRDR (so `prdr accept` — a git gesture — has a tracked record to flip).
function tmpRepoWithLoopPrdr() {
  const root = mkdtempSync(join(tmpdir(), "faff-495-it-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@t.test");
  git(root, "config", "user.name", "t");
  const dir = join(root, "docs", "prdr");
  mkdirSync(dir, { recursive: true });
  // Author the loop-PRDR exactly as Step 5b does.
  const path0 = prdr(["new", "Ship the booking flow", "--container", "portal", "--prd-goal", "ship booking",
    "--provenance", "loop", "--status", "Proposed", "--root", root]).stdout.trim();
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "seed loop-PRDR");
  return { root, dir, file: path0 };
}

const statusOf = (file) => (readFileSync(file, "utf8").match(/- \*\*Status:\*\* *(.+)/) || [])[1] || "";

// Phase-1 (methodology) + Phase-2 (adversarial review) are stubbed as explicit yagni flags.
const yagni = (root, { proposal = "admit", serves = true, within = true, challenge = "survived", goal = "ship booking", goals = ["ship booking"] } = {}) => {
  const args = ["yagni", "--prd-goal", goal, "--prd-goals", JSON.stringify(goals), "--proposal", proposal, "--root", root];
  if (serves) args.push("--serves-goal");
  if (within) args.push("--within-scope");
  if (challenge != null) args.push("--challenge", challenge);
  const r = prdr(args, root);
  assert.equal(r.status, 0, `yagni exited non-zero: ${r.stderr}`);
  return JSON.parse(r.stdout);
};
const admit = (root, upper, lower = { covered: true, uncovered_goals: [] }) => {
  const r = prdr(["admit", "--actor", "loop", "--supersedes-provenance", "none",
    "--upper", JSON.stringify({ admit: upper.admit, reason: upper.reason || "" }),
    "--lower", JSON.stringify(lower), "--root", root], root);
  assert.equal(r.status, 0, `admit exited non-zero: ${r.stderr}`);
  return JSON.parse(r.stdout);
};

test("admit path: yagni survived → admit → accept --actor loop lands on a prdr/ branch, Accepted (FAFF-495)", () => {
  const { root, file } = tmpRepoWithLoopPrdr();
  const up = yagni(root, { proposal: "admit", challenge: "survived" });
  assert.equal(up.admit, true, "yagni must admit on serves+within+survived+trace");
  const adm = admit(root, up);
  assert.equal(adm.disposition, "admit", "two-gate admit must yield the admit disposition");
  // Land it EXACTLY as Step 5c does — no --no-branch, so the real FAFF-463 branch-creation path
  // runs (resolveDefaultBase → git switch -c prdr/…). Hermetic: no gh/origin → base falls back to
  // the fixture's own `main`. This is the "lands via faff prdr accept --actor loop" AC end-to-end.
  const acc = prdr(["accept", "1", "--actor", "loop", "--admit-verdict", JSON.stringify(adm), "--root", root], root);
  assert.equal(acc.status, 0, `accept exited non-zero: ${acc.stderr}`);
  const landed = JSON.parse(acc.stdout);
  assert.match(landed.branch, /^prdr\//, "accept must create a prdr/ landing branch");
  assert.equal(landed.base, "main", "hermetic base resolves to the fixture's main");
  assert.equal(git(root, "branch", "--list", landed.branch).trim().replace(/^\*\s*/, ""), landed.branch, "the landing branch must exist");
  // FAFF-463 lands the Accepted flip as a commit on the prdr/ branch and restores the working branch
  // (atomic-or-clean) — so the working tree stays Proposed and the Accepted record lives on the branch.
  const rel = file.slice(root.length + 1);
  assert.match(git(root, "show", `${landed.branch}:${rel}`), /- \*\*Status:\*\* *Accepted/, "the landing branch's record must be Accepted");
  assert.match(statusOf(file), /^Proposed/, "the working branch is left clean (Proposed) — accept lands on the prdr/ branch, no smuggled working-tree change");
});

test("park path: Phase-2 overturned → admit reject → accept REFUSES, PRDR stays Proposed (never dropped) (FAFF-495)", () => {
  const { root, file } = tmpRepoWithLoopPrdr();
  const up = yagni(root, { proposal: "admit", challenge: "overturned" });
  assert.equal(up.admit, false, "an overturned Phase-2 must not admit");
  const adm = admit(root, up);
  assert.equal(adm.disposition, "reject", "a non-admitting upper yields a non-admit disposition");
  // The orchestration parks; if accept is nonetheless attempted, the loop guard refuses it.
  const acc = prdr(["accept", "1", "--actor", "loop", "--admit-verdict", JSON.stringify(adm), "--no-branch", "--root", root], root);
  assert.notEqual(acc.status, 0, "accept must refuse a non-admit verdict (loop may only land an admit)");
  assert.match(statusOf(file), /^Proposed/, "the parked PRDR must stay Proposed — recoverable, never dropped");
});

test("park path: Phase-2 inconclusive (challenge omitted) → yagni does not admit (FAFF-495)", () => {
  const { root } = tmpRepoWithLoopPrdr();
  const up = yagni(root, { proposal: "admit", challenge: null });
  assert.equal(up.admit, false, "a missing skeptic (inconclusive Phase 2) is not a survival — must not admit");
});

test("park path: yagni trace-reject (prd_goal not a real PRD goal) → does not admit (FAFF-495)", () => {
  const { root } = tmpRepoWithLoopPrdr();
  const up = yagni(root, { goal: "gold-plate the thing", goals: ["ship booking"], challenge: "survived" });
  assert.equal(up.admit, false, "trace-to-goal must reject a goal absent from the PRD goal set, before any admit");
});

test("park path: Phase-1 reject → admit reject → not landed (FAFF-495)", () => {
  const { root, file } = tmpRepoWithLoopPrdr();
  const up = yagni(root, { proposal: "reject", serves: false, within: false, challenge: "survived" });
  assert.equal(up.admit, false, "a Phase-1 reject must not admit");
  const adm = admit(root, up);
  assert.equal(adm.disposition, "reject", "Phase-1 reject → non-admit disposition");
  assert.match(statusOf(file), /^Proposed/, "unlanded PRDR stays Proposed");
});

test("park path: yagni admits but the FAFF-257 lower/coverage gate fails → admit reject → accept REFUSES (admit-refused) (FAFF-495)", () => {
  const { root, file } = tmpRepoWithLoopPrdr();
  const up = yagni(root, { proposal: "admit", challenge: "survived" });
  assert.equal(up.admit, true, "upper (YAGNI) admits");
  // Distinct refusal source from a yagni reject: the lower coverage gate is not covered.
  const adm = admit(root, up, { covered: false, uncovered_goals: ["ship booking"] });
  assert.equal(adm.disposition, "reject", "an uncovered lower gate must block the admit disposition");
  const acc = prdr(["accept", "1", "--actor", "loop", "--admit-verdict", JSON.stringify(adm), "--no-branch", "--root", root], root);
  assert.notEqual(acc.status, 0, "accept must refuse a coverage-failed (admit-refused) verdict");
  assert.match(statusOf(file), /^Proposed/, "the coverage-parked PRDR stays Proposed — recoverable, never dropped");
});

test("the gate CLIs are unchanged — `faff prdr --selftest` still passes (FAFF-495 wires, never edits, the gates)", () => {
  const r = prdr(["--selftest"]);
  assert.equal(r.status, 0, r.stderr);
});

test("Step 5c prose documents the composed sequence and the park-reason vocabulary (FAFF-495 prompt-regression guard)", () => {
  const md = readFileSync(SKILL, "utf8");
  assert.match(md, /### Step 5c — admit or park the loop-PRDR/, "Step 5c heading must exist");
  // Composes the existing gateway contract — no parallel admission path.
  assert.match(md, /no parallel admission path/i, "must state it introduces no parallel admission path");
  // The three gates are named and invoked in order.
  for (const cli of ["faff prdr yagni", "faff prdr admit --actor loop", "faff prdr accept --actor loop"]) {
    assert.ok(md.includes(cli), `Step 5c must name \`${cli}\``);
  }
  // The refusing-phase park-reason vocabulary is spelled out (park, never drop).
  for (const reason of ["yagni-reject", "yagni-overturned", "phase2-inconclusive", "admit-refused"]) {
    assert.ok(md.includes(reason), `Step 5c must document the park reason \`${reason}\``);
  }
  assert.match(md, /no PRDR is silently dropped/i, "the load-bearing no-silent-drop invariant must be stated");
});
