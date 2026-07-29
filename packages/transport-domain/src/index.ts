import { z } from 'zod';

export * from './city-population-grid.js';
export * from './stop-catchment.js';

export const scenarioSchemaVersion = '1.0.0' as const;

export type ScenarioErrorCode =
  | 'malformed-catalogue'
  | 'malformed-manifest'
  | 'malformed-asset'
  | 'unsupported-schema-version'
  | 'unsafe-asset-path'
  | 'content-integrity-mismatch'
  | 'duplicate-identifier'
  | 'unresolved-reference'
  | 'invalid-coordinate'
  | 'graph-construction-invariant';

export class ScenarioDomainError extends Error {
  readonly code: ScenarioErrorCode;
  constructor(code: ScenarioErrorCode, context: string) {
    super(`${code}: ${context}`);
    this.name = 'ScenarioDomainError';
    this.code = code;
    Object.freeze(this);
  }
}

const id = <T extends string>() => z.string().trim().min(1).brand<T>();
const scenarioId = id<'ScenarioId'>();
const settlementId = id<'SettlementId'>();
const stopPlaceId = id<'StopPlaceId'>();
const stopNodeId = id<'StopNodeId'>();
const routeId = id<'RouteId'>();
const patternId = id<'RoutePatternId'>();
export type ScenarioId = z.infer<typeof scenarioId>;
export type SettlementId = z.infer<typeof settlementId>;
export type StopPlaceId = z.infer<typeof stopPlaceId>;
export type StopNodeId = z.infer<typeof stopNodeId>;
export type RouteId = z.infer<typeof routeId>;
export type RoutePatternId = z.infer<typeof patternId>;
export type DirectedEdgeId = string & z.core.$brand<'DirectedEdgeId'>;

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const version = z.literal(scenarioSchemaVersion);
const scenarioDataVersion = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
const scenarioStatus = z.enum(['development-seed', 'playable', 'test-fixture']);
const nonEmpty = z.string().trim().min(1);
const safePath = z.string().superRefine((value, context) => {
  if (
    !/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(value) ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    /^[a-z][a-z0-9+.-]*:/i.test(value) ||
    value.split(/[\\/]/).some((part) => part === '..' || part === '')
  )
    context.addIssue({ code: 'custom', message: 'unsafe asset path' });
});
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const position = z
  .object({ latitude: z.number().finite(), longitude: z.number().finite() })
  .strict();
const bounds = z
  .object({
    south: z.number().finite(),
    west: z.number().finite(),
    north: z.number().finite(),
    east: z.number().finite(),
  })
  .strict();
const asset = z
  .object({ path: safePath, required: z.boolean(), sha256: hash })
  .strict();
const descriptor = z
  .object({
    scenarioId,
    scenarioVersion: scenarioDataVersion,
    title: nonEmpty,
    primarySettlementId: settlementId,
    settlementIds: z.array(settlementId),
    manifestPath: safePath,
    status: scenarioStatus,
    contentHash: hash,
  })
  .strict();
const catalogSchema = z
  .object({
    schemaVersion: version,
    catalogId: nonEmpty,
    scenarios: z.array(descriptor),
  })
  .strict();
const manifestSchema = z
  .object({
    schemaVersion: version,
    scenarioId,
    scenarioVersion: scenarioDataVersion,
    status: scenarioStatus,
    title: nonEmpty,
    primarySettlementId: settlementId,
    settlementIds: z.array(settlementId),
    contentHash: hash,
    assets: z.record(z.string(), asset),
    graphContract: z
      .object({
        vertexSource: z.literal('stops.stopNodes'),
        edgeDerivation: z.literal('consecutive-stopNodeIds'),
        closeLoopPolicy: z.literal(
          'add-last-to-first-only-when-closesLoop-is-true',
        ),
        reverseEdgePolicy: z.literal('never-infer'),
      })
      .strict(),
  })
  .strict();
const settlementSchema = z
  .object({
    settlementId,
    name: nonEmpty,
    countryCode: nonEmpty,
    adminArea: nonEmpty,
    center: position,
    bounds,
  })
  .strict();
const settlementsFileSchema = z
  .object({
    schemaVersion: version,
    scenarioId,
    settlements: z.array(settlementSchema),
  })
  .strict();
