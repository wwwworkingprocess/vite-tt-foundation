import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import {
  advanceTransportTicks,
  createScenarioCoordinate,
  createTransportSimulationSnapshot,
  createTransportSimulationState,
  parseTransportSimulationSnapshot,
  restoreTransportSimulationState,
  scenarioCoordinatesEqual,
  ScenarioCompatibilityError,
} from './index.js';

const fixtureRoot = join(
  import.meta.dirname,
  '..',
  '..',
  'transport-domain',
  'fixtures',
  'torrevieja-mini-v1',
);
const json = (name: string) =>
  JSON.parse(readFileSync(join(fixtureRoot, name), 'utf8')) as unknown;
const scenario = () =>
  parseScenarioPackage({
    manifest: json('scenario.json'),
    settlements: json('settlements.json'),
    stops: json('stops.json'),
    routes: json('routes.json'),
    presentation: json('presentation.json'),
    provenance: json('provenance.json'),
  });

describe('authoritative transport simulation', () => {
  it('owns one immutable scenario and derived graph across advancement', () => {
    const canonical = scenario();
    const state = createTransportSimulationState(canonical, 0);
    const advanced = advanceTransportTicks(state, 24);
    expect(state.scenario).toEqual(canonical);
    expect(Object.isFrozen(state.scenario)).toBe(true);
    expect(state.graph.summary).toEqual({
      nodes: 7,
      edges: 6,
      routes: 1,
      patterns: 2,
    });
    expect(advanced).toMatchObject({ tick: 24 });
    expect(advanced.scenario).toBe(state.scenario);
    expect(advanced.graph).toBe(state.graph);
    expect(Object.isFrozen(state)).toBe(true);
  });

  it('round-trips the exact small transport snapshot without static data', () => {
    const canonical = scenario();
    const state = createTransportSimulationState(canonical, 120);
    const snapshot = createTransportSimulationSnapshot(state);
    expect(snapshot).toEqual({
      kind: 'transport-simulation-snapshot',
      schemaVersion: 2,
      simulationVersion: 'transport-2',
      scenario: {
        scenarioSchemaVersion: '1.0.0',
        scenarioId: 'torrevieja-mini-v1',
        scenarioVersion: '1.0.0',
        contentHash:
          'd9c378089d9f83b9ea4756aa57551535fab1f2118eb092d1badcd5ce06c1bb1f',
      },
      state: { tick: 120, fleet: [] },
    });
    expect(JSON.stringify(snapshot)).not.toContain('stopNodes');
    expect(
      parseTransportSimulationSnapshot(JSON.parse(JSON.stringify(snapshot))),
    ).toEqual(snapshot);
    expect(Object.isFrozen(snapshot.scenario)).toBe(true);
    expect(Object.isFrozen(snapshot.state)).toBe(true);
  });

  it('restores only with an exact schema, ID, version, and hash coordinate', () => {
    const canonical = scenario();
    const snapshot = createTransportSimulationSnapshot(
      createTransportSimulationState(canonical, 120),
    );
    expect(restoreTransportSimulationState(snapshot, canonical).tick).toBe(120);
    const coordinate = createScenarioCoordinate(canonical);
    expect(scenarioCoordinatesEqual(coordinate, coordinate)).toBe(true);
    for (const [field, value] of [
      ['scenarioSchemaVersion', '2.0.0'],
      ['scenarioId', 'different'],
      ['scenarioVersion', '1.0.1'],
      ['contentHash', '0'.repeat(64)],
    ] as const) {
      const mismatched = {
        ...snapshot,
        scenario: { ...coordinate, [field]: value },
      };
      expect(() =>
        restoreTransportSimulationState(mismatched, canonical),
      ).toThrow(ScenarioCompatibilityError);
      expect(
        scenarioCoordinatesEqual(
          coordinate,
          mismatched.scenario as typeof coordinate,
        ),
      ).toBe(false);
    }
  });

  it('rejects unsupported transport snapshot versions explicitly', () => {
    expect(() =>
      parseTransportSimulationSnapshot({
        kind: 'transport-simulation-snapshot',
        schemaVersion: 3,
        simulationVersion: 'transport-2',
        scenario: createScenarioCoordinate(scenario()),
        state: { tick: 0 },
      }),
    ).toThrow(ScenarioCompatibilityError);
  });
});
