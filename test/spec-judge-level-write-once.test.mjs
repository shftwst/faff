// FAFF-930 leg 1 — the write-once / refuse-overwrite guard on the run-ledger `level` at the single
// locked mutation seam mutateLedgerUnderLock (heartbeat.js). The mint establishes `level`; a later
// locked write may keep it but must not change it, so a within-run orchestrator writing through the
// seam cannot forge its own L4 authority.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { mutateLedgerUnderLock } = require("../plugin/skills/faff/bin/lib/heartbeat.js");

function readLedger(dir) { return JSON.parse(readFileSync(join(dir, "run-ledger.json"), "utf8")); }

test("the mint establishes level; a later mutation raising L3->L4 is refused and the launch level is kept; a mutation not touching level succeeds", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-writeonce-"));
  try {
    // (a) mint establishes level L3
    mutateLedgerUnderLock(dir, () => ({ run_id: "r", level: "L3", owner: { status: "running" } }));
    assert.equal(readLedger(dir).level, "L3");

    // (b) a subsequent mutation attempting to raise level is REFUSED (throws), ledger keeps L3
    assert.throws(
      () => mutateLedgerUnderLock(dir, (fresh) => ({ ...fresh, level: "L4" })),
      (e) => e && e.code === "LEVEL_WRITE_ONCE",
    );
    assert.equal(readLedger(dir).level, "L3", "the ledger retains its launch level after a refused raise");

    // (c) a mutation that does NOT touch level still succeeds and preserves the launch level
    const res = mutateLedgerUnderLock(dir, (fresh) => ({ ...fresh, note: "edited" }));
    assert.equal(res.written, true);
    assert.equal(readLedger(dir).level, "L3");
    assert.equal(readLedger(dir).note, "edited");

    // (d) a mutation that omits level re-inherits the launch value (never a silent drop)
    mutateLedgerUnderLock(dir, () => ({ run_id: "r", owner: { status: "running" } }));
    assert.equal(readLedger(dir).level, "L3", "an omitted level re-inherits the launch value");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