const sourceReference = z
  .object({
    source: z.literal('openstreetmap'),
    role: z.enum(['platform', 'stop-position']),
    sourceType: z.enum(['node', 'way', 'relation']),
    sourceId: nonEmpty,
    sourceRef: z.string().optional(),
  })
  .strict();
const stopPlaceSchema = z
  .object({
    settlementId,
    stopPlaceId,
    name: nonEmpty,
    position: position.optional(),
  })
  .strict();
const stopNodeSchema = z
  .object({
    stopNodeId,
    stopPlaceId: stopPlaceId.nullable(),
    settlementId,
    name: z.string().trim().min(1).nullable(),
    position,
    sourceReferences: z.array(sourceReference),
    resolution: z
      .object({
        status: nonEmpty,
        distanceMetres: z.number().finite().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();
const stopsFileSchema = z
  .object({
    schemaVersion: version,
    scenarioId,
    stopPlaces: z.array(stopPlaceSchema),
    stopNodes: z.array(stopNodeSchema),
  })
  .strict();
const jsonValue = z.json();
const metadataObject = z.record(z.string(), jsonValue);
const routePatternSchema = z
  .object({
    patternId,
    directionLabel: nonEmpty,
    closesLoop: z.boolean(),
    sourceSequenceRange: z
      .object({ from: z.number().int(), to: z.number().int() })
      .strict()
      .optional(),
    stopNodeIds: z.array(stopNodeId).min(2),
  })
  .strict();
const routeSchema = z
  .object({
    routeId,
    publicCode: nonEmpty,
    name: nonEmpty,
    dataStatus: nonEmpty,
    patterns: z.array(routePatternSchema).min(1),
    sourceReferences: z.array(metadataObject).optional(),
  })
  .strict();
const routesFileSchema = z
  .object({ schemaVersion: version, scenarioId, routes: z.array(routeSchema) })
  .strict();
const optionalMetadataSchema = z
  .object({ schemaVersion: version, scenarioId })
  .catchall(jsonValue);

export type DeepReadonly<T> = T extends
  string | number | boolean | bigint | symbol | null | undefined
  ? T
  : T extends (...arguments_: never[]) => unknown
    ? T
    : T extends readonly (infer Item)[]
      ? readonly DeepReadonly<Item>[]
      : T extends object
        ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
        : T;
export type ScenarioDescriptor = DeepReadonly<z.infer<typeof descriptor>>;
export type ScenarioCatalog = DeepReadonly<z.infer<typeof catalogSchema>>;
export type ScenarioManifest = DeepReadonly<z.infer<typeof manifestSchema>>;
export type CanonicalScenario = DeepReadonly<{
  manifest: z.infer<typeof manifestSchema>;
  settlements: z.infer<typeof settlementsFileSchema>;
  stops: z.infer<typeof stopsFileSchema>;
  routes: z.infer<typeof routesFileSchema>;
  presentation?: z.infer<typeof optionalMetadataSchema>;
  provenance?: z.infer<typeof optionalMetadataSchema>;
}>;

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
}
const parse = <T>(
  schema: z.ZodType<T>,
  value: unknown,
  code: ScenarioErrorCode,
  context: string,
): T => {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ScenarioDomainError(
      code,
      `${context}: ${result.error.issues[0]?.message ?? 'invalid value'}`,
    );
  return result.data;
};
const rejectUnsupported = (value: unknown, context: string) => {
  if (
    isRecord(value) &&
    'schemaVersion' in value &&
    (value as { schemaVersion?: unknown }).schemaVersion !==
      scenarioSchemaVersion
  )
    throw new ScenarioDomainError('unsupported-schema-version', context);
};
const assertUnique = (values: readonly string[], kind: string) => {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value))
      throw new ScenarioDomainError('duplicate-identifier', `${kind} ${value}`);
    seen.add(value);
  }
};
const assertPosition = (
  value: { latitude: number; longitude: number },
  context: string,
) => {
  if (
    value.latitude < -90 ||
    value.latitude > 90 ||
    value.longitude < -180 ||
    value.longitude > 180
  )
    throw new ScenarioDomainError('invalid-coordinate', context);
};

