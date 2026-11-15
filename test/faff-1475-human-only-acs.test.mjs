// FAFF-1475 slice 1, seam A: `faff dod classify` marks a `needs-human:` DONE item human_only.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");

const classify = (specText, issue = "FAFF-9") => {
  const dir = mkdtempSync(join(tmpdir(), "faff-1475-"));
  const spec = join(dir, "spec.md");
  writeFileSync(spec, specText);
  const r = spawnSync(process.execPath, [BIN, "dod", "classify", "--spec", spec, "--issue", issue, "--json"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return { out: JSON.parse(r.stdout), stderr: r.stderr };
};

const spec = (done, extra = "") => `# T

## Scenarios

Given a thing
When it runs
Then it returns 200

${extra}
### 4. DONE

${done}
`;

describe("marker", () => {
  test("a needs-human: DONE item is human_only, delegated, and leaves other rows' ids unchanged", () => {
    const withMarker = classify(spec("- [ ] [ac-1] returns 200 for GET /x\n- [ ] [ac-2] needs-human: Prices match the published pricing page\n- [ ] [ac-3] returns 404 for GET /y"));
    const plain = classify(spec("- [ ] [ac-1] returns 200 for GET /x\n- [ ] [ac-2] Prices match the published pricing page\n- [ ] [ac-3] returns 404 for GET /y"));
    const rows = withMarker.out.criteria;
    const row = rows.find((c) => c.ac_id === "faff-9#ac-2");
    assert.equal(row.human_only, true);
    assert.equal(row.verification_tier, "delegated");
    assert.equal(row.verifier, "ac-checklist");
    assert.equal(row.text, "Prices match the published pricing page");
    for (const c of rows) if (c !== row) assert.equal(c.human_only, false, c.id);
    assert.deepEqual(rows.map((c) => [c.id, c.ac_id]), plain.out.criteria.map((c) => [c.id, c.ac_id]));
  });

  test("positional ids are unchanged by a marker", () => {
    const { out } = classify(spec("- [ ] returns 200\n- [ ] needs-human: looks right to a designer\n- [ ] returns 404"));
    assert.deepEqual(out.criteria.filter((c) => c.source === "done").map((c) => [c.ac_id, c.human_only]),
      [["faff-9#done:1", false], ["faff-9#done:2", true], ["faff-9#done:3", false]]);
  });

  test("an empty reason is not a marker: literal text, human_only false, stderr advisory", () => {
    const { out, stderr } = classify(spec("- [ ] [ac-1] needs-human:   \n- [ ] [ac-2] returns 200"));
    const row = out.criteria.find((c) => c.ac_id === "faff-9#ac-1");
    assert.equal(row.human_only, false);
    assert.match(row.text, /^needs-human:/);
    assert.match(stderr, /needs-human/);
  });

  test("a marker outside the DONE section is ignored", () => {
    const { out, stderr } = classify(spec("- [ ] [ac-1] returns 200", "- needs-human: a bullet in the body\n\n"));
    assert.ok(out.criteria.every((c) => c.human_only === false));
    assert.equal(stderr, "");
  });

  test("a human_only row naming a code surface stays delegated", () => {
    const unmarked = classify(spec("- [ ] [ac-1] `a.test.mjs` MUST pass"));
    assert.equal(unmarked.out.criteria.find((c) => c.ac_id === "faff-9#ac-1").verification_tier, "integration");
    const { out } = classify(spec("- [ ] [ac-1] needs-human: `a.test.mjs` MUST pass"));
    const row = out.criteria.find((c) => c.ac_id === "faff-9#ac-1");
    assert.equal(row.human_only, true);
    assert.equal(row.verification_tier, "delegated");
    assert.equal(row.verifier, "ac-checklist");
  });
});
