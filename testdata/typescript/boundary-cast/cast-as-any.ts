// S3 planted violation: `as any` at a boundary.
export function atBoundary(v: unknown): unknown { return v as any; }
