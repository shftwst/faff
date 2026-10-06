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

import type { Result, ResultApi } from "./result";

const result: ResultApi = require("./result");

declare const idBrand: unique symbol;
export type OpaqueId<Name extends string> = string & { readonly [idBrand]: Name };

export type IdKind =
  | "RunId" | "RunSegmentId" | "UnitId" | "ContractRevisionId" | "ProducerId"
  | "EffectId" | "EventId" | "LaneId" | "StageAttemptId";

export type RunId = OpaqueId<"RunId">;
export type RunSegmentId = OpaqueId<"RunSegmentId">;
export type UnitId = OpaqueId<"UnitId">;
export type ContractRevisionId = OpaqueId<"ContractRevisionId">;
export type ProducerId = OpaqueId<"ProducerId">;
export type EffectId = OpaqueId<"EffectId">;
export type EventId = OpaqueId<"EventId">;
export type LaneId = OpaqueId<"LaneId">;
export type StageAttemptId = OpaqueId<"StageAttemptId">;

export interface IdParseError {
  kind: IdKind;
  reason: "not-a-string" | "empty-string";
  received: string;
}

export interface IdsApi {
  ID_KINDS: ReadonlyArray<IdKind>;
  parseRunId(v: unknown): Result<RunId, IdParseError>;
  parseRunSegmentId(v: unknown): Result<RunSegmentId, IdParseError>;
  parseUnitId(v: unknown): Result<UnitId, IdParseError>;
  parseContractRevisionId(v: unknown): Result<ContractRevisionId, IdParseError>;
  parseProducerId(v: unknown): Result<ProducerId, IdParseError>;
  parseEffectId(v: unknown): Result<EffectId, IdParseError>;
  parseEventId(v: unknown): Result<EventId, IdParseError>;
  parseLaneId(v: unknown): Result<LaneId, IdParseError>;
  parseStageAttemptId(v: unknown): Result<StageAttemptId, IdParseError>;
}

const ID_KINDS: ReadonlyArray<IdKind> = [
  "RunId", "RunSegmentId", "UnitId", "ContractRevisionId", "ProducerId",
  "EffectId", "EventId", "LaneId", "StageAttemptId",
];

function parseOpaqueId<Name extends IdKind>(kind: Name, v: unknown): Result<OpaqueId<Name>, IdParseError> {
  if (typeof v !== "string") return result.err<IdParseError>({ kind, reason: "not-a-string", received: typeof v });
  if (v.length === 0) return result.err<IdParseError>({ kind, reason: "empty-string", received: "string" });
  return result.ok(v as OpaqueId<Name>);
}

const parseRunId = (v: unknown): Result<RunId, IdParseError> => parseOpaqueId("RunId", v);
const parseRunSegmentId = (v: unknown): Result<RunSegmentId, IdParseError> => parseOpaqueId("RunSegmentId", v);
const parseUnitId = (v: unknown): Result<UnitId, IdParseError> => parseOpaqueId("UnitId", v);
const parseContractRevisionId = (v: unknown): Result<ContractRevisionId, IdParseError> => parseOpaqueId("ContractRevisionId", v);
const parseProducerId = (v: unknown): Result<ProducerId, IdParseError> => parseOpaqueId("ProducerId", v);
const parseEffectId = (v: unknown): Result<EffectId, IdParseError> => parseOpaqueId("EffectId", v);
const parseEventId = (v: unknown): Result<EventId, IdParseError> => parseOpaqueId("EventId", v);
const parseLaneId = (v: unknown): Result<LaneId, IdParseError> => parseOpaqueId("LaneId", v);
const parseStageAttemptId = (v: unknown): Result<StageAttemptId, IdParseError> => parseOpaqueId("StageAttemptId", v);

module.exports = {
  ID_KINDS,
  parseRunId, parseRunSegmentId, parseUnitId, parseContractRevisionId, parseProducerId,
  parseEffectId, parseEventId, parseLaneId, parseStageAttemptId,
};
