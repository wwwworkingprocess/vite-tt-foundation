import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import {
  createTransportSimulationSnapshot,
  createTransportSimulationState,
  migrateTransportSimulationSnapshotV1,
  migrateTransportSimulationSnapshotV2,
  migrateTransportSimulationSnapshotV3,
  parseTransportSimulationSnapshot,
  parseTransportSimulationSnapshotV3,
  parsePassengerDemandPlan,
  restoreTransportSimulationState,
  advanceTransportTicks,
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
const plan = () => {
  const canonical = scenario();
  return parsePassengerDemandPlan({
    schemaVersion: '1.0.0',
    demandModelContentHash: 'd'.repeat(64),
    scenario: {
      scenarioSchemaVersion: canonical.manifest.schemaVersion,
      scenarioId: canonical.manifest.scenarioId,
      scenarioVersion: canonical.manifest.scenarioVersion,
      contentHash: canonical.manifest.contentHash,
    },
    grid: {
      cityId: 'Q36730',
      populationGridSchemaVersion: '1.0.0',
      gridVersion: '1.0.0',
      rows: 1,
      columns: 1,
      resolutionDegrees: 0.001,
      totalActiveCellCount: 1,
      totalPopulationWeight: 5,
    },
    catchmentPolicy: { maxAccessDistanceCells: 5 },
    emissionPolicy: {
      emissionCreditsPerWeightPerTick: 1,
      creditsPerPassenger: 5,
    },
    accessPolicy: { accessTicksPerCell: 2 },
    cells: [
      {
        cellId: 'r0c0',
        row: 0,
        column: 0,
        populationWeight: 5,
        assignedStopPlaceId: 'fixture-stop',
        distanceSquaredCells: 0,
      },
    ],
    stops: [{ stopPlaceId: 'fixture-stop' }],
  });
};

describe('Transport Snapshot V4 passenger authority', () => {
  it('round-trips active dynamic demand without embedding the static plan', () => {
    const demandPlan = plan();
    const state = advanceTransportTicks(
      createTransportSimulationState(scenario(), 0, demandPlan),
      3,
    );
    const snapshot = createTransportSimulationSnapshot(state);
    expect(snapshot).toMatchObject({
      schemaVersion: 4,
      simulationVersion: 'transport-4',
      state: {
        tick: 3,
        passengerDemand: { status: 'active', processedThroughTick: 3 },
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain('populationWeights');
    expect(JSON.stringify(snapshot)).not.toContain('cellAssignments');
    expect(
      createTransportSimulationSnapshot(
        restoreTransportSimulationState(snapshot, scenario(), demandPlan),
      ),
    ).toEqual(snapshot);
  });

  it('round-trips disabled demand without a resolver', () => {
    const snapshot = createTransportSimulationSnapshot(
      createTransportSimulationState(scenario(), 4),
    );
    expect(snapshot.state.passengerDemand).toEqual({ status: 'disabled' });
    expect(
      restoreTransportSimulationState(snapshot, scenario()).passengerDemand,
    ).toEqual({ status: 'disabled' });
  });

  it('migrates V1, V2, and V3 with passenger demand disabled', () => {
    const coordinate = {
      scenarioSchemaVersion: '1.0.0',
      scenarioId: scenario().manifest.scenarioId,
      scenarioVersion: scenario().manifest.scenarioVersion,
      contentHash: scenario().manifest.contentHash,
    };
    const common = {
      kind: 'transport-simulation-snapshot',
      scenario: coordinate,
    };
    const v1 = {
      ...common,
      schemaVersion: 1,
      simulationVersion: 'transport-1',
      state: { tick: 0 },
    };
    const v2 = {
      ...common,
      schemaVersion: 2,
      simulationVersion: 'transport-2',
      state: { tick: 0, fleet: [] },
    };
    const v3 = {
      ...common,
      schemaVersion: 3,
      simulationVersion: 'transport-3',
      state: { tick: 0, fleet: [] },
    };
    for (const migrated of [
      migrateTransportSimulationSnapshotV1(v1),
      migrateTransportSimulationSnapshotV2(v2),
      migrateTransportSimulationSnapshotV3(v3),
    ])
      expect(migrated).toMatchObject({
        schemaVersion: 4,
        state: { passengerDemand: { status: 'disabled' } },
      });
  });

  it('rejects missing or mismatched exact active demand plans', () => {
    const demandPlan = plan();
    const snapshot = structuredClone(
      createTransportSimulationSnapshot(
        advanceTransportTicks(
          createTransportSimulationState(scenario(), 0, demandPlan),
          2,
        ),
      ),
    );
    expect(() => restoreTransportSimulationState(snapshot, scenario())).toThrow(
      /demand plan/i,
    );
    const wrong = structuredClone(demandPlan);
    (wrong as { demandModelContentHash: string }).demandModelContentHash =
      'e'.repeat(64);
    expect(() =>
      restoreTransportSimulationState(snapshot, scenario(), wrong),
    ).toThrow(/demand plan/i);
    expect(() => parseTransportSimulationSnapshot(snapshot)).not.toThrow();
  });

  it('rejects scenario-mismatched plans at creation and restore', () => {
    const wrong = structuredClone(plan());
    (wrong as { scenario: { scenarioId: string } }).scenario.scenarioId =
      'other-scenario';
    expect(() => createTransportSimulationState(scenario(), 0, wrong)).toThrow(
      /scenario/i,
    );

    const active = createTransportSimulationSnapshot(
      createTransportSimulationState(scenario(), 0, plan()),
    );
    expect(() =>
      restoreTransportSimulationState(active, scenario(), wrong),
    ).toThrow(/scenario/i);
  });

  it('rejects malformed V3 snapshots explicitly', () => {
    expect(() =>
      parseTransportSimulationSnapshotV3({
        kind: 'transport-simulation-snapshot',
        schemaVersion: 3,
        simulationVersion: 'transport-3',
      }),
    ).toThrow('unsupported-transport-snapshot');
  });
});
