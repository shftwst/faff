// FAFF-1058, the fixed fixture + capture helper for the default code-review payload baseline.
//
// Single-sources the fixture so the committed golden (default-code-review-payload.json) and the test that
// asserts against it never drift. No node:test registrations and no top-level execution, so node --test's
// recursive discovery imports it as a clean no-op (same shape as regenerate.mjs / hermetic-env.mjs).
//
// The baseline pins the two wire strings main() hands the backend for the DEFAULT unified code-review
// dispatch (adversarial.code_review.trim unset/true): `system` = the shared context+diff block after the
// FAFF-903 prefix swap (assembleUserMessage over the pass-1-trimmed context), `user` = the review lens.
// The unified trim path is unchanged by FAFF-1058 (D3 removed only prose machinery), so these strings are
// byte-identical to today; the pre-change equivalence of the unified trim itself is separately pinned by
// the faff-1051 unified goldens, which regenerate.mjs stamps with the merge-base commit sha.

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../../plugin/skills/faffter-dark-adversarial-review/review-call.mjs";

// A fixed, deterministic unified fixture: a >48 KB context file (so the FAFF-915 pass-1 trim fires) with a
// real unified diff anchoring a handful of identifiers, plus a declared context_window (so the FAFF-1039
// window check runs). No randomness, no clock.
export function buildDefaultCodeReviewInputs() {
  const contextPath = "src/dense.js";
  const body = [];
  for (let i = 0; i < 3000; i++) body.push(`const fn${i} = ${i}; // ${"p".repeat(24)}`);
  const contextText = body.join("\n");
  const anchors = [100, 900, 1700, 2500];
  const hunks = ["--- a/src/dense.js", "+++ b/src/dense.js"];
  for (const ln of anchors) {
    hunks.push(`@@ -${ln + 1},1 +${ln + 1},2 @@`, `+  use(fn${ln});`);
  }
  const diff = hunks.join("\n") + "\n";
  const lensBrief = "## Review lens\n\nFind correctness bugs the author is likely to have missed.";
  const contextWindow = 200000;
  return { contextPath, contextText, diff, lensBrief, contextWindow };
}

// Run main() over the fixture with a capturing backend runner and return the { system, user } wire strings
// of the served call. Used by both the golden generator and the byte-identity test.
export async function captureDefaultCodeReviewPayload() {
  const { contextPath, contextText, diff, lensBrief, contextWindow } = buildDefaultCodeReviewInputs();
  // A FIXED directory (not mkdtemp) so the `<file path=…>` wrapper in the captured wire string is
  // deterministic across runs, the payload is byte-for-byte reproducible, which the golden depends on.
  const d = join(tmpdir(), "faff1058-baseline-fixed");
  mkdirSync(d, { recursive: true });
  const sys = join(d, "lens.md");
  const diffFile = join(d, "code.diff");
  writeFileSync(sys, lensBrief);
  writeFileSync(diffFile, diff);
  const backends = join(d, "backends.json");
  writeFileSync(backends, JSON.stringify([{ provider: "openai", model: "primary", host: "http://primary/v1", context_window: contextWindow }]));
  // The `<file path=…>` wrapper carries the --context arg verbatim, so the context path must be stable and
  // machine-independent. Pass a bare relative name and run from `d`, so the wire string holds only the
  // filename, not a mkdtemp prefix or a machine-specific temp root. sys/diff paths never reach the wire.
  const ctxName = contextPath.replace(/\//g, "_");
  writeFileSync(join(d, ctxName), contextText);

  let captured = null;
  const runReviewFn = async ({ system, user }) => {
    if (captured === null) captured = { system, user };
    return { status: "ok", content: "### observation: no findings" };
  };
  const cwd0 = process.cwd();
  const outW = process.stdout.write.bind(process.stdout);
  const errW = process.stderr.write.bind(process.stderr);
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  let exit;
  try {
    process.chdir(d);
    exit = await main(["--backends-json", backends, "--system", sys, "--diff", diffFile, "--context", ctxName], { runReviewFn });
  } finally {
    process.chdir(cwd0);
    process.stdout.write = outW;
    process.stderr.write = errW;
  }
  return { exit, ...captured };
}
