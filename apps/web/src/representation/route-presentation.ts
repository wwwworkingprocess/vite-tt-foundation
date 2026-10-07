import { z } from 'zod';
import type { CanonicalScenario } from '@torrevieja-tycoon/transport-domain';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const diagnostic = z.record(z.string(), z.unknown());
const coordinate = z
  .array(z.number())
  .length(2)
  .refine((c) => c[0]! >= -180 && c[0]! <= 180 && c[1]! >= -90 && c[1]! <= 90);
const schema = z.strictObject({
  schemaVersion: z.literal('0.1.0'),
  scenarioId: z.string(),
  status: z.literal('derived-review-candidate'),
  authority: z.strictObject({
    transportAuthority: z.literal('routes.json + stops.json'),
    role: z.literal('optional-presentation-enrichment'),
    simulationAuthority: z.literal(false),
    persistenceAuthority: z.literal(false),
    fallback: z.string(),
  }),
  inputs: z.strictObject({
    routes: z.strictObject({ sha256: hash }),
    stops: z.strictObject({ sha256: hash }),
    geoSource: z.strictObject({ sha256: hash }),
  }),
  derivation: diagnostic,
  sourceLineCatalogue: z.record(z.string(), diagnostic),
  routes: z.array(
    z.strictObject({
      routeId: z.string(),
      publicCode: z.string(),
      name: z.string(),
      color,
      styleSourceCode: z.string(),
      geometrySourceCandidates: z.array(z.string()),
      patterns: z.array(
        z.strictObject({
          patternId: z.string(),
          directionLabel: z.string(),
          closesLoop: z.boolean(),
          stopNodeIds: z.array(z.string()),
          geometryCoverage: diagnostic,
          legs: z.array(
            z.strictObject({
              fromStopNodeId: z.string(),
              toStopNodeId: z.string(),
              geometryStatus: z.enum([
                'source-derived',
                'canonical-chord-fallback',
              ]),
              coordinates: z.array(coordinate).min(2),
              lengthMeters: z.number().positive(),
              quality: diagnostic,
              provenance: z.array(z.string()),
              qualityClass: z.enum(['high', 'medium', 'fallback']),
              fallbackReason: z.string().optional(),
            }),
          ),
        }),
      ),
    }),
  ),
});
type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;
export type RoutePresentationAsset = DeepReadonly<z.infer<typeof schema>>;
export function freezeRoutePresentation<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeRoutePresentation);
    Object.freeze(value);
  }
  return value;
}
export function parseRoutePresentation(
  input: unknown,
  scenario: CanonicalScenario,
): RoutePresentationAsset {
  return validateRoutePresentation(schema.parse(input), scenario);
}
export function validateRoutePresentation(
  asset: RoutePresentationAsset,
  scenario: CanonicalScenario,
): RoutePresentationAsset {
  const require = (valid: boolean) => {
    if (!valid)
      throw new Error('Route presentation contradicts canonical scenario');
  };
  require(
    asset.scenarioId === scenario.manifest.scenarioId &&
      asset.inputs.routes.sha256 === scenario.manifest.assets.routes?.sha256 &&
      asset.inputs.stops.sha256 === scenario.manifest.assets.stops?.sha256,
  );
  const nodes = new Map(
    scenario.stops.stopNodes.map((n) => [n.stopNodeId as string, n.position]),
  );
  require(
    new Set(asset.routes.map((r) => r.routeId)).size === asset.routes.length,
  );
  for (const route of asset.routes) {
    const canonical = scenario.routes.routes.find(
      (r) => r.routeId === route.routeId,
    );
    require(!!canonical);
    require(
      new Set(route.patterns.map((p) => p.patternId)).size ===
        route.patterns.length,
    );
    for (const pattern of route.patterns) {
      const original = canonical!.patterns.find(
        (p) => p.patternId === pattern.patternId,
      );
      require(
        !!original &&
          original.closesLoop === pattern.closesLoop &&
          JSON.stringify(original.stopNodeIds) ===
            JSON.stringify(pattern.stopNodeIds),
      );
      require(
        pattern.legs.length ===
          pattern.stopNodeIds.length - 1 + Number(pattern.closesLoop),
      );
      pattern.legs.forEach((leg, index) => {
        const from = nodes.get(leg.fromStopNodeId);
        const to = nodes.get(leg.toStopNodeId);
        require(
          leg.fromStopNodeId === pattern.stopNodeIds[index] &&
            leg.toStopNodeId ===
              pattern.stopNodeIds[(index + 1) % pattern.stopNodeIds.length],
        );
        const first = leg.coordinates[0]!;
        const last = leg.coordinates.at(-1)!;
        require(
          !!from &&
            !!to &&
            first[0] === from.longitude &&
            first[1] === from.latitude &&
            last[0] === to.longitude &&
            last[1] === to.latitude,
        );
        require(
          leg.geometryStatus !== 'canonical-chord-fallback' ||
            leg.coordinates.length === 2,
        );
      });
    }
  }
  return freezeRoutePresentation(asset);
}
