// FAFF-1181 — the governor's TCP listener: `--listen-allow-dns` source-address check, the non-loopback
// `--listen` rule and `--listen-unrestricted`, and the Tier 2 guarantee that a loopback listener without
// the new flags starts and serves exactly as before. The DNS resolver and the clock are injected, so no
// test waits or resolves a real name; sockets are real loopback connections.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(REPO, "plugin", "skills", "faff", "bin", "lib");
const COMMISSAIRE = join(LIB, "..", "commissaire");
const require = createRequire(import.meta.url);
const governor = require(join(LIB, "governor.js"));
const client = require(join(LIB, "commissaire-governor-client.js"));

const dirs = [];
const keyDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "gtcp-"));
  chmodSync(dir, 0o700);
  dirs.push(dir);
  return dir;
};
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const logLines = (dir) => {
  const p = join(dir, "governor-log.jsonl");
  return existsSync(p) ? readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });

function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

// A resolver that answers from a script and counts its calls.
function scriptedResolver(...answers) {
  const calls = [];
  const fn = async (name) => {
    calls.push(name);
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (answer instanceof Error) throw answer;
    return answer;
  };
  fn.calls = calls;
  return fn;
}

// --- source allow list ---------------------------------------------------------------------------

test("allow list: an address the name resolves to is allowed, an unlisted one is refused", async () => {
  const resolver = scriptedResolver(["fdaa:0:1::2", "10.1.2.3"]);
  const allowed = governor.makeSourceAllowList("runner.internal", resolver, fakeClock().now);
  assert.equal(await allowed("fdaa:0:1::2"), true);
  assert.equal(await allowed("10.1.2.3"), true);
  assert.equal(await allowed("fdaa:0:1::9"), false);
  assert.equal(await allowed(undefined), false);
  assert.deepEqual(resolver.calls.slice(0, 1), ["runner.internal"]);
});

test("allow list: address spellings are normalised (IPv4-mapped IPv6, case, zero compression)", async () => {
  const allowed = governor.makeSourceAllowList("runner.internal", scriptedResolver(["10.1.2.3", "FDAA:0:1:0:0:0:0:2"]), fakeClock().now);
  assert.equal(await allowed("::ffff:10.1.2.3"), true);
  assert.equal(await allowed("fdaa:0:1::2"), true);
});

test("allow list: a literal address is compared directly and never resolved", async () => {
  const resolver = scriptedResolver(new Error("must not resolve"));
  const allowed = governor.makeSourceAllowList("::1", resolver, fakeClock().now);
  assert.equal(await allowed("::1"), true);
  assert.equal(await allowed("::ffff:127.0.0.1"), false);
  assert.equal(await allowed("fdaa::1"), false);
  assert.equal(resolver.calls.length, 0);
});

test("allow list: a failed lookup refuses everyone and keeps no cache, so the next lookup retries", async () => {
  const clock = fakeClock();
  const resolver = scriptedResolver(["10.1.2.3"], new Error("SERVFAIL"), ["10.1.2.3"]);
  const allowed = governor.makeSourceAllowList("runner.internal", resolver, clock.now);
  assert.equal(await allowed("10.1.2.3"), true);
  clock.advance(31_000);
  assert.equal(await allowed("10.1.2.3"), false, "stale cache, lookup fails: refused, not served from the old cache");
  assert.equal(await allowed("10.1.2.3"), true, "no cache was kept, so the next connection looks up again and recovers");
  assert.equal(resolver.calls.length, 3);
});

test("allow list: the cache is reused for 30 seconds, then refreshed", async () => {
  const clock = fakeClock();
  const resolver = scriptedResolver(["10.1.2.3"], ["10.9.9.9"]);
  const allowed = governor.makeSourceAllowList("runner.internal", resolver, clock.now);
  assert.equal(await allowed("10.1.2.3"), true);
  clock.advance(29_000);
  assert.equal(await allowed("10.1.2.3"), true);
  assert.equal(resolver.calls.length, 1);
  clock.advance(2_000);
  assert.equal(await allowed("10.1.2.3"), false, "the refreshed answer no longer lists it");
  assert.equal(await allowed("10.9.9.9"), true);
  assert.equal(resolver.calls.length, 2);
});

