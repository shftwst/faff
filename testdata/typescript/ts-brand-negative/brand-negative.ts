// S2 negative fixture: passing a raw, UN-MINTED string to producer-auth's branded admission API
// (the mint/admission edge) must be a TS2345 on the production path — the real enforced edge, not
// deriveKey (whose id params are plain string | undefined) and not a selftest literal. This fixture
// has its own tsconfig that `extends` the project one, so it type-checks under the exact strict
// settings the cluster builds with. `tsc --noEmit` MUST fail here with TS2345.
import type { ProducerAuthApi } from "../../../plugin/skills/faff/bin/lib/producer-auth";

const producerAuth: ProducerAuthApi = require("../../../plugin/skills/faff/bin/lib/producer-auth");

// A raw string handed to the admission API where a branded ProducerId / ContractRevisionId is
// required — the exact mistake the brand moves from runtime to compile time.
export const key = producerAuth.admitProducerKey("master-secret", "raw-producer-id", "raw-contract-revision");
