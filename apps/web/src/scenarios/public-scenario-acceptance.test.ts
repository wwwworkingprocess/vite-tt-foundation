import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildDirectedScenarioGraph,
  parseScenarioPackage,
  type CanonicalScenario,
} from '@torrevieja-tycoon/transport-domain';
import {
  advanceTransportTicks,
  applyTransportVehicleCommand,
  createScenarioCoordinate,
  createTransportSimulationState,
  parseTickAdvancement,
} from '@torrevieja-tycoon/simulation';
import { createDemoVehicleCommandForAuthority } from '../transport-representation/demo-vehicle-command.js';
import { createScenarioLoader } from './scenario-loader.js';

const publicRoot = join(import.meta.dirname, '..', '..', 'public');
const torreviejaScenarioIds = [
  'torrevieja-legacy-all-v1',
  'torrevieja-legacy-abc-v1',
  'torrevieja-legacy-east-v1',
  'torrevieja-legacy-north-v1',
  'torrevieja-legacy-south-v1',
] as const;

async function loadCanonicalScenario(
  scenarioId: string,
): Promise<CanonicalScenario> {
  const catalog = JSON.parse(
    await readFile(join(publicRoot, 'scenarios', 'catalog.json'), 'utf8'),
  ) as { scenarios: Array<{ scenarioId: string; manifestPath: string }> };
  const descriptor = catalog.scenarios.find(
    (candidate) => candidate.scenarioId === scenarioId,
  );
  if (!descriptor) throw new Error(`Unknown public scenario ${scenarioId}.`);
  const root = join(publicRoot, 'scenarios', descriptor.manifestPath, '..');
  const json = async (name: string) =>
    JSON.parse(await readFile(join(root, name), 'utf8')) as unknown;
  return parseScenarioPackage({
    manifest: await json('scenario.json'),
    settlements: await json('settlements.json'),
    stops: await json('stops.json'),
    routes: await json('routes.json'),
    presentation: await json('presentation.json'),
    provenance: await json('provenance.json'),
  });
}

