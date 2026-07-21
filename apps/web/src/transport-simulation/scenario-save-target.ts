import type { ScenarioCoordinate } from '@torrevieja-tycoon/simulation';
import { parseFoundationSaveId } from '../persistence/save-record.js';

export type ScenarioSaveMode = 'manual' | 'autosave';

export function createScenarioScopedSaveTarget(
  mode: ScenarioSaveMode,
  coordinate: ScenarioCoordinate,
) {
  return parseFoundationSaveId(
    `transport-${mode}:${coordinate.scenarioSchemaVersion}:${coordinate.scenarioId}:${coordinate.scenarioVersion}:${coordinate.contentHash}`,
  );
}
