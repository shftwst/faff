"use strict";
// ===========================================================================
// === region:governance — ids — FAFF-1180: opaque identity types with validating parsers ===
//
// A brand is a compile-time tag on a plain string: a RunId cannot be passed where a UnitId is
// expected, and every brand erases to `string` in the committed .js emit. The only way to obtain
// one is a parser, which takes `unknown`, checks it at runtime and returns a closed Result.
// parseOpaqueId holds the one brand assertion in the codebase; the boundary-cast checker
// allow-lists that function in this file only.
//
// The runtime rule is a non-empty string used exactly as given, because every id shape already
// held by a frozen schema:3 record (including the "-" admission sentinel) must stay parseable.
// ===========================================================================
Object.defineProperty(exports, "__esModule", { value: true });
const result = require("./result");
const ID_KINDS = [
    "RunId", "RunSegmentId", "UnitId", "ContractRevisionId", "ProducerId",
    "EffectId", "EventId", "LaneId", "StageAttemptId",
];
function parseOpaqueId(kind, v) {
    if (typeof v !== "string")
        return result.err({ kind, reason: "not-a-string", received: typeof v });
    if (v.length === 0)
        return result.err({ kind, reason: "empty-string", received: "string" });
    return result.ok(v);
}
const parseRunId = (v) => parseOpaqueId("RunId", v);
const parseRunSegmentId = (v) => parseOpaqueId("RunSegmentId", v);
const parseUnitId = (v) => parseOpaqueId("UnitId", v);
const parseContractRevisionId = (v) => parseOpaqueId("ContractRevisionId", v);
const parseProducerId = (v) => parseOpaqueId("ProducerId", v);
const parseEffectId = (v) => parseOpaqueId("EffectId", v);
const parseEventId = (v) => parseOpaqueId("EventId", v);
const parseLaneId = (v) => parseOpaqueId("LaneId", v);
const parseStageAttemptId = (v) => parseOpaqueId("StageAttemptId", v);
module.exports = {
    ID_KINDS,
    parseRunId, parseRunSegmentId, parseUnitId, parseContractRevisionId, parseProducerId,
    parseEffectId, parseEventId, parseLaneId, parseStageAttemptId,
};
