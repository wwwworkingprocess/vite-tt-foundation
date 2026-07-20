import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createScenarioCoordinate } from '@torrevieja-tycoon/simulation';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import { createDemoVehicleCommandForAuthority } from './demo-vehicle-command.js';

const root = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'transport-domain',
  'fixtures',
  'torrevieja-mini-v1',
);
const json = (name: string) =>
  JSON.parse(readFileSync(join(root, name), 'utf8')) as Record<string, unknown>;
const packageInput = (
  scenarioId: string,
  patternId: string,
  stopCount: number,
) => {
  const manifest = structuredClone(json('scenario.json'));
  const settlements = structuredClone(json('settlements.json'));
  const stops = structuredClone(json('stops.json'));
  const routes = structuredClone(json('routes.json')) as {
    scenarioId: string;
    routes: Array<{
      routeId: string;
      patterns: Array<{
        patternId: string;
        closesLoop: boolean;
        stopNodeIds: string[];
      }>;
    }>;
  };
  const presentation = structuredClone(json('presentation.json'));
  const provenance = structuredClone(json('provenance.json'));
  for (const value of [manifest, settlements, stops, presentation, provenance])
    value.scenarioId = scenarioId;
  manifest.contentHash = (scenarioId === 'scenario-a' ? 'a' : 'b').repeat(64);
  routes.scenarioId = scenarioId;
  const source = routes.routes[0]!.patterns[0]!;
  routes.routes[0]!.routeId = `${scenarioId}-route`;
  routes.routes[0]!.patterns = [
    {
      ...source,
      patternId,
      closesLoop: false,
      stopNodeIds: source.stopNodeIds.slice(0, stopCount),
    },
  ];
  return parseScenarioPackage({
    manifest,
    settlements,
    stops,
    routes,
    presentation,
    provenance,
  });
};

describe('authoritative demo vehicle command construction', () => {
  const scenarioA = packageInput('scenario-a', 'pattern-a', 5);
  const scenarioB = packageInput('scenario-b', 'pattern-b', 3);
  const cache = new Map([
    [createScenarioCoordinate(scenarioA), scenarioA],
    [createScenarioCoordinate(scenarioB), scenarioB],
  ]);
  const resolve = (coordinate: ReturnType<typeof createScenarioCoordinate>) =>
    [...cache].find(([candidate]) =>
      Object.keys(candidate).every(
        (key) =>
          candidate[key as keyof typeof candidate] ===
          coordinate[key as keyof typeof coordinate],
      ),
    )?.[1];

  it('uses only the canonical package matching authority in both directions', () => {
    const fromB = createDemoVehicleCommandForAuthority(
      createScenarioCoordinate(scenarioB),
      resolve,
    );
    expect(fromB).toMatchObject({ patternId: 'pattern-b' });
    expect(fromB.movementPlan.edgeTravelTicks).toHaveLength(2);
    expect(JSON.stringify(fromB)).not.toContain('pattern-a');

    const fromA = createDemoVehicleCommandForAuthority(
      createScenarioCoordinate(scenarioA),
      resolve,
    );
    expect(fromA).toMatchObject({ patternId: 'pattern-a' });
    expect(fromA.movementPlan.edgeTravelTicks).toHaveLength(4);
    expect(JSON.stringify(fromA)).not.toContain('pattern-b');
  });

  it('does not fall back when the authoritative package is unavailable', () => {
    expect(() =>
      createDemoVehicleCommandForAuthority(
        createScenarioCoordinate(scenarioB),
        (coordinate) =>
          coordinate.scenarioId === 'scenario-a' ? scenarioA : undefined,
      ),
    ).toThrow('authoritative scenario package is unavailable');
  });

  it('rejects a resolver result whose coordinate does not match authority', () => {
    expect(() =>
      createDemoVehicleCommandForAuthority(
        createScenarioCoordinate(scenarioB),
        () => scenarioA,
      ),
    ).toThrow('authoritative scenario package is unavailable');
  });

  it('reports an authoritative package without a usable pattern', () => {
    const withoutRoutes = {
      ...scenarioA,
      routes: { ...scenarioA.routes, routes: [] },
    } as unknown as typeof scenarioA;
    expect(() =>
      createDemoVehicleCommandForAuthority(
        createScenarioCoordinate(scenarioA),
        () => withoutRoutes,
      ),
    ).toThrow('no vehicle route pattern');
  });
});
