// A clean fixture: a validator-mint `as` (allow-listed) + a typed producer-auth require.
import type { ProducerAuthApi } from "./producer-auth";
type ProducerId = string & { readonly __b: "ProducerId" };
function isNonEmptyString(v: unknown): v is string { return typeof v === "string" && v.length > 0; }
export function asProducerId(v: unknown): ProducerId {
  if (!isNonEmptyString(v)) throw new TypeError("nope");
  return v as ProducerId;
}
const producerAuth: ProducerAuthApi = require("./producer-auth");
export { producerAuth };
