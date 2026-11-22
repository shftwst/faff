// === region:factory — compose advisory autonomous entry checks ===
const { parseArgs, usageError }: {
  parseArgs(args: string[], spec: unknown): { values: Record<string, string | undefined>; errors: unknown[] };
  usageError(errors: unknown[], usage: string): number;
} = require("./argv");
const { loadConfig }: { loadConfig(root: string): [unknown, ...unknown[]] } = require("./config");
const { findRoot }: { findRoot(): string } = require("./shared-infra");
const { collectKnownSecretValues, redactKnownSecrets }: {
  collectKnownSecretValues(config: unknown, env: NodeJS.ProcessEnv): string[];
  redactKnownSecrets(value: string, secrets: string[]): string;
} = require("./redact");

type Container = { result: "contained" | "not_confirmed"; basis: string };
type Socket = { present: boolean; path: string | null };
type Auth = { status: "authed" | "auth-failed" | "indeterminate"; basis: string };
type Protection = { status: "protected" | "unprotected" | "indeterminate"; basis: string };
const { containerCheck, hostSocketProbe, realFsq }: {
  realFsq(): object;
  containerCheck(env: NodeJS.ProcessEnv, fsq: object): Container;
  hostSocketProbe(fsq: object): Socket;
} = require("./container-check");
const { probeGithubAuth, probeBranchProtection }: {
  probeGithubAuth(): { st: Auth };
  probeBranchProtection(repo: string | null, branch: string | null): Protection | null;
} = require("./merge-gate-gh");

type Policy = { container: boolean; auth: boolean; branch: boolean };
type Action = "block" | "warn";
type Finding = { probe: string; action: Action; status: string; message: string };

function buildPreflightReport(container: Container, socket: Socket, auth: Auth, branch: Protection, policy: Policy) {
  const findings: Finding[] = [];
  if (auth.status === "auth-failed") findings.push({
    probe: "github-auth", action: policy.auth ? "block" : "warn", status: auth.status,
    message: `⚠ GITHUB-AUTH: GitHub auth invalid (${auth.basis}). Re-auth with gh auth login or refresh the configured runner token.`,
  });
  if (auth.status === "indeterminate") findings.push({
    probe: "github-auth", action: "warn", status: auth.status,
    message: `GitHub auth could not be verified: ${auth.basis}. Credential rejection is unconfirmed.`,
  });
  if (container.result !== "contained") findings.push({
    probe: "container", action: policy.container ? "block" : "warn", status: container.result,
    message: `Containment is unconfirmed (${container.basis}). Run in a host-isolated container.`,
  });
  if (socket.present) findings.push({
    probe: "host-socket", action: "warn", status: "present",
    message: `Host docker socket present at ${socket.path}. This gives the container host-equivalent access.`,
  });
  if (branch.status !== "protected") findings.push({
    probe: "branch-protection", action: policy.branch ? "block" : "warn", status: branch.status,
    message: `Required status check protection is unconfirmed (${branch.basis}). Verify the effective rules on the default branch.`,
  });
  return { decision: findings.some(finding => finding.action === "block") ? "block" : "proceed", findings };
}

function field(data: unknown, key: string): unknown {
  return typeof data === "object" && data !== null ? Reflect.get(data, key) : undefined;
}

const usage = "usage: faff run preflight [--repo OWNER/REPO] [--branch NAME]";
const spec = { flags: { "--repo": { arity: 1 }, "--branch": { arity: 1 } }, positionals: { max: 0 } };

export function cmdRunEntryPreflight(args: string[]): number {
  const { values, errors } = parseArgs(args, spec);
  if (errors.length) return usageError(errors, usage);
  try {
    const [config] = loadConfig(findRoot());
    const autonomous = field(config, "autonomous");
    const policy = {
      container: field(autonomous, "require_container") === "block",
      auth: field(autonomous, "require_github_auth") === "block",
      branch: field(autonomous, "require_branch_protection") === "block",
    };
    const fsq = realFsq();
    const container = containerCheck(process.env, fsq);
    const socket = hostSocketProbe(fsq);
    const { st: auth } = probeGithubAuth();
    const branch = probeBranchProtection(values["--repo"] ?? null, values["--branch"] ?? null)
      ?? { status: "indeterminate", basis: "cannot resolve repo slug" };
    const report = buildPreflightReport(container, socket, auth, branch, policy);
    const secrets = collectKnownSecretValues(config, process.env);
    for (const token of [process.env["GH_TOKEN"], process.env["GITHUB_TOKEN"]]) {
      if (token) secrets.push(token);
    }
    for (const finding of report.findings) {
      finding.message = redactKnownSecrets(finding.message, secrets).replace(/[\p{Cc}\s]+/gu, " ");
    }
    process.stdout.write(JSON.stringify(report) + "\n");
    return report.decision === "block" ? 3 : 0;
  } catch (error) {
    process.stderr.write(`faff run preflight: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

export { buildPreflightReport };
