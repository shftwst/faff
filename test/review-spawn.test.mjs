// FAFF-793 — review-spawn.mjs: the bounded, killable single-shot process-group spawner
// wrapper inserted in front of the Phase-2 adversarial-review invocation. Unit tests drive
// main() with an injected spawnFn (no real processes); the integration tests below spawn
// REAL node subprocesses — including the spec's own smoke test and the FAFF-465
// reparent-to-init repro (a target that self-backgrounds a grandchild which reparents to
// init but stays in the wrapper's process group) — to prove the group-kill actually
// reaches what the orchestrator could not kill before this ticket.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../plugin/skills/faffter-dark-adversarial-review/review-spawn.mjs";
import { WRAPPER_EXIT } from "../plugin/skills/faffter-dark-adversarial-review/killable-spawn.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "plugin", "skills", "faffter-dark-adversarial-review", "review-spawn.mjs");

// ── main() with an injected spawnFn (unit-level, no real processes) ──

test("main: --selftest delegates to killable-spawn's selftest", async () => {
  const code = await main(["--selftest"]);
  assert.equal(code, 0);
});

test("main: bad args (missing `--`) -> USAGE(2), no spawn attempted", async () => {
  let spawned = false;
  const code = await main(["--deadline", "5", "node", "x.mjs"], { spawnFn: () => { spawned = true; } });
  assert.equal(code, WRAPPER_EXIT.USAGE);
  assert.equal(spawned, false);
});

test("main: injected spawnFn whose child exits 0 -> wrapper returns 0 (pass-through)", async () => {
  const code = await main(["--deadline", "5", "--", "node", "x.mjs"], {
    spawnFn: () => ({ pid: 123, on: (ev, cb) => { if (ev === "exit") queueMicrotask(() => cb(0, null)); } }),
  });
  assert.equal(code, 0);
});

test("main: injected spawnFn whose child exits 8 (review-call.mjs's OWN graceful deadline) -> wrapper passes it through unchanged", async () => {
  const code = await main(["--deadline", "5", "--", "node", "x.mjs"], {
    spawnFn: () => ({ pid: 124, on: (ev, cb) => { if (ev === "exit") queueMicrotask(() => cb(8, null)); } }),
  });
  assert.equal(code, 8);
});

// ── Integration: real subprocesses ──

test("integration smoke test (from the spec): a target that ignores SIGTERM and never exits is hard-killed within (deadline+grace); a well-behaved target's exit code passes straight through", () => {
  const start = Date.now();
  const r1 = spawnSync(process.execPath, [
    SCRIPT, "--deadline", "2", "--grace", "1", "--",
    process.execPath, "-e", "process.on('SIGTERM',()=>{}); setInterval(()=>{}, 1000)",
  ], { encoding: "utf8" });
  const elapsedMs = Date.now() - start;
  assert.equal(r1.status, 8, r1.stderr);
  assert.ok(elapsedMs < 10000, `hard-kill backstop should fire well within the deadline+grace budget, took ${elapsedMs}ms`);
  assert.match(r1.stderr, /HARD-KILL BACKSTOP/, "the hard-kill firing must be logged loudly, distinct from a graceful exit 8");

  const r2 = spawnSync(process.execPath, [SCRIPT, "--deadline", "5", "--", process.execPath, "-e", "process.exit(7)"], { encoding: "utf8" });
  assert.equal(r2.status, 7, "a healthy inner exit code must pass through verbatim, unmodified");
});

test("integration: a fast healthy exit returns immediately — no artificial delay from the wrapper", () => {
  const start = Date.now();
  const r = spawnSync(process.execPath, [SCRIPT, "--deadline", "30", "--", process.execPath, "-e", "process.exit(0)"], { encoding: "utf8" });
  const elapsedMs = Date.now() - start;
  assert.equal(r.status, 0);
  assert.ok(elapsedMs < 3000, `a fast healthy exit must not be held up by the wrapper, took ${elapsedMs}ms`);
});