describe('public multi-scenario catalogue', () => {
  it('uses grouped city manifest paths and leaves no flat scenario packages', async () => {
    const scenarioRoot = join(publicRoot, 'scenarios');
    const catalog = JSON.parse(
      await readFile(join(scenarioRoot, 'catalog.json'), 'utf8'),
    ) as { scenarios: Array<{ scenarioId: string; manifestPath: string }> };
    expect(catalog.scenarios).toHaveLength(76);
    expect(
      new Set(catalog.scenarios.map(({ scenarioId }) => scenarioId)).size,
    ).toBe(76);
    for (const descriptor of catalog.scenarios) {
      expect(descriptor.manifestPath.split('/')).toHaveLength(3);
      expect(descriptor.manifestPath).toMatch(
        /^[a-z_]+-v1\/[a-z0-9-]+-v1\/scenario\.json$/,
      );
      await expect(
        readFile(join(scenarioRoot, descriptor.manifestPath), 'utf8'),
      ).resolves.toContain(descriptor.scenarioId);
    }
    await expect(
      readFile(
        join(
          scenarioRoot,
          'torrevieja-v1',
          'torrevieja-mini-v1',
          'scenario.json',
        ),
        'utf8',
      ),
    ).resolves.toContain('torrevieja-mini-v1');
    expect(
      catalog.scenarios.some(
        ({ scenarioId }) => scenarioId === 'torrevieja-mini-v1',
      ),
    ).toBe(false);
    const rootEntries = await readdir(scenarioRoot, { withFileTypes: true });
    expect(
      rootEntries
        .filter((entry) => entry.isFile())
        .map(({ name }) => name)
        .sort(),
    ).toEqual(['catalog.json']);
    expect(
      rootEntries
        .filter((entry) => entry.isDirectory())
        .map(({ name }) => name)
        .sort(),
    ).toEqual([
      'alicante-v1',
      'benidorm-v1',
      'cartagena-v1',
      'elche-v1',
      'malaga-v1',
      'murcia-v1',
      'torrevieja-v1',
    ]);
    const auditSource = await readFile(
      join(publicRoot, '..', '..', '..', 'scripts', 'foundation-audit.mjs'),
      'utf8',
    );
    expect(auditSource).not.toContain(
      'apps/web/public/population-fields/catalog.json',
    );
  });
  it.each(['/', '/vite-tt-foundation/'])(
    'loads and verifies every catalogue package under base %s',
    async (baseUrl) => {
      const loader = createScenarioLoader({
        baseUrl,
        fetchText: async (url) => {
          const relative = url.slice(baseUrl.length);
          try {
            const text = await readFile(join(publicRoot, relative), 'utf8');
            return { ok: true, text: async () => text };
          } catch {
            return { ok: false, text: async () => '' };
          }
        },
        digestSha256: async (text) =>
          createHash('sha256').update(text).digest('hex'),
      });
      await loader.loadCatalog();
      expect(
        loader.projection
          .getState()
          .catalog?.scenarios.map((item) => item.scenarioId),
      ).toEqual([
        'torrevieja-legacy-abc-v1',
        'torrevieja-legacy-east-v1',
        'torrevieja-legacy-south-v1',
        'torrevieja-legacy-north-v1',
        'torrevieja-legacy-all-v1',
        'elche-urban-abc-v1',
        'elche-legacy-east-v1',
        'elche-legacy-hospital-general-v1',
        'elche-legacy-vinalopo-v1',
        'elche-legacy-crosscity-v1',
        'elche-legacy-night-v1',
        'elche-legacy-all-v1',
        'elche-radial-inner-v1',
        'elche-radial-west-v1',
        'elche-radial-south-v1',
        'elche-radial-airport-v1',
        'elche-radial-coast-v1',
        'elche-radial-legacy-all-v1',
        'alicante-legacy-core-v1',
        'alicante-legacy-west-v1',
        'alicante-legacy-north-v1',
        'alicante-legacy-coast-v1',
        'alicante-legacy-periphery-v1',
        'alicante-legacy-circular-v1',
        'alicante-legacy-all-v1',
        'benidorm-legacy-core-v1',
        'benidorm-legacy-core-inland-v1',
        'benidorm-legacy-local-special-v1',
        'benidorm-legacy-attractions-v1',
        'benidorm-legacy-all-v1',
        'benidorm-radial-core-west-v1',
        'benidorm-radial-east-corridor-v1',
        'benidorm-radial-coast-crosscity-v1',
        'benidorm-radial-finestrat-v1',
        'benidorm-radial-north-v1',
        'benidorm-radial-panoramic-v1',
        'benidorm-radial-legacy-all-v1',
        'cartagena-legacy-icue-v1',
        'cartagena-legacy-core-v1',
        'cartagena-legacy-west-v1',
        'cartagena-legacy-southwest-v1',
        'cartagena-legacy-north-east-v1',
        'cartagena-legacy-periphery-v1',
        'cartagena-legacy-all-v1',
        'cartagena-radial-coast-v1',
        'cartagena-radial-manga-v1',
        'cartagena-radial-mainland-v1',
        'cartagena-radial-legacy-all-v1',
        'murcia-circular-24-v1',
        'murcia-circular-13-v1',
        'murcia-central-rail-v1',
        'murcia-rayo-south-v1',
        'murcia-rayo-north-v1',
        'murcia-circular-legacy-all-v1',
        'murcia-rayo-legacy-all-v1',
        'malaga-lines-3-11-n1-v1',
        'malaga-lines-22-27-31-v1',
        'malaga-lines-8-21-23-v1',
        'malaga-lines-14-n4-c5-v1',
        'malaga-lines-7-15-n2-v1',
        'malaga-lines-1-37-c2-v1',
        'malaga-lines-17-18-v1',
        'malaga-lines-2-20-30-v1',
        'malaga-lines-4-19-n3-v1',
        'malaga-lines-25-28-e-v1',
        'malaga-lines-38-c6-v1',
        'malaga-lines-36-c1-v1',
        'malaga-lines-33-34-35-v1',
        'malaga-lines-5-9-10-v1',
        'malaga-lines-29-a-v1',
        'malaga-lines-32-c3-v1',
        'malaga-lines-40-c8-v1',
        'malaga-day-legacy-all-v1',
        'malaga-circular-legacy-all-v1',
        'malaga-night-legacy-all-v1',
        'malaga-express-legacy-all-v1',
      ]);
      for (const descriptor of loader.projection.getState().catalog!
        .scenarios) {
        await loader.loadScenario(descriptor.scenarioId);
        expect(loader.projection.getState()).toMatchObject({
          status: 'ready',
          selectedScenarioId: descriptor.scenarioId,
        });
      }
    },
    30_000,
  );

  it('accepts absent optional assets and normalizes non-Error catalogue failure', async () => {
    const baseUrl = '/';
    const create = (failCatalogue: boolean) =>
      createScenarioLoader({
        baseUrl,
        fetchText: async (url) => {
          if (failCatalogue) throw 'catalogue failed';
          if (
            url.endsWith('/presentation.json') ||
            url.endsWith('/provenance.json')
          )
            return { ok: false, text: async () => '' };
          const text = await readFile(join(publicRoot, url.slice(1)), 'utf8');
          return { ok: true, text: async () => text };
        },
        digestSha256: async (text) =>
          createHash('sha256').update(text).digest('hex'),
      });
    const optional = create(false);
    await optional.loadCatalog();
    await optional.loadScenario('torrevieja-legacy-abc-v1');
    expect(optional.projection.getState()).toMatchObject({ status: 'ready' });
    const failing = create(true);
    await failing.loadCatalog();
    expect(failing.projection.getState()).toEqual({
      status: 'failed',
      message: 'Scenario loading failed.',
    });
  });

  it('creates, starts, and advances a production vehicle on every public route', async () => {
    const catalog = JSON.parse(
      await readFile(join(publicRoot, 'scenarios', 'catalog.json'), 'utf8'),
    ) as { scenarios: readonly { scenarioId: string }[] };
    let routeCount = 0;
    for (const descriptor of catalog.scenarios) {
      const canonical = await loadCanonicalScenario(descriptor.scenarioId);
      const coordinate = createScenarioCoordinate(canonical);
      for (const route of canonical.routes.routes) {
        routeCount += 1;
        const create = createDemoVehicleCommandForAuthority(
          coordinate,
          () => canonical,
          [],
          route.routeId,
        );
        let authority = applyTransportVehicleCommand(
          createTransportSimulationState(canonical, 0),
          create,
        );
        authority = applyTransportVehicleCommand(authority, {
          kind: 'transport.vehicle.start',
          vehicleId: create.vehicleId,
        });
        authority = advanceTransportTicks(authority, parseTickAdvancement(1));
        expect(authority.tick).toBe(1);
        expect(authority.fleet).toHaveLength(1);
        expect(authority.fleet[0]).toMatchObject({
          vehicleId: create.vehicleId,
          routeId: route.routeId,
        });
        expect(authority.fleet[0]!.movement.kind).not.toBe('parked-at-stop');
      }
    }
    expect(routeCount).toBeGreaterThan(0);
  }, 60_000);

  it('accepts the physical Torrevieja StopPlace projection consistently', async () => {
    const scenarios = await Promise.all(
      torreviejaScenarioIds.map(loadCanonicalScenario),
    );
    const nodeMappings = new Map<string, string>();
    const placeIdentities = new Map<
      string,
      Readonly<{ name: string; latitude: number; longitude: number }>
    >();

    for (const canonical of scenarios) {
      const routedNodeIds = new Set(
        canonical.routes.routes.flatMap((route) =>
          route.patterns.flatMap((pattern) => pattern.stopNodeIds),
        ),
      );
      const nodes = new Map(
        canonical.stops.stopNodes.map((node) => [node.stopNodeId, node]),
      );
      const places = new Map(
        canonical.stops.stopPlaces.map((place) => [place.stopPlaceId, place]),
      );
      const routedPlaceIds = new Set<string>();

      for (const stopNodeId of routedNodeIds) {
        const node = nodes.get(stopNodeId)!;
        expect(node.stopPlaceId).not.toBeNull();
        const stopPlaceId = node.stopPlaceId!;
        const place = places.get(stopPlaceId);
        expect(place).toBeDefined();
        expect(place?.position).toBeDefined();
        if (!place?.position) throw new Error('Expected positioned StopPlace.');
        expect(Number.isFinite(place.position.latitude)).toBe(true);
        expect(Number.isFinite(place.position.longitude)).toBe(true);
        expect(
          canonical.settlements.settlements.some(
            ({ settlementId }) => settlementId === place.settlementId,
          ),
        ).toBe(true);
        routedPlaceIds.add(stopPlaceId);

        const previousMapping = nodeMappings.get(stopNodeId);
        if (previousMapping === undefined)
          nodeMappings.set(stopNodeId, stopPlaceId);
        else expect(stopPlaceId).toBe(previousMapping);

        const identity = {
          name: place.name,
          latitude: place.position.latitude,
          longitude: place.position.longitude,
        };
        const previousIdentity = placeIdentities.get(stopPlaceId);
        if (previousIdentity === undefined)
          placeIdentities.set(stopPlaceId, identity);
        else expect(identity).toEqual(previousIdentity);
      }

      expect([...places.keys()].sort()).toEqual([...routedPlaceIds].sort());
    }

    const master = scenarios[0]!;
    const masterRoutedNodes = new Set(
      master.routes.routes.flatMap((route) =>
        route.patterns.flatMap((pattern) => pattern.stopNodeIds),
      ),
    );
    const masterNodes = new Map(
      master.stops.stopNodes.map((node) => [node.stopNodeId, node]),
    );
    const routedPlaceCounts = new Map<string, number>();
    for (const stopNodeId of masterRoutedNodes) {
      const stopPlaceId = masterNodes.get(stopNodeId)!.stopPlaceId!;
      routedPlaceCounts.set(
        stopPlaceId,
        (routedPlaceCounts.get(stopPlaceId) ?? 0) + 1,
      );
    }

    expect(master.manifest.contentHash).toBe(
      'b6891aeb3bff38dcc037d21314f3d623fba83e86150dbd5a6564e7aaf8310c3f',
    );
    expect(master.stops.stopNodes).toHaveLength(161);
    expect(masterRoutedNodes.size).toBe(161);
    expect(master.stops.stopPlaces).toHaveLength(134);
    expect(
      [...routedPlaceCounts.values()].filter((count) => count === 1),
    ).toHaveLength(107);
    expect(
      161 -
        [...routedPlaceCounts.values()].reduce(
          (count, occurrences) => count + Math.min(occurrences, 1),
          0,
        ),
    ).toBe(27);
    expect(
      master.stops.stopNodes.find(
        ({ stopNodeId }) => stopNodeId === 'tv-stop-0207',
      )!.stopPlaceId,
    ).toBe('tv-place-0207');
    expect(
      master.stops.stopNodes.find(
        ({ stopNodeId }) => stopNodeId === 'tv-stop-0209',
      )!.stopPlaceId,
    ).toBe('tv-place-0207');
    expect(
      buildDirectedScenarioGraph(master).edges.some(
        ({ fromStopNodeId, toStopNodeId }) =>
          fromStopNodeId === 'tv-stop-0207' && toStopNodeId === 'tv-stop-0209',
      ),
    ).toBe(false);

    const elche = await loadCanonicalScenario('elche-urban-abc-v1');
    expect(elche.stops.stopPlaces).toHaveLength(75);
    expect(
      elche.stops.stopNodes.every(({ stopPlaceId }) => stopPlaceId !== null),
    ).toBe(true);
  });
});
