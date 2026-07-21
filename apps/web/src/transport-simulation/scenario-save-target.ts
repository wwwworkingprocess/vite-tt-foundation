import type { ScenarioCoordinate } from '@torrevieja-tycoon/simulation';
import { parseFoundationSaveId } from '../persistence/save-record.js';

export type ScenarioSaveMode = 'manual' | 'autosave';

const mask64 = (1n << 64n) - 1n;
const fingerprint = (value: string) => {
  let first = 0xcbf29ce484222325n;
  let second = 0x84222325cbf29ce4n;
  for (const byte of new TextEncoder().encode(value)) {
    first = ((first ^ BigInt(byte)) * 0x100000001b3n) & mask64;
    second = ((second ^ BigInt(byte)) * 0x100000001e7n) & mask64;
  }
  return `${first.toString(16).padStart(16, '0')}${second.toString(16).padStart(16, '0')}`;
};

const canonicalCoordinate = (coordinate: ScenarioCoordinate) =>
  [
    coordinate.scenarioSchemaVersion,
    coordinate.scenarioId,
    coordinate.scenarioVersion,
    coordinate.contentHash,
  ]
    .map((part) => `${new TextEncoder().encode(part).length}:${part}`)
    .join('|');

export function createScenarioScopedSaveTarget(
  mode: ScenarioSaveMode,
  coordinate: ScenarioCoordinate,
) {
  return parseFoundationSaveId(
    `transport-${mode}-${fingerprint(canonicalCoordinate(coordinate))}`,
  );
}
