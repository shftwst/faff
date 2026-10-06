// Planted violation: an `as` inside a function named parseOpaqueId in a file that is not bin/lib/ids.ts.
type OpaqueId = string & { readonly __b: "OpaqueId" };
export function parseOpaqueId(v: string): OpaqueId {
  return v as OpaqueId;
}