test("integration: a nonexistent target command -> SPAWN_FAILED(1), no unhandled exception", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--deadline", "5", "--", "/nonexistent/faff-793-binary-xyz"], { encoding: "utf8" });
  assert.equal(r.status, WRAPPER_EXIT.SPAWN_FAILED);
  assert.doesNotMatch(r.stderr, /Unhandled 'error' event/);
});

test("integration: SIGTERM delivered to the wrapper kills the whole group and exits 130, leaving no orphan", async () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-793-"));
  const marker = join(dir, "alive");
  // The target writes a heartbeat file every 100ms so we can positively confirm it was
  // running, then check it stops being touched once the wrapper is SIGTERM'd.
  const targetSrc = `
    const fs = require("fs");
    setInterval(() => fs.writeFileSync(${JSON.stringify(marker)}, String(Date.now())), 100);
    setInterval(() => {}, 1000);
  `;
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, [SCRIPT, "--deadline", "60", "--", process.execPath, "-e", targetSrc], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 600));   // let the target establish its heartbeat
  assert.ok(readdirSync(dir).includes("alive"), "the target should have started heartbeating before we abort it");
  const beforeKillMtime = readFileSync(marker, "utf8");
  child.kill("SIGTERM");
  const exitInfo = await new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  assert.equal(exitInfo.code, 130, "SIGTERM to the wrapper must exit 130 (128+SIGTERM)");
  await new Promise((r) => setTimeout(r, 500));
  const afterMtime = readFileSync(marker, "utf8");
  assert.equal(afterMtime, beforeKillMtime, "the target must have stopped heartbeating — the group kill reached it, it did not survive the wrapper's own exit");
});

test("FAFF-465 repro: a target that spawns a grandchild and exits immediately (the grandchild reparents to init but STAYS in the launched process group) — the whole group is reaped, no survivor", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-793-repro-"));
  const heartbeat = join(dir, "grandchild-alive");
  const targetPath = join(dir, "target.js");
  // The target spawns a non-detached grandchild (same process group by default) that
  // heartbeats to a file, then the TARGET exits immediately — reparenting the grandchild
  // to init (PPid 1) while it stays in the group the wrapper launched. This is the exact
  // FAFF-465 signature: before this ticket, such an orphan was unkillable by the
  // orchestrator (permission denied); the group kill must still reach it.
  writeFileSync(targetPath, `
    const { spawn } = require("child_process");
    const fs = require("fs");
    const hb = ${JSON.stringify(heartbeat)};
    const gc = spawn(process.execPath, ["-e", \`
      const fs = require("fs");
      setInterval(() => fs.writeFileSync(${JSON.stringify(heartbeat)}, String(Date.now())), 100);
      setInterval(() => {}, 1000);
    \`], { stdio: "ignore" });
    fs.writeFileSync(hb, "0");   // seed the file so the parent doesn't race the child's first write
    process.exit(0);   // the target exits NOW — the grandchild reparents to init, stays in the group
  `);
  const r = spawnSync(process.execPath, [SCRIPT, "--deadline", "2", "--grace", "1", "--", process.execPath, targetPath], { encoding: "utf8" });
  assert.equal(r.status, 0, "the target itself exits cleanly (0); the defensive post-exit sweep reaps the group before the deadline ever needs to fire");
  const seededMtime = readFileSync(heartbeat, "utf8");
  return new Promise((resolve) => {
    setTimeout(() => {
      const afterMtime = readFileSync(heartbeat, "utf8");
      // The grandchild must not have kept heartbeating past the wrapper's own return —
      // either it never got a chance to overwrite the seed (killed too fast) or its
      // heartbeat froze at the same value once reaped. Either way: no live survivor.
      assert.ok(afterMtime === seededMtime || Number(afterMtime) < Date.now() - 300,
        "the reparented-to-init grandchild must not still be actively heartbeating — the group kill reached it");
      resolve();
    }, 1000);
  });
});
