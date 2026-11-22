// === region:factory — spec-judge-sequence — one blinded proposition per call ===
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const { withFileLock } = require("./fs-lock");
const { loadConfig } = require("./config");
const { findRoot, dig } = require("./shared-infra");
const { assembleAdversarialBackends } = require("./adversarial-backends");
const { backendIdentity, isWellFormedIdentity, readServedIdentity, resolvePinChain } = require("./spec-review-pin");
const { realRunReviewCall, realJudgeDispatchDisposition } = require("./build-judge-evidence");
const { readWindowStart } = require("./spec-review-window");
const { headingSlug } = require("./heading-slug");
const { contractSpecJudgeVerdict } = require("./contract-defs-review");
const {
  orderSeed, coinSwap, deriveArgumentB, argumentATriple, argumentBTriple, buildProposition, gatherRepositoryEvidence, scrubSpecField,
  parseVerdictBlock, validateReconstruction, imperativeScrub, secretRedact, correctionApplied, sha256Text,
} = require("./spec-judge-casefile");

type Flags = Record<string, string | undefined>;
type Residue = { n: number | null; window_sha: string; window_rounds: number[]; objections: { spec_anchor?: string }[] };
type ReadScope = (container?: string) => string;
type ReadResidue = (dir: string, window: number) => Residue;
type Start = {
  directory: string; spec: string; issue: string; container?: string | undefined; run: string;
  round: number | null; window: number; window_sha: string; repo: string;
};
type Ruling = { proposition_id: string; outcome: string; correction?: { summary: string; verification: string } };
type Step = {
  binding: string; attempts: [number, number]; reconstruction?: { body: string; sha: string }; ruling?: Ruling;
  finished?: boolean;
};
type Entry = {
  pre_ruling_spec_sha: string; pre_ruling_spec_content: string; resolution: string;
  step?: Step;
};
type Ledger = { sequence: Start; order: string[]; entries: Record<string, Entry>; governing_requirements: string; owner?: number };
type BlindedCase = {
  proposition_id: string;
  reconstruction_context: Record<string, unknown>;
  arguments: Record<"argument_A" | "argument_B", unknown>;
};
type Transport = { code: number; stdout: string };
const PROMPTS = resolve(__dirname, "../../../faffter-dark-spec-review");
const PHASE_PROMPTS: [string, string] = ["adjudicate-phase1-reconstruct.md", "adjudicate-phase2-rule.md"];
const IN_PROGRESS = "spec judge step already running";

function privateWrite(target: string, value: unknown): void {
  const temp = target + "." + randomUUID();
  try {
    writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(temp, target);
  } finally {
    rmSync(temp, { force: true });
  }
}