export function parseScenarioCatalog(value: unknown): ScenarioCatalog {
  rejectUnsupported(value, 'catalogue');
  if (
    typeof value === 'object' &&
    value !== null &&
    'scenarios' in value &&
    Array.isArray(value.scenarios)
  )
    for (const item of value.scenarios)
      if (
        isRecord(item) &&
        'manifestPath' in item &&
        typeof item.manifestPath === 'string' &&
        !safePath.safeParse(item.manifestPath).success
      )
        throw new ScenarioDomainError(
          'unsafe-asset-path',
          `catalogue manifest ${item.manifestPath}`,
        );
  const parsed = parse(
    catalogSchema,
    value,
    'malformed-catalogue',
    'catalogue',
  );
  assertUnique(
    parsed.scenarios.map((item) => item.scenarioId),
    'scenario',
  );
  for (const item of parsed.scenarios) {
    assertUnique(
      item.settlementIds,
      `catalogue scenario ${item.scenarioId} settlement`,
    );
    if (!item.settlementIds.includes(item.primarySettlementId))
      throw new ScenarioDomainError(
        'unresolved-reference',
        `catalogue primary settlement ${item.primarySettlementId}`,
      );
  }
  return deepFreeze(parsed);
}

export function parseScenarioManifest(value: unknown): ScenarioManifest {
  rejectUnsupported(value, 'manifest');
  if (
    isRecord(value) &&
    'assets' in value &&
    typeof value.assets === 'object' &&
    value.assets !== null
  )
    for (const [name, entry] of Object.entries(value.assets))
      if (
        isRecord(entry) &&
        'path' in entry &&
        typeof entry.path === 'string' &&
        !safePath.safeParse(entry.path).success
      )
        throw new ScenarioDomainError(
          'unsafe-asset-path',
          `${name}: ${entry.path}`,
        );
  const parsed = parse(manifestSchema, value, 'malformed-manifest', 'manifest');
  assertUnique(
    parsed.settlementIds,
    `manifest scenario ${parsed.scenarioId} settlement`,
  );
  if (!parsed.settlementIds.includes(parsed.primarySettlementId))
    throw new ScenarioDomainError(
      'unresolved-reference',
      `manifest primary settlement ${parsed.primarySettlementId}`,
    );
  for (const required of ['settlements', 'stops', 'routes'])
    if (!parsed.assets[required]?.required)
      throw new ScenarioDomainError(
        'malformed-manifest',
        `missing required asset ${required}`,
      );
  for (const [name, entry] of Object.entries(parsed.assets)) {
    const checked = safePath.safeParse(entry.path);
    if (!checked.success)
      throw new ScenarioDomainError(
        'unsafe-asset-path',
        `${name}: ${entry.path}`,
      );
  }
  return deepFreeze(parsed);
}

export function assertScenarioDescriptorMatchesManifest(
  descriptorValue: ScenarioDescriptor,
  manifest: ScenarioManifest,
) {
  if (
    descriptorValue.scenarioId !== manifest.scenarioId ||
    descriptorValue.scenarioVersion !== manifest.scenarioVersion ||
    descriptorValue.status !== manifest.status ||
    descriptorValue.title !== manifest.title ||
    descriptorValue.primarySettlementId !== manifest.primarySettlementId ||
    descriptorValue.settlementIds.length !== manifest.settlementIds.length ||
    descriptorValue.settlementIds.some(
      (idValue, index) => idValue !== manifest.settlementIds[index],
    )
  )
    throw new ScenarioDomainError(
      'unresolved-reference',
      `catalogue/manifest parity ${descriptorValue.scenarioId}`,
    );
  if (descriptorValue.contentHash !== manifest.contentHash)
    throw new ScenarioDomainError(
      'content-integrity-mismatch',
      `catalogue/manifest contentHash ${descriptorValue.scenarioId}`,
    );
}

