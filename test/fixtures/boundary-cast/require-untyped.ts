// Property-3 planted violation: an UNTYPED require("./producer-auth") (brand flow degrades to any).
import type { ProducerAuthApi } from "./producer-auth";
const producerAuth = require("./producer-auth");
export { producerAuth };
