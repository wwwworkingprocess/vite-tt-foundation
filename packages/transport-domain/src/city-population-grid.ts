import { z } from 'zod';

export const cityPopulationGridSchemaVersion = '1.0.0' as const;
export const cityPopulationGridResolutionDegrees = 0.001 as const;

export type CityPopulationErrorCode =
  | 'malformed-population-grid'
  | 'unsupported-population-grid-schema'
  | 'invalid-city-id'
  | 'invalid-cell-id'
  | 'invalid-coordinate'
  | 'invalid-stop-place'
  | 'invalid-catchment-configuration'
  | 'arithmetic-overflow';

export class CityPopulationDomainError extends Error {
  readonly code: CityPopulationErrorCode;

  constructor(code: CityPopulationErrorCode, context: string) {
    super(`${code}: ${context}`);
    this.name = 'CityPopulationDomainError';
    this.code = code;
    Object.freeze(this);
  }
}

const cityIdSchema = z
  .string()
  .regex(/^Q[1-9]\d*$/)
  .brand<'CityId'>();
const cellIdSchema = z
  .string()
  .regex(/^r(?:0|[1-9]\d*)c(?:0|[1-9]\d*)$/)
  .brand<'CityPopulationCellId'>();
const stableSemanticVersion = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
const coordinateSchema = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();
const populationWeight = z.number().int().safe().nonnegative();
const gridSchema = z
  .object({
    schemaVersion: z.literal(cityPopulationGridSchemaVersion),
    cityId: cityIdSchema,
    gridVersion: stableSemanticVersion,
    originCellCenter: coordinateSchema,
    resolutionDegrees: z.literal(cityPopulationGridResolutionDegrees),
    rowDirection: z.literal('north-to-south'),
    columnDirection: z.literal('west-to-east'),
    rows: z.number().int().safe().positive(),
    columns: z.number().int().safe().positive(),
    populationWeights: z.array(z.array(populationWeight)),
  })
  .strict();

export type CityId = z.infer<typeof cityIdSchema>;
export type CityPopulationCellId = z.infer<typeof cellIdSchema>;

export interface Wgs84Position {
  readonly latitude: number;
  readonly longitude: number;
}

export interface CityPopulationGrid {
  readonly schemaVersion: typeof cityPopulationGridSchemaVersion;
  readonly cityId: CityId;
  readonly gridVersion: string;
  readonly originCellCenter: Readonly<Wgs84Position>;
  readonly resolutionDegrees: typeof cityPopulationGridResolutionDegrees;
  readonly rowDirection: 'north-to-south';
  readonly columnDirection: 'west-to-east';
  readonly rows: number;
  readonly columns: number;
  readonly populationWeights: readonly (readonly number[])[];
}

export interface ActivePopulationCell {
  readonly cellId: CityPopulationCellId;
  readonly row: number;
  readonly column: number;
  readonly center: Readonly<Wgs84Position>;
  readonly populationWeight: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const deepFreeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

export function parseCityId(value: unknown): CityId {
  const result = cityIdSchema.safeParse(value);
  if (!result.success)
    throw new CityPopulationDomainError(
      'invalid-city-id',
      'expected Wikidata Q-code with a positive integer',
    );
  return result.data;
}

export function parseCityPopulationCellId(
  value: unknown,
): CityPopulationCellId {
  const result = cellIdSchema.safeParse(value);
  if (!result.success)
    throw new CityPopulationDomainError(
      'invalid-cell-id',
      'expected r<row>c<column>',
    );
  return result.data;
}

export function parseCityPopulationGrid(value: unknown): CityPopulationGrid {
  if (
    isRecord(value) &&
    'schemaVersion' in value &&
    value.schemaVersion !== cityPopulationGridSchemaVersion
  )
    throw new CityPopulationDomainError(
      'unsupported-population-grid-schema',
      String(value.schemaVersion),
    );
  if (isRecord(value) && 'cityId' in value) parseCityId(value.cityId);
  const result = gridSchema.safeParse(value);
  if (!result.success)
    throw new CityPopulationDomainError(
      'malformed-population-grid',
      result.error.issues[0]!.message,
    );
  const parsed = result.data;
  if (
    parsed.populationWeights.length !== parsed.rows ||
    parsed.populationWeights.some((row) => row.length !== parsed.columns)
  )
    throw new CityPopulationDomainError(
      'malformed-population-grid',
      'populationWeights must exactly match rows and columns',
    );
  const southmostLatitude =
    parsed.originCellCenter.latitude -
    (parsed.rows - 1) * cityPopulationGridResolutionDegrees;
  const eastmostLongitude =
    parsed.originCellCenter.longitude +
    (parsed.columns - 1) * cityPopulationGridResolutionDegrees;
  if (
    !Number.isFinite(southmostLatitude) ||
    southmostLatitude < -90 ||
    !Number.isFinite(eastmostLongitude) ||
    eastmostLongitude > 180
  )
    throw new CityPopulationDomainError(
      'invalid-coordinate',
      'derived grid cell centre is outside WGS84 bounds',
    );
  return deepFreeze({
    schemaVersion: parsed.schemaVersion,
    cityId: parsed.cityId,
    gridVersion: parsed.gridVersion,
    originCellCenter: { ...parsed.originCellCenter },
    resolutionDegrees: parsed.resolutionDegrees,
    rowDirection: parsed.rowDirection,
    columnDirection: parsed.columnDirection,
    rows: parsed.rows,
    columns: parsed.columns,
    populationWeights: parsed.populationWeights.map((row) => [...row]),
  });
}

export function listActivePopulationCells(
  grid: CityPopulationGrid,
): readonly Readonly<ActivePopulationCell>[] {
  const cells: ActivePopulationCell[] = [];
  for (let row = 0; row < grid.rows; row += 1)
    for (let column = 0; column < grid.columns; column += 1) {
      const weight = grid.populationWeights[row]?.[column];
      if (weight === undefined)
        throw new CityPopulationDomainError(
          'malformed-population-grid',
          `missing weight at row ${row}, column ${column}`,
        );
      if (weight > 0)
        cells.push({
          cellId: parseCityPopulationCellId(`r${row}c${column}`),
          row,
          column,
          center: {
            latitude:
              grid.originCellCenter.latitude -
              row * cityPopulationGridResolutionDegrees,
            longitude:
              grid.originCellCenter.longitude +
              column * cityPopulationGridResolutionDegrees,
          },
          populationWeight: weight,
        });
    }
  return deepFreeze(cells);
}
