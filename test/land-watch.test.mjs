import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CheckSnapshots } from "../plugin/skills/faff/bin/lib/land-watch.js";

const cli = fileURLToPath(new URL("../plugin/skills/faff/bin/faff", import.meta.url));
const header = "Refreshing checks status every 15 seconds. Press Ctrl+C to quit.\n\n";
const row = "unit\tpending\t0\tURL\t\n";
const poll = header + row;
const marker = (n) => `[previous check snapshot repeated ${n} times]\n`;

async function encode(input) {
  const stream = new CheckSnapshots();
  const chunks = [];
  stream.on("data", chunk => chunks.push(chunk));
  for (const byte of input) stream.write(Buffer.from([byte]));
  stream.end();
  await once(stream, "end");
  return Buffer.concat(chunks);
}

test("only adjacent byte-identical complete polls collapse, even with chunk splits", async () => {
  const crlf = poll.replaceAll("\n", "\r\n");
  const two = poll + "build\tpass\t1s\tURL\t\n";
  const unknown = "unrecognised check format\n";
  const bytes = Buffer.from([0xff, 0x81]);
  const raw = poll.repeat(3) + two.repeat(2) + poll + unknown + poll + crlf.repeat(2);
  const expected = poll + marker(2) + two + marker(1) + poll + unknown + poll + crlf + marker(1);
  assert.deepEqual(await encode(Buffer.concat([Buffer.from(raw), bytes])), Buffer.concat([Buffer.from(expected), bytes]));
  for (const literal of [header.repeat(2), row.repeat(3), poll + header + row.trimEnd(), header + unknown + header + unknown]) {
    assert.deepEqual(await encode(Buffer.from(literal)), Buffer.from(literal));
  }
});

function fakeGh(t, program) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "land-watch-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, "gh"), "#!" + process.execPath + "\n" + program, { mode: 0o755 });
  return { ...process.env, PATH: dir };
}

test("public command preserves arguments, diagnostics, exit codes and no-check output", (t) => {
  const env = fakeGh(t, `
    if (JSON.stringify(process.argv.slice(2)) !== '["pr","checks","42","--watch","--interval","15"]') process.exit(33);
    process.stdout.write(process.env.ROWS);
    process.stderr.write('gh diagnostic');
    process.exitCode = Number(process.env.EXIT);
  `);
  for (const code of [0, 1, 8]) {
    const r = spawnSync(process.execPath, [cli, "land", "watch", "--pr", "42"], {
      env: { ...env, ROWS: code === 1 ? "" : poll.repeat(3), EXIT: String(code) }, encoding: "utf8",
    });
    assert.equal(r.status, code);
    assert.equal(r.stdout, code === 1 ? "" : poll + marker(2));
    assert.equal(r.stderr, "gh diagnostic");
  }
  for (const args of [["--pr", "HEAD"], ["--pr", "42", "--other"], []]) {
    assert.equal(spawnSync(process.execPath, [cli, "land", "watch", ...args], { env }).status, 2);
  }
  const absent = spawnSync(process.execPath, [cli, "land", "watch", "--pr", "42"], { env: { ...env, PATH: "" }, encoding: "utf8" });
  assert.equal(absent.status, 127);
  assert.match(absent.stderr, /gh.*ENOENT/);
});

test("first poll is live and timeout signals reach the child and remain visible to the caller", { timeout: 7000 }, async (t) => {
  const env = fakeGh(t, `process.stdout.write(${JSON.stringify(poll)}); setInterval(() => {}, 60000);`);
  const child = spawn(process.execPath, [cli, "land", "watch", "--pr", "42"], { env });
  t.after(() => child.kill("SIGKILL"));
  const closed = once(child, "close");
  let seen = "";
  for await (const chunk of child.stdout) {
    seen += chunk;
    if (seen === poll) child.kill("SIGTERM");
  }
  assert.deepEqual(await closed, [null, "SIGTERM"]);
  assert.equal(seen, poll);
});
