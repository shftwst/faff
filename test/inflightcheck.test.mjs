// FAFF-884 — `faff inflightcheck`: the Stop-hook backstop that makes "never end a turn
// with an Agent dispatch still in flight" mechanical, not prose. The fourth Stop-hook
// family member, sibling of runcheck/prepcheck/sentrycheck. The orchestrator writes a
// per-dispatch marker before an Agent-tool dispatch (--open) and clears it on the tool
// result (--close); this hook audits those markers at turn-end and blocks the OWNING
// session while one is open. Drives the REAL entrypoint against fixture roots, so the
// end-to-end open→hook→sweep→close path (and the pure-selftest's decision table via a
// live filesystem) is pinned, not only the in-memory decision.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

// spawnSync so we capture BOTH streams: the hook BLOCKS via a stdout decision payload,
// and (foreign / sweep) WARNS via a non-blocking stderr line. FAFF_RUN_DIR / FAFF_SESSION_ID
// default to "" so the test process's own env never leaks ownership; a case sets them.
function run(args, env) {
  const r = spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, FAFF_RUN_DIR: "", FAFF_SESSION_ID: "", ...env },
  });
  return { code: r.status ?? 1, out: (r.stdout ?? "").toString(), err: (r.stderr ?? "").toString() };
}

function freshRoot() {
  const dir = mkdtempSync(join(tmpdir(), "inflightcheck-"));
  mkdirSync(join(dir, ".faff"), { recursive: true });
  return dir;
}

// Locate the single marker file for `key` across all owner-scopes under root.
function findMarker(root, key) {
  const base = join(root, ".faff", "inflight");
  if (!existsSync(base)) return null;
  for (const scope of readdirSync(base)) {
    const p = join(base, scope, `${key}.json`);
    if (existsSync(p)) return p;
  }
  return null;
}

const S1 = { FAFF_SESSION_ID: "sess-one" };
const S2 = { FAFF_SESSION_ID: "sess-two" };

test("open → hook blocks the owning session; close → hook is silent (the strand shape)", () => {
  const root = freshRoot();
  assert.equal(run(["inflightcheck", "--open", "--key", "FAFF-1", "--describe", "spec-review", "--root", root], S1).code, 0);
  assert.ok(findMarker(root, "FAFF-1"), "marker written under the owner-scope");

  const blocked = run(["inflightcheck", "--hook", "--root", root], S1);
  // block rides the stdout decision payload, exit stays 0
  assert.equal(blocked.code, 0);
  const payload = JSON.parse(blocked.out.trim());
  assert.equal(payload.decision, "block");
  assert.match(payload.reason, /FAFF-1/);

  assert.equal(run(["inflightcheck", "--close", "--key", "FAFF-1", "--root", root], S1).code, 0);
  assert.equal(findMarker(root, "FAFF-1"), null, "marker removed by --close");
  const cleared = run(["inflightcheck", "--hook", "--root", root], S1);
  assert.equal(cleared.code, 0);
  assert.equal(cleared.out.trim(), "", "no block payload after close");
});

test("--close on an absent marker is idempotent (exit 0)", () => {
  const root = freshRoot();
  assert.equal(run(["inflightcheck", "--close", "--key", "NOPE-9", "--root", root], S1).code, 0);
});

test("hook SWEEPS an owned marker past the TTL (age alone) — never wedges turn-end", () => {
  const root = freshRoot();
  run(["inflightcheck", "--open", "--key", "FAFF-2", "--root", root], S1);
  const path = findMarker(root, "FAFF-2");
  // Backdate opened_at well past the TTL — the marker is a corpse.
  const marker = JSON.parse(readFileSync(path, "utf8"));
  marker.opened_at = new Date(Date.now() - 100000 * 1000).toISOString();
  writeFileSync(path, JSON.stringify(marker));

  const swept = run(["inflightcheck", "--hook", "--root", root], S1);
  assert.equal(swept.code, 0);
  assert.equal(swept.out.trim(), "", "a swept corpse does NOT block");
  assert.match(swept.err, /swept stale in-flight marker FAFF-2/);
  assert.equal(findMarker(root, "FAFF-2"), null, "the corpse file is removed");
});

