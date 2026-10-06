// Planted violation: an `as` inside asProducerId, a retired mint name that is no longer allow-listed.
type ProducerId = string & { readonly __b: "ProducerId" };
export function asProducerId(v: unknown): ProducerId {
  if (typeof v !== "string" || v.length === 0) throw new TypeError("nope");
  return v as ProducerId;
}
