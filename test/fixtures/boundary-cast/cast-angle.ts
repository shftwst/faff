// S3 planted violation: angle-bracket `<ProducerId>value` assertion at a boundary.
export function atBoundary(v: unknown): string { return <string>v; }