test("owned marker with a FRESH opened_at still blocks (a real live strand)", () => {
  const root = freshRoot();
  run(["inflightcheck", "--open", "--key", "FAFF-3", "--root", root], S1);
  const blocked = run(["inflightcheck", "--hook", "--root", root], S1);
  assert.equal(blocked.code, 0);
  assert.match(blocked.out, /"decision":"block"/);
  assert.ok(findMarker(root, "FAFF-3"), "a live strand's marker is NOT swept");
});

test("malformed-but-owned marker fails CLOSED (block) — ownership is path-derived, not body-derived", () => {
  const root = freshRoot();
  // Write a corrupt body under THIS session's own owner-scope, discovered by --open first.
  run(["inflightcheck", "--open", "--key", "FAFF-4", "--root", root], S1);
  const path = findMarker(root, "FAFF-4");
  writeFileSync(path, "{ this is not json");
  const blocked = run(["inflightcheck", "--hook", "--root", root], S1);
  assert.equal(blocked.code, 0);
  assert.match(blocked.out, /"decision":"block"/, "a corrupt OWNED marker blocks (never fails open)");
});

test("a foreign marker never traps a non-owning session: fresh → silent, abandoned → warn, --recover → block", () => {
  const root = freshRoot();
  // Create the marker as session two (a different owner-scope), audit as session one.
  run(["inflightcheck", "--open", "--key", "FAFF-5", "--root", root], S2);
  const foreignFresh = run(["inflightcheck", "--hook", "--root", root], S1);
  assert.equal(foreignFresh.out.trim(), "", "foreign + fresh → silent");
  assert.equal(foreignFresh.err.trim(), "", "foreign + fresh → not even a warn");

  // Backdate the foreign marker past the TTL (no live ledger to delegate to).
  const path = findMarker(root, "FAFF-5");
  const marker = JSON.parse(readFileSync(path, "utf8"));
  marker.opened_at = new Date(Date.now() - 100000 * 1000).toISOString();
  writeFileSync(path, JSON.stringify(marker));

  const foreignAbandoned = run(["inflightcheck", "--hook", "--root", root], S1);
  assert.equal(foreignAbandoned.out.trim(), "", "foreign + abandoned → still NOT a block payload");
  assert.match(foreignAbandoned.err, /\[warn\]/, "foreign + abandoned → a non-blocking warn");
  assert.ok(findMarker(root, "FAFF-5"), "a foreign marker is never swept by a non-owner");

  const recovered = run(["inflightcheck", "--hook", "--recover", "--root", root], S1);
  assert.match(recovered.out, /"decision":"block"/, "--recover forces a foreign abandoned marker to block");
});

test("--open/--close reject a key that could escape the owner-scope directory", () => {
  const root = freshRoot();
  for (const bad of ["../evil", "a/b", ".hidden", ".."]) {
    const r = run(["inflightcheck", "--open", "--key", bad, "--root", root], S1);
    assert.equal(r.code, 2, `--open rejects ${JSON.stringify(bad)}`);
    const c = run(["inflightcheck", "--close", "--key", bad, "--root", root], S1);
    assert.equal(c.code, 2, `--close rejects ${JSON.stringify(bad)}`);
  }
  assert.equal(existsSync(join(root, ".faff", "inflight")), false, "no marker dir created for a rejected key");
});

test("N concurrent owned markers open at a Stop event all block (no false-negative on a mishandled fan-out)", () => {
  const root = freshRoot();
  for (const k of ["FAFF-10", "FAFF-11", "FAFF-12"]) run(["inflightcheck", "--open", "--key", k, "--root", root], S1);
  const blocked = run(["inflightcheck", "--hook", "--root", root], S1);
  const payload = JSON.parse(blocked.out.trim());
  assert.equal(payload.decision, "block");
  for (const k of ["FAFF-10", "FAFF-11", "FAFF-12"]) assert.match(payload.reason, new RegExp(k));
});

test("--selftest passes (the pure decision + key + slug tables)", () => {
  const r = run(["inflightcheck", "--selftest"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /RESULT: PASS/);
});
