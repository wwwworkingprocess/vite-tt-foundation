import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseScenarioPackage, type CanonicalScenario } from './index.js';
import {
  listActivePopulationCells,
  parseCityPopulationGrid,
} from './city-population-grid.js';
import {
  buildStopCatchments,
  listEligibleStopPlaces,
} from './stop-catchment.js';

type StopFixture = {
  scenarioId: string;
  patternNodeIds?: string[];
  stopPlaces: Array<{
    stopPlaceId: string;
    position?: { latitude: number; longitude: number };
    nodeIds: string[];
  }>;
};
const gridInput = JSON.parse(
  readFileSync(
    new URL('../fixtures/population/mini-grid.json', import.meta.url),
    'utf8',
  ),
) as unknown;
const scenarios = JSON.parse(
  readFileSync(
    new URL('../fixtures/population/disjoint-scenarios.json', import.meta.url),
    'utf8',
  ),
) as { scenarioA: StopFixture; scenarioB: StopFixture };

const scenarioFrom = (fixture: StopFixture): CanonicalScenario => {
  const nodes = fixture.stopPlaces.flatMap((place) =>
    place.nodeIds.map((stopNodeId) => ({
      stopNodeId,
      stopPlaceId: place.stopPlaceId,
      settlementId: 'settlement',
      name: stopNodeId,
      position: place.position ?? { latitude: 10, longitude: 20 },
      sourceReferences: [],
      resolution: { status: 'fixture' },
    })),
  );
  const patternNodeIds =
    fixture.patternNodeIds ?? nodes.map((node) => node.stopNodeId);
  return parseScenarioPackage({
    manifest: {
      schemaVersion: '1.0.0',
      scenarioId: fixture.scenarioId,
      scenarioVersion: '1.0.0',
      status: 'test-fixture',
      title: fixture.scenarioId,
      primarySettlementId: 'settlement',
      settlementIds: ['settlement'],
      contentHash: 'a'.repeat(64),
      assets: {
        settlements: {
          path: 'settlements.json',
          required: true,
          sha256: 'a'.repeat(64),
        },
        stops: {
          path: 'stops.json',
          required: true,
          sha256: 'b'.repeat(64),
        },
        routes: {
          path: 'routes.json',
          required: true,
          sha256: 'c'.repeat(64),
        },
      },
      graphContract: {
        vertexSource: 'stops.stopNodes',
        edgeDerivation: 'consecutive-stopNodeIds',
        closeLoopPolicy: 'add-last-to-first-only-when-closesLoop-is-true',
        reverseEdgePolicy: 'never-infer',
      },
    },
    settlements: {
      schemaVersion: '1.0.0',
      scenarioId: fixture.scenarioId,
      settlements: [
        {
          settlementId: 'settlement',
          name: 'Fixture',
          countryCode: 'XX',
          adminArea: 'Fixture',
          center: { latitude: 10, longitude: 20 },
          bounds: { south: 9, west: 19, north: 11, east: 21 },
        },
      ],
    },
    stops: {
      schemaVersion: '1.0.0',
      scenarioId: fixture.scenarioId,
      stopPlaces: fixture.stopPlaces.map(({ stopPlaceId, position }) => ({
        stopPlaceId,
        settlementId: 'settlement',
        name: stopPlaceId,
        ...(position ? { position } : {}),
      })),
      stopNodes: nodes,
    },
    routes: {
      schemaVersion: '1.0.0',
      scenarioId: fixture.scenarioId,
      routes: [
        {
          routeId: 'fixture-route',
          publicCode: 'F',
          name: 'Fixture',
          dataStatus: 'test',
          patterns: [
            {
              patternId: 'fixture-pattern',
              directionLabel: 'Fixture',
              closesLoop: false,
              stopNodeIds: patternNodeIds,
            },
          ],
        },
      ],
    },
  });
};

const grid = parseCityPopulationGrid(gridInput);
const scenarioA = scenarioFrom(scenarios.scenarioA);
const scenarioB = scenarioFrom(scenarios.scenarioB);

