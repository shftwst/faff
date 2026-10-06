// S3 planted violation: `as ProducerId` at a boundary (not inside a validator mint).
export function atBoundary(v: unknown): string { return v as string; }
export function brandCast(v: unknown) { return v as ProducerId; }
type ProducerId = string & { readonly __b: "ProducerId" };
