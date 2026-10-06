// A clean fixture: no assertion anywhere, and typed requires of every cross-module specifier.
import type { ProducerAuthApi } from "./producer-auth";
import type { IdsApi } from "./ids";
import type { ResultApi } from "./result";

const producerAuth: ProducerAuthApi = require("./producer-auth");
const ids: IdsApi = require("./ids");
const result: ResultApi = require("./result");

export function mint(v: unknown) {
  return ids.parseProducerId(v);
}
export { producerAuth, result };