describe('canonical StopPlace eligibility', () => {
  it('uses only pattern-referenced nodes, deduplicates physical places, and orders by StopPlaceId', () => {
    const eligible = listEligibleStopPlaces(scenarioA);
    expect(eligible.map((place) => place.stopPlaceId)).toEqual([
      'place-a',
      'place-b',
      'place-zero',
    ]);
    expect(
      eligible.filter((place) => place.stopPlaceId === 'place-a'),
    ).toHaveLength(1);
    expect(eligible).not.toContainEqual(
      expect.objectContaining({ stopPlaceId: 'place-unreferenced' }),
    );
    expect(eligible).not.toContainEqual(
      expect.objectContaining({ stopPlaceId: 'place-orphan' }),
    );
    expect(eligible).toContainEqual(
      expect.objectContaining({ stopPlaceId: 'place-b' }),
    );
  });

  it('keeps one magnet when used and unused directional nodes share a StopPlace', () => {
    const mixed = scenarioFrom({
      scenarioId: 'mixed-used-unused',
      patternNodeIds: ['mixed-used', 'terminal-used'],
      stopPlaces: [
        {
          stopPlaceId: 'mixed-place',
          position: { latitude: 10, longitude: 20 },
          nodeIds: ['mixed-used', 'mixed-unused'],
        },
        {
          stopPlaceId: 'terminal-place',
          position: { latitude: 10, longitude: 20.001 },
          nodeIds: ['terminal-used'],
        },
      ],
    });
    expect(
      listEligibleStopPlaces(mixed).map((place) => place.stopPlaceId),
    ).toEqual(['mixed-place', 'terminal-place']);
  });

  it('fails actionably when a referenced physical StopPlace has no valid position', () => {
    const missing = scenarioFrom({
      scenarioId: 'missing-position',
      stopPlaces: [
        { stopPlaceId: 'missing', nodeIds: ['missing-a', 'missing-b'] },
      ],
    });
    expect(() => listEligibleStopPlaces(missing)).toThrow(
      /invalid-stop-place.*missing/,
    );
    const invalid = structuredClone(scenarioA) as unknown as {
      stops: { stopPlaces: Array<{ position?: { latitude: number } }> };
    };
    invalid.stops.stopPlaces[0]!.position!.latitude = 91;
    expect(() =>
      listEligibleStopPlaces(invalid as unknown as CanonicalScenario),
    ).toThrow(/invalid-stop-place.*place-a/);
  });
});