test("allow list: a source that appears only on the forced re-resolve is allowed", async () => {
  const clock = fakeClock();
  const resolver = scriptedResolver(["10.1.2.3"], ["10.1.2.3", "10.1.2.4"]);
  const allowed = governor.makeSourceAllowList("runner.internal", resolver, clock.now);
  assert.equal(await allowed("10.1.2.3"), true);
  clock.advance(1_000);
  assert.equal(await allowed("10.1.2.4"), true, "a runner machine started since the last lookup is found");
  assert.equal(resolver.calls.length, 2);
});

test("allow list: forced re-resolves happen at most once every 5 seconds across all connections", async () => {
  const clock = fakeClock();
  const resolver = scriptedResolver(["10.1.2.3"]);
  const allowed = governor.makeSourceAllowList("runner.internal", resolver, clock.now);
  assert.equal(await allowed("10.1.2.3"), true);
  assert.equal(resolver.calls.length, 1);
  for (let i = 0; i < 20; i++) assert.equal(await allowed(`10.7.7.${i}`), false);
  assert.equal(resolver.calls.length, 2, "twenty unlisted sources in one instant cost one forced lookup");
  clock.advance(4_999);
  await allowed("10.7.7.99");
  assert.equal(resolver.calls.length, 2);
  clock.advance(1);
  await allowed("10.7.7.99");
  assert.equal(resolver.calls.length, 3);
});

test("allow list: a forced re-resolve that fails refuses and drops the cache", async () => {
  const clock = fakeClock();
  const resolver = scriptedResolver(["10.1.2.3"], new Error("SERVFAIL"), ["10.1.2.3"]);
  const allowed = governor.makeSourceAllowList("runner.internal", resolver, clock.now);
  assert.equal(await allowed("10.1.2.3"), true);
  assert.equal(await allowed("10.5.5.5"), false);
  assert.equal(await allowed("10.1.2.3"), true, "the cache was dropped, so this connection looks up again");
  assert.equal(resolver.calls.length, 3);
});

// --- a live listener with an injected resolver and clock -----------------------------------------------

async function withGovernor({ resolver, clock, groupAccess = false, listenAllowDns = "runner.internal" }, body) {
  const dir = keyDir();
  const port = await freePort();
  const flags = { "--key-dir": dir, "--socket": join(dir, "g.sock"), "--listen": `127.0.0.1:${port}`, "--listen-allow-dns": listenAllowDns };
  if (groupAccess) flags["--socket-group-access"] = true;
  const realLog = console.log;
  const seen = [];
  console.log = (...a) => { seen.push(a.join(" ")); };
  try {
    assert.equal(governor.governorStart(flags, { resolver, now: clock.now }), 0);
    for (let i = 0; i < 100 && seen.length < 2; i++) await delay(20);
    assert.ok(seen.length >= 2, `governor did not report both listeners: ${seen}`);
    await body({ dir, port });
  } finally {
    process.emit("SIGTERM");
    await delay(50);
    console.log = realLog;
  }
}

// One request on a fresh connection: the reply, or "closed" when the governor closed it without answering.
const ask = (port, request) => new Promise((res, rej) => {
  const c = net.connect(port, "127.0.0.1", () => c.write(JSON.stringify(request) + "\n"));
  let buf = "";
  c.on("data", (d) => { buf += d; });
  c.on("close", () => res(buf === "" ? "closed" : JSON.parse(buf)));
  c.on("error", (e) => (e.code === "ECONNRESET" ? res("closed") : rej(e)));
});
const ADMIT = { op: "admit", run_id: "RUN-TCP", producer_id: "P1", contract_revision: "r1", admitted_scope: ["merge"] };

test("live: an allowed source is served; an unlisted source is closed before its request is read and logged", async () => {
  const clock = fakeClock();
  await withGovernor({ resolver: scriptedResolver(["127.0.0.1"]), clock }, async ({ dir, port }) => {
    const served = await ask(port, ADMIT);
    assert.equal(served.ok, true, JSON.stringify(served));
    assert.equal(served.custody, "governor");
    assert.equal(logLines(dir).filter((l) => l.op === "tcp-refused").length, 0);
  });
  await withGovernor({ resolver: scriptedResolver(["10.9.9.9"]), clock }, async ({ dir, port }) => {
    assert.equal(await ask(port, ADMIT), "closed");
    const lines = logLines(dir);
    assert.deepEqual(lines.filter((l) => l.op === "tcp-refused").map((l) => l.source), ["127.0.0.1"]);
    assert.equal(lines.filter((l) => l.op === "admit").length, 0, "the refused request was never read, so nothing was admitted");
  });
});