export function parseScenarioPackage(value: {
  readonly manifest: unknown;
  readonly settlements: unknown;
  readonly stops: unknown;
  readonly routes: unknown;
  readonly presentation?: unknown;
  readonly provenance?: unknown;
}): CanonicalScenario {
  const manifest = parseScenarioManifest(value.manifest);
  for (const [name, raw] of [
    ['settlements', value.settlements],
    ['stops', value.stops],
    ['routes', value.routes],
  ] as const)
    rejectUnsupported(raw, name);
  const settlements = parse(
    settlementsFileSchema,
    value.settlements,
    'malformed-asset',
    'settlements',
  );
  const stops = parse(stopsFileSchema, value.stops, 'malformed-asset', 'stops');
  const routes = parse(
    routesFileSchema,
    value.routes,
    'malformed-asset',
    'routes',
  );
  for (const [name, file] of [
    ['settlements', settlements],
    ['stops', stops],
    ['routes', routes],
  ] as const)
    if (file.scenarioId !== manifest.scenarioId)
      throw new ScenarioDomainError(
        'unresolved-reference',
        `${name} scenarioId ${file.scenarioId}`,
      );
  assertUnique(
    settlements.settlements.map((item) => item.settlementId),
    'settlement',
  );
  const settlementIds = new Set(
    settlements.settlements.map((item) => item.settlementId),
  );
  if (
    settlements.settlements.length !== manifest.settlementIds.length ||
    settlements.settlements.some(
      (item, index) => item.settlementId !== manifest.settlementIds[index],
    )
  )
    throw new ScenarioDomainError(
      'unresolved-reference',
      'settlement file does not exactly match manifest settlementIds',
    );
  for (const settlement of settlements.settlements) {
    assertPosition(
      settlement.center,
      `settlement ${settlement.settlementId} center`,
    );
    const { south, west, north, east } = settlement.bounds;
    assertPosition(
      { latitude: south, longitude: west },
      `settlement ${settlement.settlementId} southwest bounds`,
    );
    assertPosition(
      { latitude: north, longitude: east },
      `settlement ${settlement.settlementId} northeast bounds`,
    );
    if (
      south > north ||
      west > east ||
      settlement.center.latitude < south ||
      settlement.center.latitude > north ||
      settlement.center.longitude < west ||
      settlement.center.longitude > east
    )
      throw new ScenarioDomainError(
        'invalid-coordinate',
        `settlement ${settlement.settlementId} bounds`,
      );
  }
  for (const expected of manifest.settlementIds)
    if (!settlementIds.has(expected))
      throw new ScenarioDomainError(
        'unresolved-reference',
        `settlement ${expected}`,
      );
  assertUnique(
    stops.stopPlaces.map((item) => item.stopPlaceId),
    'stop place',
  );
  assertUnique(
    stops.stopNodes.map((item) => item.stopNodeId),
    'stop node',
  );
  const stopPlaceIds = new Set(
    stops.stopPlaces.map((item) => item.stopPlaceId),
  );
  for (const place of stops.stopPlaces) {
    if (!settlementIds.has(place.settlementId))
      throw new ScenarioDomainError(
        'unresolved-reference',
        `stop place settlement ${place.settlementId}`,
      );
    if (place.position)
      assertPosition(place.position, `stop place ${place.stopPlaceId}`);
  }
  for (const node of stops.stopNodes) {
    if (!settlementIds.has(node.settlementId))
      throw new ScenarioDomainError(
        'unresolved-reference',
        `stop settlement ${node.settlementId}`,
      );
    if (node.stopPlaceId && !stopPlaceIds.has(node.stopPlaceId))
      throw new ScenarioDomainError(
        'unresolved-reference',
        `stop place ${node.stopPlaceId}`,
      );
    assertPosition(node.position, `stop node ${node.stopNodeId}`);
  }
  assertUnique(
    routes.routes.map((item) => item.routeId),
    'route',
  );
  const patterns = routes.routes.flatMap((route) => route.patterns);
  assertUnique(
    patterns.map((item) => item.patternId),
    'route pattern',
  );
  const nodeIds = new Set(stops.stopNodes.map((item) => item.stopNodeId));
  for (const pattern of patterns) {
    for (const node of pattern.stopNodeIds)
      if (!nodeIds.has(node))
        throw new ScenarioDomainError(
          'unresolved-reference',
          `pattern ${pattern.patternId} stop ${node}`,
        );
    for (let index = 1; index < pattern.stopNodeIds.length; index += 1)
      if (pattern.stopNodeIds[index] === pattern.stopNodeIds[index - 1])
        throw new ScenarioDomainError(
          'graph-construction-invariant',
          `pattern ${pattern.patternId} repeats ${pattern.stopNodeIds[index]}`,
        );
  }
  const optional = (raw: unknown, name: string) => {
    if (raw === undefined) return undefined;
    rejectUnsupported(raw, name);
    const parsed = parse(optionalMetadataSchema, raw, 'malformed-asset', name);
    if (parsed.scenarioId !== manifest.scenarioId)
      throw new ScenarioDomainError(
        'unresolved-reference',
        `${name} scenarioId ${parsed.scenarioId}`,
      );
    return parsed;
  };
  const presentation = optional(value.presentation, 'presentation');
  const provenance = optional(value.provenance, 'provenance');
  return deepFreeze({
    manifest,
    settlements,
    stops,
    routes,
    ...(presentation === undefined ? {} : { presentation }),
    ...(provenance === undefined ? {} : { provenance }),
  });
}

