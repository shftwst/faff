// FAFF-1212: a configurable stub `gh` on PATH for the merge-gate / pr-create CLI tests. It answers the
// calls those commands issue from a JSON config, logs every argv (one JSON array per line) and exits 3
// on anything unhandled, so a new gh call fails loudly instead of passing silently.

import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";

const STUB = `#!/usr/bin/env node
const fs = require("node:fs");
const cfg = JSON.parse(fs.readFileSync(process.env.STUB_GH_CONFIG, "utf8"));
const args = process.argv.slice(2);
const joined = args.join(" ");
fs.appendFileSync(cfg.log, JSON.stringify(args) + "\\n");
const out = (s) => process.stdout.write(s);
const done = (code, err) => { if (err) process.stderr.write(err + "\\n"); process.exit(code); };
if (cfg.failAfterMerge && fs.existsSync(cfg.mergeSentinel)) done(1, "gh: stub failing every call after the merge");

if (args[0] === "repo" && args[1] === "view") {
  if (cfg.repoViewFails) done(1, "gh: repo view failed");
  out(JSON.stringify({ nameWithOwner: cfg.repo }));
  done(0);
}
if (args[0] === "pr") {
  if (args[1] === "view") {
    if (joined.includes("headRefOid")) out(JSON.stringify(cfg.prView));
    else out(JSON.stringify({ state: cfg.prView.state }));
    done(0);
  }
  if (args[1] === "create") { if (cfg.prCreateFails) done(1, "gh: pr create failed"); out(cfg.prCreateUrl + "\\n"); done(0); }
  if (args[1] === "merge") { fs.writeFileSync(cfg.mergeSentinel, joined); done(0); }
  if (args[1] === "checks") { out("[]"); done(0); }
}
if (args[0] === "api") {
  const probe = args.includes("-i") || args.includes("-I");
  if (joined.includes(".commissaire/trust.toml")) {
    if (probe) {
      if (cfg.trust.mode === "down") { out("HTTP/2.0 500 Server Error\\n\\n"); done(1); }
      out("HTTP/2.0 404 Not Found\\n\\n"); done(1);
    }
    if (cfg.trust.mode === "present") { out(JSON.stringify({ content: Buffer.from(cfg.trust.toml, "utf8").toString("base64"), encoding: "base64" })); done(0); }
    done(1, "gh: not found");
  }
  if (probe && joined.includes("/contents")) {
    if (joined.includes(".faff/anchors")) { out("HTTP/2 200 OK\\r\\n\\r\\n"); done(0); }
    if (cfg.trust.mode === "down") { out("HTTP/2.0 500 Server Error\\n\\n"); done(1); }
    out("HTTP/2.0 200 OK\\n\\n"); done(0);
  }
  if (joined.includes(".faff/anchors")) {
    out(JSON.stringify({ type: "file", encoding: "base64", content: Buffer.from(JSON.stringify({ run_id: "anchored", level: "L3" })).toString("base64") }));
    done(0);
  }
  if (joined.includes("/rules/branches/")) {
    if (cfg.rules === "fail") done(1, "gh: rules unavailable");
    if (cfg.rules === "garbage") { out("not json"); done(0); }
    out(JSON.stringify(cfg.rules === "pr" ? [{ type: "deletion" }, { type: "pull_request" }] : [{ type: "deletion" }]));
    done(0);
  }
  if (joined.includes("check-runs")) { out('[{"status":"completed","conclusion":"success"}]'); done(0); }
  if (joined.includes("status")) { out('{"state":"success","count":1}'); done(0); }
}
done(3, "stub gh: unhandled subcommand: " + joined);
`;

const SHA = "deadbeefcafe1234567890abcdef1234567890ab";

// config: { repo, repoViewFails, prView (object served verbatim for the identity fetch), prCreateUrl,
//   prCreateFails, trust: { mode: "present"|"absent"|"down", toml }, rules: "pr"|"none"|"fail"|"garbage",
//   failAfterMerge }
export function installStubGh(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), "faff1212-gh-"));
  const log = join(dir, "calls.log");
  const mergeSentinel = join(dir, "merge-sentinel");
  const cfgFile = join(dir, "config.json");
  const cfg = {
    log, mergeSentinel, repo: "owner/repo", prCreateUrl: "https://github.com/owner/repo/pull/9", rules: "pr",
    trust: { mode: "absent", toml: "" },
    prView: { headRefOid: SHA, headRefName: "feature", baseRefName: "main", state: "OPEN", url: "https://github.com/owner/repo/pull/1" },
    ...overrides,
  };
  writeFileSync(cfgFile, JSON.stringify(cfg));
  writeFileSync(join(dir, "gh"), STUB);
  chmodSync(join(dir, "gh"), 0o755);
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  return {
    dir,
    env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}`, STUB_GH_CONFIG: cfgFile },
    calls,
    // the plain (non-probe) trust-file contents reads: exactly one per invocation is the contract
    trustReads: () => calls().filter((a) => a[0] === "api" && !a.includes("-i") && a.join(" ").includes(".commissaire/trust.toml")),
    anyTrustCall: () => calls().filter((a) => a.join(" ").includes(".commissaire/trust.toml")),
    rulesReads: () => calls().filter((a) => a[0] === "api" && a.join(" ").includes("/rules/branches/")),
    merged: () => existsSync(mergeSentinel),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