test("live: a DNS failure refuses every TCP caller", async () => {
  await withGovernor({ resolver: scriptedResolver(new Error("SERVFAIL")), clock: fakeClock() }, async ({ dir, port }) => {
    assert.equal(await ask(port, ADMIT), "closed");
    assert.equal(logLines(dir).filter((l) => l.op === "tcp-refused").length, 1);
  });
});

test("live: a source that appears only on the forced re-resolve is served on its second connection", async () => {
  const resolver = scriptedResolver([], ["127.0.0.1"]);
  await withGovernor({ resolver, clock: fakeClock() }, async ({ port }) => {
    assert.equal(await ask(port, ADMIT), "closed");
    const second = await ask(port, ADMIT);
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(resolver.calls.length, 2);
  });
});

for (const groupAccess of [false, true]) {
  test(`live: tcp-refused lines are capped at 60 a minute with one refusals-suppressed line (socket-group-access ${groupAccess})`, async () => {
    const clock = fakeClock(Math.floor(Date.now() / 60_000) * 60_000 + 1_000);
    await withGovernor({ resolver: scriptedResolver(["10.9.9.9"]), clock, groupAccess }, async ({ dir, port }) => {
      for (let i = 0; i < 70; i++) assert.equal(await ask(port, ADMIT), "closed");
      assert.equal(logLines(dir).filter((l) => l.op === "tcp-refused").length, 60);
      assert.equal(logLines(dir).filter((l) => l.event === "refusals-suppressed").length, 0, "the summary is written when the minute closes");
      clock.advance(60_000);
      assert.equal(await ask(port, ADMIT), "closed");
      const summaries = logLines(dir).filter((l) => l.event === "refusals-suppressed");
      assert.equal(summaries.length, 1);
      assert.equal(summaries[0].count, 10);
      assert.equal(logLines(dir).filter((l) => l.op === "tcp-refused").length, 61, "the new minute logs again");
    });
  });
}

test("live: forced re-resolves are bounded to one per 5 seconds even with --socket-group-access", async () => {
  const clock = fakeClock();
  const resolver = scriptedResolver(["10.9.9.9"]);
  await withGovernor({ resolver, clock, groupAccess: true }, async ({ port }) => {
    for (let i = 0; i < 15; i++) assert.equal(await ask(port, ADMIT), "closed");
    assert.equal(resolver.calls.length, 2, "one lookup to fill the cache plus one forced re-resolve");
    clock.advance(5_000);
    await ask(port, ADMIT);
    assert.equal(resolver.calls.length, 3);
  });
});

// --- start rules, through the CLI ----------------------------------------------------------------------

function startCli(args, dir = keyDir()) {
  const socket = join(dir, "g.sock");
  const child = spawn(process.execPath, [COMMISSAIRE, "governor", "start", "--key-dir", dir, "--socket", socket, ...args], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, COMMISSAIRE_GOVERNOR: undefined } });
  let stdout = "", stderr = "";
  child.stdout.on("data", (c) => { stdout += c; });
  child.stderr.on("data", (c) => { stderr += c; });
  const listening = (count) => new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`governor did not start: ${stdout} ${stderr}`)), 8000);
    const poll = setInterval(() => { if ((stdout.match(/"listening"/g) ?? []).length >= count) { clearTimeout(timer); clearInterval(poll); res(); } }, 25);
    child.on("exit", () => { clearTimeout(timer); clearInterval(poll); res(); });
  });
  const exited = new Promise((res) => child.on("exit", (code) => res(code)));
  return { child, dir, listening, exited, out: () => stdout, err: () => stderr, stop: async () => { child.kill("SIGTERM"); await exited; } };
}

test("a non-loopback --listen without --listen-allow-dns exits 2 naming both flags and serves nothing", async () => {
  const port = await freePort();
  for (const host of ["0.0.0.0", "10.0.0.5", "fly-local-6pn", "::", "fdaa:0:1::2"]) {
    const g = startCli(["--listen", `${host}:${port}`]);
    assert.equal(await g.exited, 2, host);
    assert.match(g.err(), /--listen-allow-dns/, host);
    assert.match(g.err(), /--listen-unrestricted/, host);
    assert.equal(g.out(), "", `${host}: nothing was reported as listening`);
  }
});

