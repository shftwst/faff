// FAFF-924 — structural test for the three-step split of `governance-check/action.yml`'s
// binary-resolution steps (DoD item 4). GitHub Actions echoes a `run:` step's ENTIRE
// script as source preview before executing it, so a combined in-checkout/fetch-pinned
// `if/else` block leaked the untaken branch's `::error::` line into the log even on the
// success path (FAFF-913's investigation chased exactly this phantom). Splitting into
// step-level `if:`-gated steps fixes it, because a skipped step is completely silent —
// no source preview, no output at all — per the 2026-08-30 scratch-branch spike.
//
// This is the AUTOMATED-STRUCTURAL half of DoD item 4 only: it reads `action.yml` as
// text and asserts step ids/gates/output-selection/message-placement invariants — the
// deterministic parts. Whether a GitHub-hosted runner is actually silent on a skipped
// step is a runner property (already empirically confirmed by the spike, spec §3), not
// something node:test can observe, so that half stays a manual CI-log verification.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const actionPath = join(repoRoot, ".github/actions/governance-check/action.yml");
const source = readFileSync(actionPath, "utf8");

// Split into step blocks on the `steps:` list-item boundary (`    - name: ...`), keyed
// by each step's `id:` line — text-based, matching this repo's existing convention of
// reading YAML files as text rather than adding a YAML-parser dependency (spec §3).
// Full-line comments (e.g. the `# 1c. Fetch-pinned path...` header above a step) are
// stripped before splitting — otherwise a comment describing the NEXT step (which may
// itself mention `::error::` in prose) would be attributed to the PRECEDING step's
// block, since it appears textually before the next `- name:` boundary.
function stepBlocks(text) {
  const lines = text.split("\n").filter((line) => !/^\s*#/.test(line));
  const starts = [];
  lines.forEach((line, i) => {
    if (/^ {4}- name:/.test(line)) starts.push(i);
  });
  const blocks = {};
  starts.forEach((start, idx) => {
    const end = idx + 1 < starts.length ? starts[idx + 1] : lines.length;
    const block = lines.slice(start, end).join("\n");
    const idMatch = block.match(/^ {6}id:\s*(\S+)/m);
    if (idMatch) blocks[idMatch[1]] = block;
  });
  return blocks;
}

const blocks = stepBlocks(source);

test("the retired resolve-binary id is gone entirely", () => {
  assert.equal(blocks["resolve-binary"], undefined, "no step keeps id: resolve-binary");
  assert.ok(!source.includes("steps.resolve-binary"), "no reference to steps.resolve-binary.outputs.bin remains");
});

test("three replacement steps exist: check-binary, use-in-checkout, fetch-pinned", () => {
  assert.ok(blocks["check-binary"], "check-binary step exists");
  assert.ok(blocks["use-in-checkout"], "use-in-checkout step exists");
  assert.ok(blocks["fetch-pinned"], "fetch-pinned step exists");
});

test("check-binary runs unconditionally (no if:) and only emits the boolean probe output", () => {
  const block = blocks["check-binary"];
  assert.ok(!/\n {6}if:/.test(block), "check-binary carries no if: gate — it must always run to produce the gate");
  assert.match(block, /in-checkout=true/);
  assert.match(block, /in-checkout=false/);
  assert.ok(!block.includes("::error::"), "the probe never emits an error");
  assert.ok(!block.includes("curl"), "the probe never fetches");
  assert.ok(!block.includes("chmod"), "the probe never chmods");
  assert.ok(!/\n\s*echo "bin=/.test(block), "the probe never emits a bin= output");
});

test("use-in-checkout is gated on check-binary's in-checkout output being true", () => {
  const block = blocks["use-in-checkout"];
  assert.match(block, /^ {6}if:\s*steps\.check-binary\.outputs\.in-checkout == 'true'\s*$/m);
});

test("fetch-pinned is gated on check-binary's in-checkout output being false", () => {
  const block = blocks["fetch-pinned"];
  assert.match(block, /^ {6}if:\s*steps\.check-binary\.outputs\.in-checkout == 'false'\s*$/m);
});

test("both consumers select the bin output via the || idiom across the two mutually-exclusive branches", () => {
  const expected = 'BIN="${{ steps.use-in-checkout.outputs.bin || steps.fetch-pinned.outputs.bin }}"';
  const occurrences = source.split(expected).length - 1;
  assert.equal(occurrences, 2, "exactly the two documented consumers (discover-anchors, governance-check) use the selection expression");
});

test("the verbatim success message lives only in use-in-checkout, and contains no ::error::", () => {
  const successMsg = 'faff governance-check: using in-checkout binary: $BIN';
  assert.ok(blocks["use-in-checkout"].includes(successMsg), "use-in-checkout emits the verbatim success message");
  assert.ok(!blocks["check-binary"].includes(successMsg));
  assert.ok(!blocks["fetch-pinned"].includes(successMsg));
  assert.ok(!blocks["use-in-checkout"].includes("::error::"), "use-in-checkout never emits an error");
});

test("both verbatim setup-fault ::error:: lines, the fetch notice, and the curl live only in fetch-pinned", () => {
  const noPinFault =
    '::error::faff governance-check: setup fault — no in-checkout binary at $BIN and no faff-version pinned to fetch one (pin a commit sha, preferably, or a tag)';
  const fetchNotice =
    'faff governance-check: no in-checkout binary at ${{ inputs.faff-binary }} — fetching pinned ref from $URL';
  const fetchFailFault =
    '::error::faff governance-check: setup fault — failed to fetch the faff binary from $URL (faff-version=${{ inputs.faff-version }})';

  for (const msg of [noPinFault, fetchNotice, fetchFailFault]) {
    assert.ok(blocks["fetch-pinned"].includes(msg), `fetch-pinned contains: ${msg}`);
    assert.ok(!blocks["check-binary"].includes(msg), `check-binary must not contain: ${msg}`);
    assert.ok(!blocks["use-in-checkout"].includes(msg), `use-in-checkout must not contain: ${msg}`);
  }

  assert.ok(blocks["fetch-pinned"].includes("curl"), "fetch-pinned owns the curl fetch");
  assert.ok(!blocks["check-binary"].includes("curl"));
  assert.ok(!blocks["use-in-checkout"].includes("curl"));

  // Both fault lines exit non-zero (DoD item 2: genuine runtime output, non-zero exit).
  const errorLines = blocks["fetch-pinned"].split("\n").filter((l) => l.includes("::error::"));
  assert.equal(errorLines.length, 2, "exactly the two documented fault lines");
});

test("fetch-pinned's no-pin message still reads inputs.faff-binary for $BIN before any temp-path reassignment", () => {
  const block = blocks["fetch-pinned"];
  const binAssign = block.indexOf('BIN="${{ inputs.faff-binary }}"');
  const noPinFault = block.indexOf("no faff-version pinned to fetch one");
  const tempReassign = block.indexOf('BIN="${RUNNER_TEMP}');
  assert.ok(binAssign !== -1 && noPinFault !== -1 && tempReassign !== -1, "all three markers present");
  assert.ok(binAssign < noPinFault, "BIN is set to inputs.faff-binary before the no-pin message");
  assert.ok(noPinFault < tempReassign, "the no-pin message is emitted before BIN is reassigned to the temp path");
});

test("step order: check-binary, use-in-checkout, fetch-pinned appear in that order", () => {
  const iCheck = source.indexOf("id: check-binary");
  const iUse = source.indexOf("id: use-in-checkout");
  const iFetch = source.indexOf("id: fetch-pinned");
  assert.ok(iCheck < iUse && iUse < iFetch, "the three steps appear in the documented order");
});

test("governance semantics are untouched: the CLI verb invocation and its flags are unchanged", () => {
  assert.match(source, /node "\$BIN" governance-check "\$\{ARGS\[@\]\}" --summary-md "\$GITHUB_STEP_SUMMARY"/);
});
