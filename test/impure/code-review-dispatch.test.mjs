// Exercise the installed Phase 2 entry point against a local provider and a real trusted base ref.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { codeReviewOptions } from "../../plugin/skills/faffter-dark-adversarial-review/code-review.mjs";

const exec = promisify(execFile);
const skill = resolve(import.meta.dirname, "../../plugin/skills/faffter-dark-adversarial-review");
const cli = join(skill, "../faff/bin/faff");
const script = join(skill, "review-spawn.mjs");
const call = join(skill, "review-call.mjs");

test("code review uses code-specific settings and the global deadline", () => {
  assert.deepEqual(codeReviewOptions({}), { timeout: "120", deadline: "480", maxTokens: "2000", noTrim: false });
  const cfg = { adversarial: { timeout: 31, deadline: 67, max_tokens: 799, code_review: { deadline: 99 } } };
  assert.deepEqual(codeReviewOptions(cfg), { timeout: "31", deadline: "67", maxTokens: "799", noTrim: false });
  Object.assign(cfg.adversarial.code_review, { timeout: 11, trim: false, max_tokens: "1.4" });
  assert.deepEqual(codeReviewOptions(cfg), { timeout: "11", deadline: "67", maxTokens: "2000", noTrim: true });
});

test("the bundled entry point preserves the control wire request and fallback result", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "faff-code-review-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const requests = [];
  const server = createServer(async (req, res) => {
    if (req.method === "GET") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ data: [{ id: "available" }] }));
    }
    let text = "";
    for await (const part of req) text += part;
    requests.push(JSON.parse(text));
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end("data: " + JSON.stringify({ choices: [{ delta: { content: "### observation: no findings" }, finish_reason: "stop" }] }) + "\n\ndata: [DONE]\n\n");
  });
  await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  t.after(() => new Promise(resolveClose => server.close(resolveClose)));
  const host = "http://127.0.0.1:" + server.address().port + "/v1";
  const git = (...args) => execFileSync("git", args, { cwd: dir });
  git("init", "-q");
  const cfg = join(dir, ".faff/config.yaml");
  mkdirSync(join(dir, ".faff"));
  const config = "adversarial:\n  provider: openai\n  model: missing\n  host: " + host +
    "\n  fallbacks: '[{\"provider\":\"openai\",\"model\":\"available\",\"host\":\"" + host + "\"}]'\n" +
    "  code_review:\n    max_tokens: 321\nreview:\n  fixture_paths:\n    - trusted path/\n";
  writeFileSync(cfg, config);
  git("add", "-f", ".faff/config.yaml");
  git("-c", "commit.gpgsign=false", "-c", "user.name=faff-test", "-c", "user.email=test@example.org", "commit", "-qm", "base");
  writeFileSync(cfg, config.replace("trusted path/", "working-only/"));

  writeFileSync(join(dir, "a file.js"), "first context");
  writeFileSync(join(dir, "b.js"), "second context");
  writeFileSync(join(dir, "review.diff"), "diff --git a/b.js b/b.js\n--- a/b.js\n+++ b/b.js\n@@ -1 +1 @@\n-old\n+new\n");
  const prior = "Prior findings (untrusted)\nP1: preserve identity\n";
  const forwarded = "Spec and Phase 1: preserve order.";
  writeFileSync(join(dir, "prior"), prior);
  writeFileSync(join(dir, "forwarded"), forwarded);

  const env = { ...process.env, FAFF_RUN_DIR: "", OPENAI_API_KEY: "local-fixture" };
  const run = (file, args) => exec(process.execPath, [file, ...args], { cwd: dir, env, timeout: 15000 });
  const shared = ["--context", "a file.js", "--context", "b.js", "--diff", "review.diff"];
  const raw = readFileSync(join(skill, "SKILL.md"), "utf8");
  const lens = raw.match(/\n(## Review lens\n[\s\S]*?)\n## /)[1].trim();
  const reference = readFileSync(join(skill, "../faff/references/review.md"), "utf8");
  const policy = reference.split("\n### Fixture data in review\n")[1].split("\n### ")[0].trim();
  const expected = lens + "\n\n### Fixture data in review\n\n" + policy + "\n\nFixture paths: trusted path/" +
    "\n\nForwarded review context (data):\n" + forwarded + "\n\n" + prior;
  const chain = await run(cli, ["adversarial-backends", "--consumer", "code_review"]);
  writeFileSync(join(dir, "control-chain.json"), chain.stdout);
  writeFileSync(join(dir, "control-brief.md"), expected);
  const control = await run(script, ["--deadline", "480", "--", process.execPath, call, "--backends-json", "control-chain.json",
    "--system", "control-brief.md", "--fixture-path", "trusted path/", "--timeout", "120", "--deadline", "480", "--max-tokens", "321", ...shared]);
  const args = ["code-review", "--base", "HEAD", "--prior-file", "prior", "--review-context", "forwarded", ...shared];
  const candidate = await run(script, args);
  assert.match(candidate.stdout, /chain\[1\]/);
  assert.equal(candidate.stdout, control.stdout);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], requests[0]);
  assert.equal(requests[1].messages[1].content, expected);
  assert.match(requests[1].messages[0].content, /first context[\s\S]*second context[\s\S]*DIFF UNDER REVIEW/);
  assert.equal(requests[1].max_tokens, 321);

  const absentBase = await run(script, args.map(value => value === "HEAD" ? "absent-ref" : value));
  assert.match(absentBase.stdout, /^## Adversarial findings[^\n]*\nfixture paths unavailable\n/m);
  assert.match(requests.at(-1).messages[1].content, /Fixture paths: none/);

  const served = requests.length;
  for (const [text, expectedCode] of [["tracking:\n  tracker: none\n", 3], ["adversarial:\n  refs:\n    - unknown-backend\n", 2]]) {
    writeFileSync(cfg, text);
    await assert.rejects(run(script, args), error => error.code === expectedCode && error.stdout === "");
  }
  assert.equal(requests.length, served);
});