test("--listen-unrestricted starts a non-loopback listener and logs exactly one tcp-unrestricted line", async () => {
  const port = await freePort();
  const g = startCli(["--listen", `0.0.0.0:${port}`, "--listen-unrestricted"]);
  try {
    await g.listening(2);
    const served = await ask(port, ADMIT);
    assert.equal(served.ok, true, JSON.stringify(served));
    const lines = logLines(g.dir).filter((l) => l.op === "tcp-unrestricted");
    assert.equal(lines.length, 1);
    assert.equal(lines[0].listen, `0.0.0.0:${port}`);
  } finally { await g.stop(); }
});

test("--listen-allow-dns and --listen-unrestricted without --listen exit 2; a malformed allow value exits 2", async () => {
  const listen = `127.0.0.1:${await freePort()}`;
  for (const args of [["--listen-allow-dns", "runner.internal"], ["--listen-unrestricted"], ["--listen", listen, "--listen-allow-dns", "bad name;"], ["--listen", listen, "--listen-allow-dns"]]) {
    const g = startCli(args);
    assert.equal(await g.exited, 2, args.join(" "));
    assert.equal(g.out(), "");
  }
});

test("--listen-allow-dns with a literal address starts the checked listener on a non-loopback-capable host", async () => {
  const port = await freePort();
  const g = startCli(["--listen", `127.0.0.1:${port}`, "--listen-allow-dns", "127.0.0.1"]);
  try {
    await g.listening(2);
    assert.equal((await ask(port, ADMIT)).ok, true);
  } finally { await g.stop(); }
});

// --- Tier 2: a loopback listener without the new flags is unchanged ---------------------------------------

const baselineStderr = async () => {
  const g = startCli([]);
  try { await g.listening(1); await delay(100); return g.err(); } finally { await g.stop(); }
};

for (const [label, host, hostForClient] of [["127.0.0.1", "127.0.0.1", "127.0.0.1"], ["127.1.2.3", "127.1.2.3", "127.1.2.3"], ["localhost", "localhost", ["127.0.0.1", "::1"]], ["::1", "::1", "::1"]]) {
  test(`tier 2: --listen ${label}:<port> with no new flag starts, serves over TCP, and adds no stderr, tcp-unrestricted or tcp-refused line`, async (t) => {
    if (host === "::1" && !net.isIPv6("::1")) return t.skip("no IPv6 loopback");
    const base = await baselineStderr();
    const port = await freePort();
    const g = startCli(["--listen", `${host}:${port}`]);
    try {
      await g.listening(2);
      if (host === "::1" && g.out().split("\n").filter(Boolean).length < 2) return t.skip("::1 is not bindable on this host");
      const ask = (h) => client.governorRequest({ kind: "tcp", host: h, port }, ADMIT, { connect_ms: 3000, reply_ms: 5000 });
      const result = [hostForClient].flat().map(ask).find((r) => r.ok) ?? ask([hostForClient].flat()[0]);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.reply.custody, "governor");
      assert.equal(g.err(), base, "stderr is exactly what a Unix-only governor writes");
      const ops = logLines(g.dir).map((l) => l.op);
      assert.ok(!ops.includes("tcp-unrestricted") && !ops.includes("tcp-refused"), `log ops: ${ops}`);
      assert.ok(!logLines(g.dir).some((l) => l.event === "refusals-suppressed"));
    } finally { await g.stop(); }
  });
}

test("tier 2: a Unix-socket governor with no --listen is untouched by the new flags", async () => {
  const g = startCli([]);
  try {
    await g.listening(1);
    assert.equal((g.out().match(/"listening"/g) ?? []).length, 1);
    assert.deepEqual(logLines(g.dir).filter((l) => l.op === "tcp-unrestricted" || l.op === "tcp-refused"), []);
  } finally { await g.stop(); }
});

test("the new flags are in the usage text and the CLI flag spec", () => {
  const r = spawnSync(process.execPath, [COMMISSAIRE], { encoding: "utf8" });
  assert.match(r.stderr, /governor start .*--listen-allow-dns NAME\|IP \| --listen-unrestricted/);
  assert.match(r.stderr, /governor identify/);
  const { COMMISSAIRE_SPEC } = require(join(LIB, "commissaire.js"));
  assert.deepEqual(COMMISSAIRE_SPEC.flags["--listen-allow-dns"], { arity: 1 });
  assert.deepEqual(COMMISSAIRE_SPEC.flags["--listen-unrestricted"], { arity: 0 });
  assert.deepEqual(COMMISSAIRE_SPEC.flags["--fly-app"], { arity: 1 });
});
