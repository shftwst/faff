// Property-3 planted violation: an UNTYPED require("./ids") (the identity parsers degrade to any).
import type { IdsApi } from "./ids";
const ids = require("./ids");
export { ids };
