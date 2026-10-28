// FAFF-1207 — the commissaire `--issue` guard in `faff validate-adapters`. Skill prose must not pass the
// deprecated `--issue` alias on a `faff commissaire` invocation (FAFF-1167 made it a one-release alias of
// `--unit-id`); the guard FAILs any SKILL.md / references/*.md line carrying that invocation shape, while
// leaving every OTHER command's own current `--issue` flag untouched. Fixture skills live in a throwaway
// skills dir (modeled on validate-adapters-removed-dispatch-key.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import validateAdapters from "../plugin/skills/faff/bin/lib/validate-adapters.js";

const { lintCommissaireUnitId } = validateAdapters;
const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");

function runOnFixture(skillBody, referenceBody) {
  const dir = mkdtempSync(join(tmpdir(), "faff-commissaire-"));
  const skill = join(dir, "zz-commissaire-fixture");
  mkdirSync(skill);
  writeFileSync(join(skill, "SKILL.md"), skillBody);
  if (referenceBody !== undefined) {
    mkdirSync(join(skill, "references"));
    writeFileSync(join(skill, "references", "lane.md"), referenceBody);
  }
  const r = spawnSync(process.execPath, [BIN, "validate-adapters", "--skills-dir", dir], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  return r;
}
const flagged = (r) => /\(commissaire --issue\)/.test(r.stdout);
// A negative is only meaningful if the lint actually RAN to completion past the guard — otherwise a
// crash (missing dir, an exception in an earlier lint, a renamed dispatchProseFiles) yields no
// `(commissaire --issue)` line and the negative passes vacuously, masking a loosened-into-never-matching
// regex. `validate-adapters` prints its `RESULT:` summary last, after every lint including this guard,
// so its presence on stdout proves the guard ran. `r.error` null proves the process spawned at all.
const ran = (r) => r.error == null && /RESULT:/.test(r.stdout);

test("positive: flags a commissaire --issue invocation in SKILL.md, citing FAFF-1207", () => {
  const r = runOnFixture('Run `"$faff" commissaire effect declare --run-dir "$d" --issue FAFF-1 --step merge`.\n');
  assert.ok(flagged(r));
  assert.match(r.stdout, /FAIL {2}zz-commissaire-fixture \(commissaire --issue\)/);
  assert.match(r.stdout, /line 1: .*deprecated commissaire alias.*FAFF-1207/);
  assert.notEqual(r.status, 0);
});

test("positive: flags every binary-token spelling of the invocation", () => {
  for (const inv of [
    'faff commissaire verdict conclude --unit-id x --issue FAFF-1',
    '"$faff" commissaire effect authorize --issue FAFF-1 --level L4',
    '"$FAFF" commissaire audit anchor --issue FAFF-1',
    '$faff commissaire effect reconcile --issue FAFF-1',
  ]) {
    assert.ok(flagged(runOnFixture(`Run \`${inv}\`.\n`)), inv);
  }
});

test("positive: flags a commissaire --issue hit in a references/*.md file, naming the file", () => {
  const r = runOnFixture(
    'Clean skill: `"$faff" commissaire verdict conclude --run-dir "$d" --unit-id FAFF-1`.\n',
    'The hold half runs `faff commissaire effect observe --run-dir "$d" --issue FAFF-1 --step merge`.\n',
  );
  assert.ok(flagged(r));
  assert.match(r.stdout, /zz-commissaire-fixture\/references\/lane\.md \(commissaire --issue\)/);
  // the clean SKILL.md --unit-id line raises no finding (only the references file is flagged)
  assert.doesNotMatch(r.stdout, /FAIL {2}zz-commissaire-fixture \(commissaire --issue\)/);
  assert.notEqual(r.status, 0);
});

test("negative: a clean commissaire --unit-id line raises no finding", () => {
  const r = runOnFixture('Run `"$faff" commissaire effect declare --run-dir "$d" --unit-id FAFF-1 --step merge`.\n');
  assert.ok(ran(r), "guard did not run to completion");
  assert.equal(flagged(r), false, r.stdout);
});

test("negative: --issue on NON-commissaire commands is never flagged", () => {
  const r = runOnFixture([
    'Init with `faff run-ledger init-interactive --issue FAFF-1`.',
    'Check with `faff effects check --issue FAFF-1`.',
    'Observe with `faff effects observe --run r --issue FAFF-1 --step merge`.',
    'Claim with `faff build-claim acquire --issue FAFF-1`.',
    'Land with `faff landing-claim --issue FAFF-1`.',
    'Prune with `faff worktree-prune --issue FAFF-1`.',
    'Heal with `faff worktree-heal --issue FAFF-1`.',
    'Guard with `faff corrective --guard --issue FAFF-1`.',
    'Review with `faff spec-review-dir --issue FAFF-1`.',
    'Capture with `faff decision-capture action --issue FAFF-1`.',
    'Post-merge with `faff post-merge-check --issue FAFF-1`.',
    'Recover with `faff bundle-recover --issue FAFF-1`.',
    '',
  ].join("\n"));
  assert.ok(ran(r), "guard did not run to completion");
  assert.equal(flagged(r), false, r.stdout);
});

test("negative: prose that merely mentions the deprecation (wrong order / co-occurrence) is not flagged", () => {
  for (const body of [
    'The `--issue` alias on commissaire is deprecated; pass `--unit-id` instead.\n',
    'Pass `--unit-id` to `faff commissaire effect`, never `--issue`.\n',
    'See `faff commissaire` for the facade; `faff effects check --issue` keeps its own flag.\n',
  ]) {
    const r = runOnFixture(body);
    assert.ok(ran(r), "guard did not run to completion");
    assert.equal(flagged(r), false, body);
  }
});

test("positive: the ✗ finding reports the real line number (hit on line 3, not line 1)", () => {
  const r = runOnFixture([
    "Clean intro line.",
    "Another clean line.",
    'Then `faff commissaire verdict conclude --run-dir "$d" --issue FAFF-1`.',
    "",
  ].join("\n"));
  assert.ok(flagged(r));
  assert.match(r.stdout, /✗ line 3:/);
  assert.doesNotMatch(r.stdout, /✗ line 1:/);
});

test("pure helper lintCommissaireUnitId: one finding per invocation line, [] otherwise", () => {
  assert.deepEqual(lintCommissaireUnitId('`faff commissaire effect declare --run-dir "$d" --unit-id FAFF-1`\n'), []);
  assert.deepEqual(lintCommissaireUnitId('`faff effects check --issue FAFF-1`\n'), []);
  assert.equal(lintCommissaireUnitId('`faff commissaire effect declare --issue FAFF-1`\n').length, 1);
  const multi = lintCommissaireUnitId([
    '`"$faff" commissaire effect declare --issue FAFF-1`',
    'some clean prose',
    '`faff commissaire verdict conclude --issue FAFF-2`',
  ].join("\n"));
  assert.equal(multi.length, 2);
  assert.match(multi[0], /^line 1:/);
  assert.match(multi[1], /^line 3:/);
});
