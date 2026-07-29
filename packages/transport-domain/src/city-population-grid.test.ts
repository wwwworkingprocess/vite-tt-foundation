import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CityPopulationDomainError,
  listActivePopulationCells,
  parseCityId,
  parseCityPopulationCellId,
  parseCityPopulationGrid,
} from './city-population-grid.js';

const fixture = JSON.parse(
  readFileSync(
    new URL('../fixtures/population/mini-grid.json', import.meta.url),
    'utf8',
  ),
) as unknown;
const cloneFixture = () => structuredClone(fixture) as Record<string, unknown>;

describe('City Population Grid V1', () => {
  it('parses a strict dense grid and validates Wikidata city and cell identities', () => {
    const grid = parseCityPopulationGrid(fixture);
    expect(grid).toMatchObject({
      schemaVersion: '1.0.0',
      cityId: 'Q36730',
      gridVersion: '1.0.0',
      resolutionDegrees: 0.001,
      rowDirection: 'north-to-south',
      columnDirection: 'west-to-east',
      rows: 5,
      columns: 6,
    });
    expect(parseCityId('Q1')).toBe('Q1');
    expect(parseCityId('Q1234567')).toBe('Q1234567');
    expect(parseCityPopulationCellId('r12c8')).toBe('r12c8');
  });

  it.each(['1', 'q1', 'Q0', 'Q-1', 'Q1.5', ' Q1', 'Q1 ', 'QQ1', 'Q1x'])(
    'rejects invalid city identity %s',
    (cityId) => {
      expect(() => parseCityId(cityId)).toThrow(CityPopulationDomainError);
      const input = cloneFixture();
      input.cityId = cityId;
      expect(() => parseCityPopulationGrid(input)).toThrow(/invalid-city-id/);
    },
  );

  it.each(['r-1c0', 'r0c-1', 'r1.5c0', 'R0C0', 'r0c0x'])(
    'rejects invalid cell identity %s',
    (cellId) =>
      expect(() => parseCityPopulationCellId(cellId)).toThrow(
        /invalid-cell-id/,
      ),
  );

  it.each([
    [
      'unsupported schema',
      (input: Record<string, unknown>) => {
        input.schemaVersion = '2.0.0';
      },
    ],
    [
      'malformed grid version',
      (input: Record<string, unknown>) => {
        input.gridVersion = 'v1';
      },
    ],
    [
      'wrong resolution',
      (input: Record<string, unknown>) => {
        input.resolutionDegrees = 0.002;
      },
    ],
    [
      'wrong row direction',
      (input: Record<string, unknown>) => {
        input.rowDirection = 'south-to-north';
      },
    ],
    [
      'wrong column direction',
      (input: Record<string, unknown>) => {
        input.columnDirection = 'east-to-west';
      },
    ],
    [
      'invalid latitude',
      (input: Record<string, unknown>) => {
        (input.originCellCenter as { latitude: number }).latitude = 91;
      },
    ],
    [
      'invalid longitude',
      (input: Record<string, unknown>) => {
        (input.originCellCenter as { longitude: number }).longitude = 181;
      },
    ],
    [
      'zero rows',
      (input: Record<string, unknown>) => {
        input.rows = 0;
      },
    ],
    [
      'zero columns',
      (input: Record<string, unknown>) => {
        input.columns = 0;
      },
    ],
    [
      'extra rows',
      (input: Record<string, unknown>) => {
        (input.populationWeights as unknown[][]).push([0, 0, 0, 0, 0, 0]);
      },
    ],
    [
      'ragged short row',
      (input: Record<string, unknown>) => {
        (input.populationWeights as unknown[][])[1] = [1];
      },
    ],
    [
      'ragged extra column',
      (input: Record<string, unknown>) => {
        (input.populationWeights as unknown[][])[1]!.push(1);
      },
    ],
    [
      'null row',
      (input: Record<string, unknown>) => {
        (input.populationWeights as unknown[])[1] = null;
      },
    ],
    [
      'sparse row',
      (input: Record<string, unknown>) => {
        delete (input.populationWeights as number[][])[1]![2];
      },
    ],
    [
      'negative weight',
      (input: Record<string, unknown>) => {
        (input.populationWeights as number[][])[0]![0] = -1;
      },
    ],
    [
      'fractional weight',
      (input: Record<string, unknown>) => {
        (input.populationWeights as number[][])[0]![0] = 0.5;
      },
    ],
    [
      'unsafe weight',
      (input: Record<string, unknown>) => {
        (input.populationWeights as number[][])[0]![0] =
          Number.MAX_SAFE_INTEGER + 1;
      },
    ],
    [
      'NaN weight',
      (input: Record<string, unknown>) => {
        (input.populationWeights as number[][])[0]![0] = Number.NaN;
      },
    ],
    [
      'infinite weight',
      (input: Record<string, unknown>) => {
        (input.populationWeights as number[][])[0]![0] =
          Number.POSITIVE_INFINITY;
      },
    ],
    [
      'unknown field',
      (input: Record<string, unknown>) => {
        input.extra = true;
      },
    ],
  ] as const)('rejects malformed grid: %s', (_name, mutate) => {
    const input = cloneFixture();
    mutate(input);
    expect(() => parseCityPopulationGrid(input)).toThrow(
      CityPopulationDomainError,
    );
  });

  it('rejects derived cell centres outside WGS84 bounds', () => {
    const south = cloneFixture();
    (south.originCellCenter as { latitude: number }).latitude = -89.999;
    expect(() => parseCityPopulationGrid(south)).toThrow(/invalid-coordinate/);
    const east = cloneFixture();
    (east.originCellCenter as { longitude: number }).longitude = 179.999;
    expect(() => parseCityPopulationGrid(east)).toThrow(/invalid-coordinate/);
  });

  it.each(['1.0.1', '2.3.4'])(
    'accepts stable independent grid version %s',
    (gridVersion) => {
      const input = cloneFixture();
      input.gridVersion = gridVersion;
      expect(parseCityPopulationGrid(input).gridVersion).toBe(gridVersion);
    },
  );

  it('rejects a missing city identity and malformed public grid projections', () => {
    const missingCity = cloneFixture();
    delete missingCity.cityId;
    expect(() => parseCityPopulationGrid(missingCity)).toThrow(
      /malformed-population-grid/,
    );
    const grid = parseCityPopulationGrid(fixture);
    const malformed = {
      ...grid,
      populationWeights: grid.populationWeights.slice(0, 1),
    };
    expect(() => listActivePopulationCells(malformed)).toThrow(
      /malformed-population-grid/,
    );
  });

  it('derives only positive cells in row-major order with exact centres and weights', () => {
    const source = cloneFixture();
    const before = structuredClone(source);
    const grid = parseCityPopulationGrid(source);
    const active = listActivePopulationCells(grid);
    expect(active.map((cell) => cell.cellId)).toEqual([
      'r0c1',
      'r0c5',
      'r1c0',
      'r1c3',
      'r2c2',
      'r3c1',
      'r3c4',
      'r4c0',
      'r4c5',
    ]);
    expect(active[0]).toEqual({
      cellId: 'r0c1',
      row: 0,
      column: 1,
      center: { latitude: 10.002, longitude: 20.001 },
      populationWeight: 2,
    });
    expect(active[4]).toEqual({
      cellId: 'r2c2',
      row: 2,
      column: 2,
      center: { latitude: 10, longitude: 20.002 },
      populationWeight: 5,
    });
    expect(source).toEqual(before);
    expect(grid.populationWeights[0]![0]).toBe(0);
  });

  it('clones and deeply freezes parsed grids and active projections', () => {
    const source = cloneFixture();
    const grid = parseCityPopulationGrid(source);
    const active = listActivePopulationCells(grid);
    expect(Object.isFrozen(grid)).toBe(true);
    expect(Object.isFrozen(grid.originCellCenter)).toBe(true);
    expect(Object.isFrozen(grid.populationWeights)).toBe(true);
    expect(Object.isFrozen(grid.populationWeights[0])).toBe(true);
    expect(Object.isFrozen(active)).toBe(true);
    expect(Object.isFrozen(active[0])).toBe(true);
    expect(Object.isFrozen(active[0]!.center)).toBe(true);
    expect(Reflect.set(active[0]!.center, 'latitude', 0)).toBe(false);
    expect(active[0]!.center.latitude).toBe(10.002);
    (source.populationWeights as number[][])[0]![1] = 999;
    expect(grid.populationWeights[0]![1]).toBe(2);
  });
});
