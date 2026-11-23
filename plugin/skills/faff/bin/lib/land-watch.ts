// === region:factory — land watch — foreground GitHub check output ===
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Transform, type TransformCallback } from "node:stream";
const { parseArgs, usageError } = require("./argv");

const checkRow = /^[^\t\r\n]+\t(?:pass|pending|fail|skipping|cancel|cancelled|skipped)\t/i;

// gh emits a new header before each poll. Echo the first snapshot immediately.
// While a later snapshot matches, hold its prefix until a difference or boundary.
export class CheckSnapshots extends Transform {
  private tail = "";
  private previous: string[] = [];
  private current: string[] = [];
  private matching = false;
  private hasRow = false;
  private repeats = 0;

  private writeText(text: string): void {
    this.push(Buffer.from(text, "latin1"));
  }
  private flushRepeats(): void {
    if (this.repeats) this.writeText(`[previous check snapshot repeated ${this.repeats} times]\n`);
    this.repeats = 0;
  }
  private reveal(): void {
    this.flushRepeats();
    this.writeText(this.current.join(""));
    this.matching = false;
  }
  private finishSnapshot(): void {
    if (!this.current.length) return;
    if (this.matching) {
      if (this.hasRow && this.current.length === this.previous.length) this.repeats++;
      else this.reveal();
    }
    this.previous = this.hasRow ? this.current : [];
    this.current = [];
    this.hasRow = false;
    this.matching = false;
  }
  private line(line: string): void {
    if (line.startsWith("Refreshing checks status")) {
      this.finishSnapshot();
      this.matching = this.previous.length > 0;
    } else if (this.current.length && checkRow.test(line)) {
      this.hasRow = true;
    } else if (!this.current.length || this.hasRow || line.trim()) {
      this.finishSnapshot();
      this.flushRepeats();
      this.previous = [];
      this.writeText(line);
      return;
    }

    if (this.matching && this.previous[this.current.length] !== line) this.reveal();
    this.current.push(line);
    if (!this.matching) this.writeText(line);
  }
  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    // latin1 is a one-to-one byte mapping, including for split UTF-8 or invalid input.
    const parts = (this.tail + chunk.toString("latin1")).split("\n");
    this.tail = parts.pop() ?? "";
    for (const part of parts) this.line(part + "\n");
    done();
  }
  override _flush(done: TransformCallback): void {
    if (this.tail) this.line(this.tail);
    this.finishSnapshot();
    this.flushRepeats();
    done();
  }
}

export function cmdLandWatch(args: string[]): number | Promise<number> {
  const { values, errors } = parseArgs(args, { flags: { "--pr": { arity: 1 } } });
  const pr = values["--pr"];
  if (!/^[1-9]\d*$/.test(pr || "")) errors.push({ code: "bad-value", detail: "--pr requires a positive PR number" });
  if (errors.length) return usageError(errors, "usage: faff land watch --pr N");

  return watch(pr);
}

async function watch(pr: string): Promise<number> {
  const child = spawn("gh", ["pr", "checks", pr, "--watch", "--interval", "15"], {
    stdio: ["inherit", "pipe", "inherit"],
  });
  const forward = (signal: NodeJS.Signals) => child.kill(signal);
  const signals: NodeJS.Signals[] = ["SIGHUP", "SIGINT", "SIGTERM", "SIGQUIT"];
  for (const signal of signals) process.on(signal, forward);
  let spawnError: NodeJS.ErrnoException | undefined;
  child.on("error", (err) => { spawnError = err; });
  const closed = new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
    child.once("close", (code, signal) => resolve([code, signal]));
  });
  let result: [number | null, NodeJS.Signals | null];
  try {
    await pipeline(child.stdout, new CheckSnapshots(), process.stdout, { end: false });
    result = await closed;
  } catch (err) {
    child.kill();
    await closed;
    throw err;
  } finally {
    for (const signal of signals) process.removeListener(signal, forward);
  }
  const [code, signal] = result;
  if (spawnError) {
    process.stderr.write(`faff land watch: ${spawnError.message}\n`);
    return spawnError.code === "ENOENT" ? 127 : 126;
  }
  if (signal) process.kill(process.pid, signal);
  return code ?? 1;
}
