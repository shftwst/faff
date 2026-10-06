// Negative fixture: identity brands are distinct. Passing a RunId where a UnitId is required, and a
// raw string where a UnitId is required, must each be a TS2345 under the project's strict settings.
import type { IdsApi, RunId, UnitId } from "../../../plugin/skills/faff/bin/lib/ids";

const ids: IdsApi = require("../../../plugin/skills/faff/bin/lib/ids");

declare function needsUnitId(unit: UnitId): void;

declare const runId: RunId;

needsUnitId(runId);
needsUnitId("FAFF-1180");

export const parsed = ids.parseUnitId("FAFF-1180");
