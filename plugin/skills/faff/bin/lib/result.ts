// ===========================================================================
// === region:governance — result — FAFF-1180: closed Ok/Err result and an exhaustiveness check ===
//
// A parser or handler returns a Result instead of throwing, so a caller must handle both arms.
// assertNever closes a switch over a union: an unhandled variant fails compilation, and at runtime
// it throws rather than falling through a default. Pure, requires nothing.
// ===========================================================================

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E> = Ok<T> | Err<E>;

export interface ResultApi {
  ok<T>(value: T): Ok<T>;
  err<E>(error: E): Err<E>;
  assertNever(value: never, context: string): never;
}

function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

function describe(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    return typeof json === "string" ? json : typeof value;
  } catch {
    return typeof value;
  }
}

function assertNever(value: never, context: string): never {
  throw new Error(`${context}: unhandled variant ${describe(value)}`);
}

module.exports = { ok, err, assertNever };