describe('deterministic stop catchments', () => {
  it('carries exact immutable scenario and catchment-policy identity', () => {
    const input = structuredClone(scenarioA);
    const result = buildStopCatchments({
      grid,
      scenario: input,
      maxAccessDistanceCells: 2,
    });
    expect(result.scenario).toEqual({
      scenarioSchemaVersion: scenarioA.manifest.schemaVersion,
      scenarioId: scenarioA.manifest.scenarioId,
      scenarioVersion: scenarioA.manifest.scenarioVersion,
      contentHash: scenarioA.manifest.contentHash,
    });
    expect(result.catchmentPolicy).toEqual({ maxAccessDistanceCells: 2 });
    expect(Object.isFrozen(result.scenario)).toBe(true);
    expect(Object.isFrozen(result.catchmentPolicy)).toBe(true);
    expect(input).toEqual(scenarioA);
    expect(
      buildStopCatchments({
        grid,
        scenario: scenarioB,
        maxAccessDistanceCells: 2,
      }).scenario,
    ).not.toEqual(result.scenario);
  });

  it('uses equal WGS84 angular weights, lexical ties, boundaries, and explicit unserved cells', () => {
    const result = buildStopCatchments({
      grid,
      scenario: scenarioA,
      maxAccessDistanceCells: 2,
    });
    const byCell = new Map(
      result.cellAssignments.map((assignment) => [
        assignment.cellId,
        assignment,
      ]),
    );
    expect(byCell.get('r0c1')).toMatchObject({
      assignedStopPlaceId: 'place-a',
    });
    expect(byCell.get('r0c1')!.distanceSquaredCells).toBeCloseTo(1, 9);
    expect(byCell.get('r1c0')).toMatchObject({
      assignedStopPlaceId: 'place-a',
    });
    expect(byCell.get('r1c0')!.distanceSquaredCells).toBeCloseTo(1, 9);
    expect(byCell.get('r1c3')).toMatchObject({
      assignedStopPlaceId: 'place-b',
    });
    expect(byCell.get('r1c3')!.distanceSquaredCells).toBeCloseTo(0, 9);
    expect(byCell.get('r2c2')).toMatchObject({
      assignedStopPlaceId: 'place-a',
    });
    expect(byCell.get('r2c2')!.distanceSquaredCells).toBeCloseTo(2, 9);
    expect(byCell.get('r3c1')).toMatchObject({
      assignedStopPlaceId: 'place-a',
    });
    expect(byCell.get('r3c1')!.distanceSquaredCells).toBeCloseTo(4, 9);
    expect(byCell.get('r4c5')).toMatchObject({
      assignedStopPlaceId: null,
      distanceSquaredCells: null,
    });
    expect(result.cellAssignments).toHaveLength(
      listActivePopulationCells(grid).length,
    );
    expect(result.cellAssignments).not.toContainEqual(
      expect.objectContaining({ cellId: 'r0c0' }),
    );
  });

  it('ignores StopNodes without a physical StopPlace and supports no eligible magnets', () => {
    const withNullNode = structuredClone(scenarioA) as unknown as {
      stops: {
        stopNodes: Array<{ stopPlaceId: string | null }>;
      };
    };
    withNullNode.stops.stopNodes[0]!.stopPlaceId = null;
    expect(
      listEligibleStopPlaces(withNullNode as unknown as CanonicalScenario),
    ).toHaveLength(3);
    for (const node of withNullNode.stops.stopNodes) node.stopPlaceId = null;
    const result = buildStopCatchments({
      grid,
      scenario: withNullNode as unknown as CanonicalScenario,
      maxAccessDistanceCells: 2,
    });
    expect(result.stopSummaries).toEqual([]);
    expect(result.coverage.servedActiveCellCount).toBe(0);
    expect(
      result.cellAssignments.every(
        (assignment) => assignment.assignedStopPlaceId === null,
      ),
    ).toBe(true);
  });

  it('is independent of eligible-stop source ordering and retains zero summaries', () => {
    const reversed = structuredClone(scenarioA) as unknown as {
      stops: { stopPlaces: unknown[]; stopNodes: unknown[] };
      routes: {
        routes: Array<{
          patterns: Array<{ stopNodeIds: unknown[] }>;
        }>;
      };
    };
    reversed.stops.stopPlaces.reverse();
    reversed.stops.stopNodes.reverse();
    reversed.routes.routes.reverse();
    for (const route of reversed.routes.routes) {
      route.patterns.reverse();
      for (const pattern of route.patterns) pattern.stopNodeIds.reverse();
    }
    const expected = buildStopCatchments({
      grid,
      scenario: scenarioA,
      maxAccessDistanceCells: 2,
    });
    const actual = buildStopCatchments({
      grid,
      scenario: reversed as unknown as CanonicalScenario,
      maxAccessDistanceCells: 2,
    });
    expect(actual).toEqual(expected);
    expect(
      actual.cellAssignments.some(
        (assignment) => assignment.assignedStopPlaceId === 'place-orphan',
      ),
    ).toBe(false);
    expect(
      actual.stopSummaries.find(
        (summary) => summary.stopPlaceId === 'place-zero',
      ),
    ).toEqual({
      stopPlaceId: 'place-zero',
      assignedActiveCellCount: 0,
      assignedPopulationWeight: 0,
    });
  });

  it('conserves weights and produces a deterministic deeply frozen result', () => {
    const first = buildStopCatchments({
      grid,
      scenario: scenarioA,
      maxAccessDistanceCells: 2,
    });
    const second = buildStopCatchments({
      grid,
      scenario: scenarioA,
      maxAccessDistanceCells: 2,
    });
    expect(second).toEqual(first);
    expect(first.coverage.servedPopulationWeight).toBe(
      first.stopSummaries.reduce(
        (sum, stop) => sum + stop.assignedPopulationWeight,
        0,
      ),
    );
    expect(
      first.coverage.servedPopulationWeight +
        first.coverage.unservedPopulationWeight,
    ).toBe(first.coverage.totalPopulationWeight);
    expect(first.grid.totalPopulationWeight).toBe(45);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.grid)).toBe(true);
    expect(Object.isFrozen(first.cellAssignments)).toBe(true);
    expect(Object.isFrozen(first.cellAssignments[0])).toBe(true);
    expect(Object.isFrozen(first.cellAssignments[0]!.center)).toBe(true);
    expect(Object.isFrozen(first.stopSummaries)).toBe(true);
    expect(Object.isFrozen(first.coverage)).toBe(true);
    expect(
      Reflect.set(first.cellAssignments[0]!, 'populationWeight', 999),
    ).toBe(false);
    expect(second.cellAssignments[0]!.populationWeight).toBe(
      first.cellAssignments[0]!.populationWeight,
    );
  });

  it('validates explicit maximum grid-cell distance and arithmetic overflow', () => {
    for (const invalid of [
      0,
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER,
    ])
      expect(() =>
        buildStopCatchments({
          grid,
          scenario: scenarioA,
          maxAccessDistanceCells: invalid,
        }),
      ).toThrow(/invalid-catchment-configuration/);

    const overflowing = structuredClone(gridInput) as {
      populationWeights: number[][];
    };
    overflowing.populationWeights[0]![1] = Number.MAX_SAFE_INTEGER;
    overflowing.populationWeights[0]![5] = 1;
    expect(() =>
      buildStopCatchments({
        grid: parseCityPopulationGrid(overflowing),
        scenario: scenarioA,
        maxAccessDistanceCells: 2,
      }),
    ).toThrow(/arithmetic-overflow/);
  });

  it('reports full basis-point coverage for an empty population field', () => {
    const empty = parseCityPopulationGrid({
      schemaVersion: '1.0.0',
      cityId: 'Q1',
      gridVersion: '1.0.1',
      originCellCenter: { latitude: 10, longitude: 20 },
      resolutionDegrees: 0.001,
      rowDirection: 'north-to-south',
      columnDirection: 'west-to-east',
      rows: 1,
      columns: 1,
      populationWeights: [[0]],
    });
    const result = buildStopCatchments({
      grid: empty,
      scenario: scenarioA,
      maxAccessDistanceCells: 1,
    });
    expect(result.coverage).toEqual({
      totalPopulationWeight: 0,
      servedPopulationWeight: 0,
      unservedPopulationWeight: 0,
      servedActiveCellCount: 0,
      unservedActiveCellCount: 0,
      coverageBasisPoints: 10_000,
    });
  });

  it('derives scenario-specific catchments without retaining another scenario', () => {
    const inputA = structuredClone(scenarioA);
    const inputB = structuredClone(scenarioB);
    const a = buildStopCatchments({
      grid,
      scenario: scenarioA,
      maxAccessDistanceCells: 2,
    });
    const b = buildStopCatchments({
      grid,
      scenario: scenarioB,
      maxAccessDistanceCells: 2,
    });
    expect(b.cellAssignments).not.toEqual(a.cellAssignments);
    expect(
      a.cellAssignments
        .map((assignment) => assignment.assignedStopPlaceId)
        .filter(Boolean),
    ).not.toContain('place-x');
    expect(
      buildStopCatchments({
        grid,
        scenario: scenarioA,
        maxAccessDistanceCells: 2,
      }),
    ).toEqual(a);
    expect(scenarioA).toEqual(inputA);
    expect(scenarioB).toEqual(inputB);
  });

  it('filters inactive cells before comparisons in a moderately sized sparse grid', () => {
    const weights = Array.from({ length: 50 }, () =>
      Array.from({ length: 60 }, () => 0),
    );
    weights[0]![0] = 2;
    weights[25]![30] = 3;
    weights[49]![59] = 4;
    const sparse = parseCityPopulationGrid({
      schemaVersion: '1.0.0',
      cityId: 'Q1',
      gridVersion: '2.3.4',
      originCellCenter: { latitude: 10.02, longitude: 19.98 },
      resolutionDegrees: 0.001,
      rowDirection: 'north-to-south',
      columnDirection: 'west-to-east',
      rows: 50,
      columns: 60,
      populationWeights: weights,
    });
    const result = buildStopCatchments({
      grid: sparse,
      scenario: scenarioA,
      maxAccessDistanceCells: 2,
    });
    expect(result.grid.totalActiveCellCount).toBe(3);
    expect(result.grid.totalPopulationWeight).toBe(9);
    expect(result.cellAssignments).toHaveLength(3);
  });
});