export interface DirectedEdge {
  readonly edgeId: DirectedEdgeId;
  readonly routeId: RouteId;
  readonly patternId: RoutePatternId;
  readonly sequence: number;
  readonly fromStopNodeId: StopNodeId;
  readonly toStopNodeId: StopNodeId;
}
export interface DirectedScenarioGraph {
  readonly nodes: DeepReadonly<CanonicalScenario['stops']['stopNodes']>;
  readonly edges: readonly DeepReadonly<DirectedEdge>[];
  readonly summary: Readonly<{
    nodes: number;
    edges: number;
    routes: number;
    patterns: number;
  }>;
  readonly outgoingEdges: (
    stop: string,
  ) => readonly DeepReadonly<DirectedEdge>[];
  readonly incomingEdges: (
    stop: string,
  ) => readonly DeepReadonly<DirectedEdge>[];
  readonly patternEdges: (
    pattern: string,
  ) => readonly DeepReadonly<DirectedEdge>[];
  readonly route: (
    id: string,
  ) => DeepReadonly<CanonicalScenario['routes']['routes'][number]> | undefined;
  readonly pattern: (
    id: string,
  ) =>
    | DeepReadonly<
        CanonicalScenario['routes']['routes'][number]['patterns'][number]
      >
    | undefined;
}

export function buildDirectedScenarioGraph(
  scenario: CanonicalScenario,
): DirectedScenarioGraph {
  const edges: DirectedEdge[] = [];
  const edgeIds = new Set<string>();
  for (const route of scenario.routes.routes)
    for (const pattern of route.patterns) {
      const pairs =
        pattern.stopNodeIds.length - 1 + (pattern.closesLoop ? 1 : 0);
      for (let sequence = 0; sequence < pairs; sequence += 1) {
        const edgeId = `${pattern.patternId}:${sequence}` as DirectedEdgeId;
        if (edgeIds.has(edgeId))
          throw new ScenarioDomainError(
            'graph-construction-invariant',
            `duplicate edge ${edgeId}`,
          );
        edgeIds.add(edgeId);
        edges.push({
          edgeId,
          routeId: route.routeId,
          patternId: pattern.patternId,
          sequence,
          fromStopNodeId: pattern.stopNodeIds[sequence]!,
          toStopNodeId:
            pattern.stopNodeIds[(sequence + 1) % pattern.stopNodeIds.length]!,
        });
      }
    }
  const frozenEdges = deepFreeze(edges);
  const select = (
    field: 'fromStopNodeId' | 'toStopNodeId' | 'patternId',
    value: string,
  ) => deepFreeze(frozenEdges.filter((edge) => edge[field] === value));
  const routes = scenario.routes.routes;
  const graph: DirectedScenarioGraph = {
    nodes: scenario.stops.stopNodes,
    edges: frozenEdges,
    summary: deepFreeze({
      nodes: scenario.stops.stopNodes.length,
      edges: edges.length,
      routes: routes.length,
      patterns: routes.reduce(
        (count, route) => count + route.patterns.length,
        0,
      ),
    }),
    outgoingEdges: (stop) => select('fromStopNodeId', stop),
    incomingEdges: (stop) => select('toStopNodeId', stop),
    patternEdges: (pattern) => select('patternId', pattern),
    route: (id) => routes.find((route) => route.routeId === id),
    pattern: (id) =>
      routes
        .flatMap((route) => route.patterns)
        .find((pattern) => pattern.patternId === id),
  };
  return deepFreeze(graph);
}