function emit(payload: object): 0 {
  console.log(JSON.stringify(payload));
  return 0;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function active(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("invalid step owner");
  try { process.kill(pid, 0); return true; }
  catch (e) {
    if (e instanceof Error && "code" in e && e.code === "ESRCH") return false;
    throw e;
  }
}

export function sequenceIdentity(values: Flags, residue: Residue, run: string, repo: string): Start {
  const directory = realpathSync(values["--dir"] || "");
  const window = readWindowStart(directory);
  if (Number(values["--window-start"]) !== window) throw new Error("requested window does not match the persisted review window");
  return {
    directory,
    spec: realpathSync(values["--spec"] || ""),
    issue: values["--issue"] || "",
    container: values["--container"],
    run,
    round: residue.n,
    window,
    window_sha: residue.window_sha,
    repo: realpathSync(repo),
  };
}

export function initialiseSequence(
  out: string, identity: Start, ledger: object, caseFiles: Record<string, unknown>,
): boolean {
  return withFileLock(join(out, "sequence.lock"), () => {
    const p = join(out, "ledger.json");
    let current;
    try { current = JSON.parse(readFileSync(p, "utf8")); }
    catch (e) {
      if (!(e instanceof Error) || !("code" in e) || e.code !== "ENOENT") throw e;
    }
    if (current?.sequence && same(current.sequence, identity)) return true;
    if (current?.sequence && active(current.owner)) throw new Error(IN_PROGRESS);
    if (current?.sequence && current.sequence.round === identity.round && current.sequence.window === identity.window) {
      throw new Error("the existing sequence has different round evidence or inputs");
    }
    for (const name of readdirSync(out)) {
      if (/^ruling-p-\d+\.json$/.test(name) || name === "admit-result.json") rmSync(join(out, name), { force: true });
    }
    for (const [pid, file] of Object.entries(caseFiles)) privateWrite(join(out, `case-${pid}.json`), file);
    privateWrite(p, { ...ledger, sequence: identity });
    return false;
  });
}

function verifySequence(ledger: Ledger, values: Flags, readResidue: ReadResidue): Residue {
  const id = ledger.sequence;
  if (!id || !Array.isArray(ledger.order) || new Set(ledger.order).size !== ledger.order.length
      || !ledger.entries || ledger.order.some((pid, i) => pid !== `p-${String(i + 1).padStart(2, "0")}` || !ledger.entries[pid])) {
    throw new Error("missing or malformed sequenced ledger");
  }
  if (realpathSync(values["--dir"] || "") !== id.directory
      || realpathSync(values["--spec"] || "") !== id.spec || Number(values["--window-start"]) !== id.window) {
    throw new Error("scratch, spec or review window does not match the sequence");
  }
  if (readWindowStart(id.directory) !== id.window) throw new Error("persisted review window changed");
  const residue = readResidue(id.directory, id.window);
  if (residue.n !== id.round || residue.window_sha !== id.window_sha || residue.objections.length !== ledger.order.length) {
    throw new Error("in-window round evidence changed");
  }
  return residue;
}

function entryFor(ledger: Ledger, pid: string): Entry {
  const entry = ledger.entries[pid];
  if (!entry) throw new Error(`missing ledger entry for ${pid}`);
  return entry;
}

function freshCase(ledger: Ledger, residue: Residue, pid: string, spec: string): BlindedCase {
  const objection = residue.objections[ledger.order.indexOf(pid)];
  if (!objection) throw new Error("proposition has no current round objection");
  const defence = deriveArgumentB(spec, headingSlug(objection.spec_anchor || ""), "redispatch");
  const refuter = argumentATriple(objection);
  const author = argumentBTriple(defence);
  const swapped = coinSwap(orderSeed(ledger.sequence.run, ledger.sequence.window, pid));
  return {
    proposition_id: pid,
    reconstruction_context: {
      governing_requirements: scrubSpecField(ledger.governing_requirements),
      relevant_spec_sections: scrubSpecField(defence.body || "(no bound spec section)"),
      repository_evidence: gatherRepositoryEvidence(objection, ledger.sequence.repo).text,
      proposition: buildProposition(objection),
    },
    arguments: {
      argument_A: swapped ? author : refuter,
      argument_B: swapped ? refuter : author,
    },
  };
}

function positive(value: unknown): number | undefined {
  const number = /^\+?\d+$/.test(String(value).trim()) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function transportSettings(id: Start, rounds: number[], selected: string | undefined) {
  if (!selected) return null;
  const [config] = loadConfig(findRoot(id.repo));
  const get = (key: string) => dig(config, key);
  const readJudge = (key: string) => get(`adversarial.spec_judge.${key}`);
  const configured = assembleAdversarialBackends(config, "spec_judge");
  const refuters = resolvePinChain(config, id.directory, "spec_review");
  if (!configured.chain || refuters.error === "pin-malformed" || refuters.error === "malformed") {
    return null;
  }
  const used = new Set((refuters.chain || []).map(backendIdentity));
  for (const round of rounds) {
    const served = readServedIdentity(id.directory, round);
    if (isWellFormedIdentity(served?.served_identity)) used.add(served.served_identity);
  }
  const chain = configured.chain.filter((backend: object) => {
    const identity = backendIdentity(backend);
    return identity === selected && isWellFormedIdentity(identity) && !used.has(identity);
  });
  if (chain.length !== 1) return null;
  const rawCap = readJudge("max_tokens");
  const cap = positive(rawCap === undefined || rawCap === null || rawCap === "" ? get("adversarial.max_tokens") : rawCap) ?? 2000;
  const timeout = positive(readJudge("timeout")) ?? positive(get("adversarial.timeout")) ?? 120;
  const deadline = positive(readJudge("deadline")) ?? positive(get("adversarial.deadline")) ?? 480;
  const rawRetries = get("prep.spec_review_judge_retry_limit");
  const retryLimit = String(rawRetries).trim() === "0" ? 0 : positive(rawRetries) ?? 2;
  return { chain, cap, timeout, deadline, retryLimit };
}

function rulingFile(out: string, pid: string): string {
  return join(out, `ruling-${pid}.json`);
}

function checkRuling(out: string, pid: string, step: Step): void {
  if (step.ruling?.proposition_id !== pid) throw new Error(`missing bound ruling for ${pid}`);
  if (!same(JSON.parse(readFileSync(rulingFile(out, pid), "utf8")), step.ruling)) {
    throw new Error(`ruling file does not match the bound response for ${pid}`);
  }
}

export function verifySequenceForAdmission(
  ledger: Ledger, values: Flags, out: string, readResidue: ReadResidue,
): void {
  verifySequence(ledger, values, readResidue);
  for (const pid of ledger.order) {
    const entry = entryFor(ledger, pid);
    if (!entry.step?.finished) throw new Error(`sequenced proposition ${pid} is incomplete`);
    if (entry.resolution !== "parked") checkRuling(out, pid, entry.step);
  }
}

export async function stepSequence(values: Flags, readResidue: ReadResidue, readScope: ReadScope): Promise<number> {
  const dir = values["--dir"], specPath = values["--spec"], window = values["--window-start"];
  if (!dir || !specPath || !/^\d+$/.test(window || "") || !positive(window)) {
    throw new Error("--step requires --dir, --spec and a positive --window-start");
  }
  const out = values["--out"] || join(dir, "judge");
  const ledgerPath = join(out, "ledger.json");
  const lock = join(out, "sequence.lock");
  const save = (ledger: Ledger) => privateWrite(ledgerPath, ledger);
  const ledger: Ledger = withFileLock(lock, () => {
    const stored = JSON.parse(readFileSync(ledgerPath, "utf8"));
    verifySequence(stored, values, readResidue);
    if (active(stored.owner)) throw new Error(IN_PROGRESS);
    stored.owner = process.pid;
    save(stored);
    return stored;
  });

  try {
    const residue = verifySequence(ledger, values, readResidue);
    const pid = ledger.order.find((id) => !entryFor(ledger, id).step?.finished);
    if (!pid) return emit({ action: "done" });
    const entry = entryFor(ledger, pid);
    const spec = readFileSync(specPath, "utf8");
    const park = (reason: string) => {
      if (!entry.step) throw new Error("unbound park");
      entry.step.finished = true;
      entry.resolution = "parked";
      save(ledger);
      return emit({ action: "parked", pid, reason });
    };

    const settings = transportSettings(ledger.sequence, residue.window_rounds, values["--backend"]);
    const scopeMatches = () => readScope(ledger.sequence.container) === ledger.governing_requirements;
    if (!scopeMatches()) throw new Error("governing requirements changed during the sequence");
    const promptHashes = PHASE_PROMPTS.map((name) => sha256Text(readFileSync(join(PROMPTS, name), "utf8")));
    const digest = (document: string, file: BlindedCase) =>
      sha256Text(JSON.stringify([ledger.sequence, pid, document, file, settings, promptHashes]));

    if (entry.step?.ruling) {
      const step = entry.step;
      const ruling = step.ruling;
      if (!ruling) throw new Error("missing stored ruling");
      const before = entry.pre_ruling_spec_content;
      if (digest(before, freshCase(ledger, residue, pid, before)) !== step.binding) {
        throw new Error("case evidence or judge settings changed before the correction handoff");
      }
      if (values["--park"]) {
        if (values["--park"] !== pid || !ruling.correction) throw new Error("park must name the active correction");
        return park("author could not apply correction");
      }
      if (ruling.correction && !correctionApplied(entry, ruling, spec).applied) {
        return emit({ action: "apply-correction", pid, correction: ruling.correction });
      }
      privateWrite(rulingFile(out, pid), ruling);
      step.finished = true;
      save(ledger);
      return emit({ action: "continue", pid });
    }
    if (values["--park"]) throw new Error("--park requires an active correction");

    const blinded = freshCase(ledger, residue, pid, spec);
    const binding = digest(spec, blinded);
    if (entry.step && entry.step.binding !== binding) throw new Error("current spec, case evidence or judge settings changed during dispatch");
    if (!entry.step) {
      entry.pre_ruling_spec_sha = sha256Text(spec);
      entry.pre_ruling_spec_content = spec;
      entry.step = { binding, attempts: [0, 0] };
      save(ledger);
    }
    const step = entry.step;
    if (!settings) return park("no independent spec judge backend available");
    privateWrite(join(out, `case-${pid}.json`), blinded);

    const scratch = mkdtempSync(join(tmpdir(), "faff-spec-judge-"));
    try {
      const snapshot = join(scratch, "spec.md");
      const backendPath = join(scratch, "backends.json");
      const context = join(scratch, "context.json");
      writeFileSync(snapshot, spec, { mode: 0o600 });
      privateWrite(backendPath, settings.chain.map((backend: object) => ({ ...backend, reasoning_off: false })));
      const phase = step.reconstruction ? 1 : 0;
      const reconstruction = step.reconstruction;
      if (reconstruction && (!validateReconstruction(reconstruction.body).ok
        || reconstruction.sha !== sha256Text(JSON.stringify([binding, reconstruction.body])))) {
        throw new Error("stored reconstruction is invalid or unbound");
      }
      privateWrite(context, reconstruction ? {
        proposition_id: pid,
        proposition: blinded.reconstruction_context.proposition,
        reconstruction: secretRedact(imperativeScrub(reconstruction.body)),
        ...blinded.arguments,
      } : blinded.reconstruction_context);
      const attempts = ++step.attempts[phase];
      if (attempts > settings.retryLimit + 1) return park(`phase ${phase + 1} retry budget exhausted`);
      save(ledger);
      const result: Transport = realRunReviewCall([
        "--system", join(PROMPTS, PHASE_PROMPTS[phase]), "--diff", snapshot, "--diff-kind", "prose", "--context", context,
        "--backends-json", backendPath, "--expect", "contract", "--max-tokens", String(settings.cap),
        "--timeout", String(settings.timeout), "--deadline", String(settings.deadline),
      ], { deadlineSecs: settings.deadline });
      const liveResidue = verifySequence(ledger, values, readResidue);
      const liveSpec = readFileSync(specPath, "utf8");
      if (!scopeMatches() || digest(liveSpec, freshCase(ledger, liveResidue, pid, liveSpec)) !== binding) {
        throw new Error("spec or case evidence changed during the model call");
      }
      const disposition = await realJudgeDispatchDisposition(result.code);
      if (disposition === "retry" && attempts <= settings.retryLimit) {
        return emit({ action: "retry", pid, phase: phase + 1, exit: result.code });
      }
      if (disposition !== "ruling") {
        const cause = phase === 0 ? "reconstruction empty/failed" : "ruling dispatch failed";
        return park(`${cause} (exit ${result.code})`);
      }
      if (phase === 0) {
        if (!validateReconstruction(result.stdout).ok) return park("reconstruction empty/failed");
        step.reconstruction = { body: result.stdout, sha: sha256Text(JSON.stringify([binding, result.stdout])) };
        save(ledger);
        return emit({ action: "continue", pid });
      }
      const parsed = parseVerdictBlock(result.stdout);
      if (!parsed.ok) return park(parsed.cause);
      const checked = contractSpecJudgeVerdict(parsed.json);
      if (!checked.contractData?.conformant) return park("invalid-verdict-contract");
      if (checked.contractData.proposition_id !== pid) return park("verdict-proposition-mismatch");
      step.ruling = checked.contractData;
      save(ledger);
      if (step.ruling?.correction) return emit({ action: "apply-correction", pid, correction: step.ruling.correction });
      privateWrite(rulingFile(out, pid), step.ruling);
      step.finished = true;
      save(ledger);
      return emit({ action: "continue", pid });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  } finally {
    withFileLock(lock, () => {
      delete ledger.owner;
      save(ledger);
    });
  }
}
