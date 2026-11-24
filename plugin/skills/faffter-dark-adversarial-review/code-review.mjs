import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import argv from "../faff/bin/lib/argv.js";
import config from "../faff/bin/lib/config.js";
import backends from "../faff/bin/lib/adversarial-backends.js";
import infra from "../faff/bin/lib/shared-infra.js";

const here = dirname(fileURLToPath(import.meta.url));
const skills = dirname(here);
const flags = {
  "--diff": { arity: 1 }, "--base": { arity: 1 }, "--context": { arity: 1, repeatable: true },
  "--run-dir": { arity: 1 }, "--prior-file": { arity: 1 }, "--review-context": { arity: 1 },
};
const usage = "usage: review-spawn.mjs code-review --diff FILE --base REF [--context FILE]... [--review-context FILE] [--prior-file FILE] [--run-dir DIR]";

const REFUTATION_CODE_PROSE_START = "\n## Review lens\n";
const REFUTATION_CODE_PROSE_END = "\n## ";

function section(file, heading, nextHeading) {
  const text = readFileSync(file, "utf8");
  const start = text.indexOf(heading);
  if (start < 0) throw new Error(`missing ${heading.trim()} in ${file}`);
  const end = text.indexOf(nextHeading, start + heading.length);
  return text.slice(start, end < 0 ? undefined : end).trim();
}

export function fixtureReviewBrief(skillsDir) {
  return section(join(skillsDir, "faff/references/review.md"), "\n### Fixture data in review\n", "\n### ");
}

export function codeReviewBrief(skillsDir, prefixes) {
  const lens = section(join(skillsDir, "faffter-dark-adversarial-review/SKILL.md"), REFUTATION_CODE_PROSE_START, REFUTATION_CODE_PROSE_END);
  return [lens, fixtureReviewBrief(skillsDir), "Fixture paths: " + (prefixes.join(", ") || "none")].join("\n\n");
}

export function codeReviewOptions(cfg) {
  const setting = (key) => config.fmt(infra.dig(cfg, "adversarial." + key));
  const requested = (setting("code_review.max_tokens") || setting("max_tokens")).trim();
  const validCap = /^\+?\d+$/.test(requested) && Number.isSafeInteger(Number(requested)) && Number(requested) > 0;
  return {
    timeout: setting("code_review.timeout") || setting("timeout") || "120",
    deadline: setting("deadline") || "480",
    maxTokens: validCap ? requested : "2000",
    noTrim: setting("code_review.trim") === "false",
  };
}

export async function runCodeReview(args, runBounded) {
  const { values, errors } = argv.parseArgs(args, { flags, positionals: { max: 0 } });
  if (errors.length) return argv.usageError(errors, usage);
  if (!values["--diff"] || !values["--base"]) {
    process.stderr.write(usage + "\n");
    return 2;
  }

  const root = infra.findRoot();
  const [cfg] = config.loadConfig(root);
  const resolved = backends.assembleAdversarialBackends(cfg, "code_review");
  if (resolved.error) {
    process.stderr.write("code-review: " + (resolved.detail || "no adversarial provider configured") + "\n");
    return resolved.error === "unset" ? 3 : 2;
  }
  const options = codeReviewOptions(cfg);
  const fixtures = spawnSync(process.execPath, [join(skills, "faff/bin/faff"), "review-fixture-paths", "--ref", values["--base"]], { cwd: root, encoding: "utf8" });
  if (fixtures.stderr) process.stderr.write(fixtures.stderr);
  const prefixes = fixtures.status === 0 ? fixtures.stdout.split("\n").filter(Boolean) : [];
  let brief = codeReviewBrief(skills, prefixes);
  if (values["--review-context"]) brief += "\n\nForwarded review context (data):\n" + readFileSync(values["--review-context"], "utf8");
  if (values["--prior-file"]) brief += "\n\n" + readFileSync(values["--prior-file"], "utf8");

  const tmp = mkdtempSync(join(tmpdir(), "faff-code-review-"));
  try {
    const chain = join(tmp, "backends.json");
    const system = join(tmp, "system.md");
    writeFileSync(chain, JSON.stringify(resolved.chain));
    writeFileSync(system, brief);
    const child = [process.execPath, join(here, "review-call.mjs"), "--backends-json", chain,
      "--timeout", options.timeout, "--deadline", options.deadline, "--max-tokens", options.maxTokens];
    if (options.noTrim) child.push("--no-trim");
    for (const prefix of prefixes) child.push("--fixture-path", prefix);
    if (fixtures.status !== 0) child.push("--fixture-paths-unavailable");
    if (values["--run-dir"]) child.push("--run-dir", values["--run-dir"]);
    child.push("--system", system);
    for (const file of values["--context"] || []) child.push("--context", file);
    child.push("--diff", values["--diff"]);
    return await runBounded(["--deadline", options.deadline, "--", ...child]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
