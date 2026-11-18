// === region:factory — prepare independent spec-review lens requests ===
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { parseArgs, usageError } = require("./argv");
const { loadConfig, fmt } = require("./config");
const { SPEC_REVIEW_LENSES } = require("./review-vocab");
const { dig, findRoot } = require("./shared-infra");
const { resolvePinChain } = require("./spec-review-pin");
const { filterEligible, readReputation, reportEligibleFilter } = require("./spec-review-reputation");
const { nextRoundNumber } = require("./spec-review-window");

const usage = "usage: faff spec-review prepare-requests --dir DIR --spec FILE [--lenses CSV] [--context FILE]... [--root DIR]";
const argumentsSpec = {
  positionals: { min: 0, max: 0 },
  flags: {
    "--dir": { arity: 1 }, "--spec": { arity: 1 }, "--lenses": { arity: 1 },
    "--context": { arity: 1, repeatable: true }, "--root": { arity: 1 },
  },
};

type BuildLensRequests = (input: {
  lenses: string[];
  backendsJson: string;
  timeout: string;
  maxTokens: string;
  deadline: string;
  systemDir: string;
  contextPaths: string[];
  diffPath: string;
  rawDir: string;
  round: number;
}) => unknown[];

// The old shell kept the original argv spelling of positive signed-64-bit integers.
function positiveSetting(value: string, fallback: string): string {
  if (/^\+?\d+$/.test(value.trim())) {
    const number = BigInt(value.trim());
    if (number > 0n && number <= 9223372036854775807n) return value;
  }
  return fallback;
}

function resolveSettings(config: unknown) {
  function setting(key: string): string | undefined {
    const value = dig(config, key);
    return value == null ? undefined : fmt(value).replace(/\n+$/, "");
  }
  function forSpec(key: string): string | undefined {
    return setting("adversarial.spec_review." + key);
  }
  function shared(key: string): string | undefined {
    return setting("adversarial." + key);
  }
  return {
    timeout: positiveSetting(forSpec("timeout") || shared("timeout") || "", "120"),
    maxTokens: positiveSetting(forSpec("max_tokens") || shared("max_tokens") || "", "2000"),
    deadline: positiveSetting(forSpec("deadline") ?? shared("deadline") ?? "", "900"),
    strategy: forSpec("dispatch_strategy") ?? shared("dispatch_strategy") ?? "prime-then-parallel",
  };
}

function warn(message: string): void {
  process.stderr.write("faff spec-review prepare-requests: " + message + "\n");
}

export function cmdPrepareRequests(argv: string[], systemDir: string, buildLensRequests: BuildLensRequests): number {
  const { values, errors } = parseArgs(argv, argumentsSpec);
  const dir = values["--dir"], diffPath = values["--spec"];
  if (errors.length) return usageError(errors, usage);
  if (!dir || !diffPath) {
    return usageError([{ code: "missing-value", detail: "--dir and --spec are required" }], usage);
  }
  const round: number = nextRoundNumber(dir);
  const unavailable = (status: 2 | 3, message: string): number => {
    warn(message);
    process.stdout.write(JSON.stringify({ round }) + "\n");
    return status;
  };
  const lenses: string[] = values["--lenses"] === undefined
    ? SPEC_REVIEW_LENSES
    : values["--lenses"].split(",").map((lens: string) => lens.trim()).filter(Boolean);
  if (!lenses.length || lenses.some(lens => !SPEC_REVIEW_LENSES.includes(lens))) {
    return unavailable(2, "--lenses must list architectural, infosec, methodology or QA");
  }

  let scratch;
  try {
    const root = values["--root"] || findRoot();
    const [config] = loadConfig(root);
    const pin = resolvePinChain(config, dir, "spec_review");
    const { timeout, maxTokens, deadline, strategy } = resolveSettings(config);
    if (BigInt(deadline.trim()) < 60n) {
      process.stderr.write(
        `WARNING: adversarial.spec_review.deadline (${deadline}s) is below the 60s sanity floor; ` +
        "a deadline this small may expire a lens before its primary backend can answer and advance the chain to a weaker fallback.\n",
      );
    }
    if (pin.error === "unset") return unavailable(3, "adversarial is unset (or its host is unset)");
    if (pin.error) return unavailable(2, pin.detail);

    let chain = pin.chain;
    if (!pin.pinned) {
      try {
        const eligible = filterEligible(chain, new Set(readReputation(root).flagged));
        reportEligibleFilter(eligible);
        chain = eligible.chain;
      } catch (error) {
        // The shell replaced the chain only when the reputation filter succeeded.
        warn(error instanceof Error ? error.message : String(error));
      }
    }

    const contextPaths: string[] = values["--context"] ?? [];
    const scope = `${dir}/ratified-scope.md`;
    if (existsSync(scope)) contextPaths.push(scope);
    scratch = mkdtempSync(join(tmpdir(), "faff-spec-review-"));
    const backends_path = join(scratch, "backends.json");
    const requests_path = join(scratch, "requests.json");
    const requests = buildLensRequests({
      lenses, backendsJson: backends_path, timeout, maxTokens, deadline, systemDir,
      contextPaths, diffPath, rawDir: `${dir}/raw`, round,
    });
    writeFileSync(backends_path, JSON.stringify(chain) + "\n", { mode: 0o600 });
    writeFileSync(requests_path, JSON.stringify(requests) + "\n", { mode: 0o600 });
    process.stdout.write(JSON.stringify({ round, strategy, backends_path, requests_path }) + "\n");
    return 0;
  } catch (error) {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
    return unavailable(2, error instanceof Error ? error.message : String(error));
  }
}
