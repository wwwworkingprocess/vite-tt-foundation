import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ScenarioDomainError,
  assertScenarioDescriptorMatchesManifest,
  buildDirectedScenarioGraph,
  parseScenarioCatalog,
  parseScenarioManifest,
  parseScenarioPackage,
} from './index.js';

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, '..', 'fixtures', 'torrevieja-mini-v1', name),
      'utf8',
    ),
  ) as unknown;
const mini = () => ({
  manifest: fixture('scenario.json'),
  settlements: fixture('settlements.json'),
  stops: fixture('stops.json'),
  routes: fixture('routes.json'),
  presentation: fixture('presentation.json'),
  provenance: fixture('provenance.json'),
});
type MutableSettlement = {
  center: { latitude: number; longitude: number };
  bounds: { south: number; west: number; north: number; east: number };
  settlementId: string;
};

describe('scenario parsing and directed graph', () => {
  it.each(['development-seed', 'playable', 'test-fixture'])(
    'accepts shared scenario status %s',
    (status) => {
      const manifest = fixture('scenario.json') as { status: string };
      manifest.status = status;
      expect(parseScenarioManifest(manifest).status).toBe(status);
    },
  );

  it('rejects unsupported status in catalogue, manifest, and direct package parsing', () => {
    const manifest = fixture('scenario.json') as { status: string };
    manifest.status = 'unsupported';
    expect(() => parseScenarioManifest(manifest)).toThrow(/malformed-manifest/);
    expect(() => parseScenarioPackage({ ...mini(), manifest })).toThrow(
      /malformed-manifest/,
    );
    const descriptor = {
      scenarioId: 'x',
      scenarioVersion: '1.0.0',
      title: 'X',
      primarySettlementId: 's',
      settlementIds: ['s'],
      manifestPath: 'x/scenario.json',
      status: 'unsupported',
      contentHash: 'a'.repeat(64),
    };
    expect(() =>
      parseScenarioCatalog({
        schemaVersion: '1.0.0',
        catalogId: 'x',
        scenarios: [descriptor],
      }),
    ).toThrow(/malformed-catalogue/);
  });
  it.each(['1.0.0', '1.0.1', '2.3.4'])(
    'accepts scenario data version %s independently',
    (scenarioVersion) => {
      const manifest = fixture('scenario.json') as { scenarioVersion: string };
      manifest.scenarioVersion = scenarioVersion;
      expect(parseScenarioManifest(manifest).scenarioVersion).toBe(
        scenarioVersion,
      );
    },
  );

  it.each(['1', '1.0', 'v1.0.0', '1.0.0-beta', '01.0.0'])(
    'rejects malformed scenario data version %s',
    (scenarioVersion) => {
      const manifest = fixture('scenario.json') as { scenarioVersion: string };
      manifest.scenarioVersion = scenarioVersion;
      expect(() => parseScenarioManifest(manifest)).toThrow(
        /malformed-manifest/,
      );
    },
  );

  it.each([
    'scenarioId',
    'scenarioVersion',
    'status',
    'title',
    'primarySettlementId',
    'settlementIds',
    'contentHash',
  ] as const)('rejects catalogue/manifest mismatch for %s', (field) => {
    const manifest = parseScenarioManifest(fixture('scenario.json'));
    const descriptor = {
      scenarioId: manifest.scenarioId,
      scenarioVersion: manifest.scenarioVersion,
      status: 'test-fixture' as const,
      title: manifest.title,
      primarySettlementId: manifest.primarySettlementId,
      settlementIds: [...manifest.settlementIds],
      manifestPath: 'mini/scenario.json',
      contentHash: manifest.contentHash,
      [field]: field === 'settlementIds' ? ['other'] : 'different',
    };
    expect(() =>
      assertScenarioDescriptorMatchesManifest(descriptor, manifest),
    ).toThrow(/content-integrity-mismatch|unresolved-reference/);
  });

  it('matches the normative mini graph oracle exactly and deterministically', () => {
    const scenario = parseScenarioPackage(mini());
    const graph = buildDirectedScenarioGraph(scenario);
    const oracle = fixture('expected-graph.json') as {
      nodeIds: string[];
      edges: unknown[];
      counts: unknown;
    };
    expect(graph.nodes.map(({ stopNodeId }) => stopNodeId)).toEqual(
      oracle.nodeIds,
    );
    expect(graph.edges).toEqual(oracle.edges);
    expect(graph.summary).toEqual({ ...oracle.counts, routes: 1, patterns: 2 });
    const repeated = buildDirectedScenarioGraph(
      parseScenarioPackage(JSON.parse(JSON.stringify(mini()))),
    );
    expect({
      nodes: repeated.nodes,
      edges: repeated.edges,
      summary: repeated.summary,
    }).toEqual({
      nodes: graph.nodes,
      edges: graph.edges,
      summary: graph.summary,
    });
    expect(graph.incomingEdges('tv-stop-0093')).toHaveLength(1);
    expect(graph.outgoingEdges('tv-stop-0093')).toHaveLength(1);
    expect(graph.patternEdges('legacy-A2-torrevieja-la-mata')).toHaveLength(4);
    expect(graph.route('legacy-A2')?.publicCode).toBe('A2');
    expect(graph.route('missing')).toBeUndefined();
    expect(graph.pattern('legacy-A2-la-mata-torrevieja')?.directionLabel).toBe(
      'La Mata - Torrevieja',
    );
    expect(graph.pattern('missing')).toBeUndefined();
    expect(
      graph.edges.some(
        (edge) =>
          edge.fromStopNodeId === 'tv-stop-0093' &&
          edge.toStopNodeId === 'tv-stop-0067',
      ),
    ).toBe(false);
    expect(
      graph.edges.some(
        (edge) =>
          edge.fromStopNodeId === 'tv-stop-0066' &&
          edge.toStopNodeId === 'tv-stop-0093',
      ),
    ).toBe(false);
    expect(Object.isFrozen(graph.nodes[0])).toBe(true);
    expect(Object.isFrozen(graph.edges)).toBe(true);
  });

  it('adds only an explicit loop edge and preserves parallel edges', () => {
    const input = mini();
    const routes = input.routes as {
      routes: Array<{
        patterns: Array<{
          closesLoop: boolean;
          stopNodeIds: string[];
          patternId: string;
          directionLabel: string;
        }>;
      }>;
    };
    routes.routes[0]!.patterns[0]!.closesLoop = true;
    routes.routes[0]!.patterns.push({
      patternId: 'parallel',
      directionLabel: 'Parallel fixture',
      closesLoop: false,
      stopNodeIds: ['tv-stop-0108', 'tv-stop-0053'],
    });
    const graph = buildDirectedScenarioGraph(parseScenarioPackage(input));
    expect(graph.edges.at(4)).toMatchObject({
      fromStopNodeId: 'tv-stop-0093',
      toStopNodeId: 'tv-stop-0108',
    });
    expect(
      graph.edges.filter(
        (edge) =>
          edge.fromStopNodeId === 'tv-stop-0108' &&
          edge.toStopNodeId === 'tv-stop-0053',
      ),
    ).toHaveLength(2);
  });

  it('rejects unsafe manifests and unsupported versions with typed errors', () => {
    const manifest = fixture('scenario.json') as {
      schemaVersion: string;
      assets: { stops: { path: string } };
    };
    manifest.assets.stops.path = '../stops.json';
    expect(() => parseScenarioManifest(manifest)).toThrowError(
      ScenarioDomainError,
    );
    manifest.assets.stops.path = 'stops.json';
    manifest.schemaVersion = '2.0.0';
    expect(() => parseScenarioManifest(manifest)).toThrow(
      /unsupported-schema-version/,
    );
    expect(() =>
      parseScenarioCatalog({
        schemaVersion: '1.0.0',
        catalogId: 'x',
        scenarios: [],
      }),
    ).not.toThrow();
  });

  it.each([
    '/absolute.json',
    '../parent.json',
    'https://example.test/a.json',
    '..\\parent.json',
    'folder//asset.json',
  ])('reports typed unsafe manifest asset path %s', (path) => {
    const manifest = fixture('scenario.json') as {
      assets: { presentation: { path: string } };
    };
    manifest.assets.presentation.path = path;
    try {
      parseScenarioManifest(manifest);
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ScenarioDomainError);
      expect((error as ScenarioDomainError).code).toBe('unsafe-asset-path');
    }
  });

  it('reports a typed unsafe catalogue manifest path', () => {
    const catalog = {
      schemaVersion: '1.0.0',
      catalogId: 'x',
      scenarios: [
        {
          scenarioId: 'x',
          scenarioVersion: '1.0.0',
          title: 'X',
          primarySettlementId: 's',
          settlementIds: ['s'],
          manifestPath: '../scenario.json',
          status: 'test-fixture',
          contentHash: 'a'.repeat(64),
        },
      ],
    };
    try {
      parseScenarioCatalog(catalog);
      throw new Error('expected failure');
    } catch (error) {
      expect((error as ScenarioDomainError).code).toBe('unsafe-asset-path');
    }
  });

  it.each([
    [
      'center latitude',
      (s: MutableSettlement) => {
        s.center.latitude = 91;
      },
    ],
    [
      'center longitude',
      (s: MutableSettlement) => {
        s.center.longitude = 181;
      },
    ],
    [
      'south latitude',
      (s: MutableSettlement) => {
        s.bounds.south = -91;
      },
    ],
    [
      'north latitude',
      (s: MutableSettlement) => {
        s.bounds.north = 91;
      },
    ],
    [
      'west longitude',
      (s: MutableSettlement) => {
        s.bounds.west = -181;
      },
    ],
    [
      'east longitude',
      (s: MutableSettlement) => {
        s.bounds.east = 181;
      },
    ],
    [
      'latitude ordering',
      (s: MutableSettlement) => {
        s.bounds.south = s.bounds.north + 1;
      },
    ],
    [
      'longitude ordering',
      (s: MutableSettlement) => {
        s.bounds.west = s.bounds.east + 1;
      },
    ],
    [
      'center outside',
      (s: MutableSettlement) => {
        s.center.latitude = s.bounds.north + 0.01;
      },
    ],
  ])('rejects settlement geography: %s', (_name, mutate) => {
    const input = mini();
    const file = input.settlements as { settlements: MutableSettlement[] };
    mutate(file.settlements[0]!);
    expect(() => parseScenarioPackage(input)).toThrow(/invalid-coordinate/);
  });

  it('requires exact ordered manifest settlement identity without hidden extras', () => {
    const input = mini();
    const file = input.settlements as { settlements: MutableSettlement[] };
    file.settlements.push({ ...file.settlements[0], settlementId: 'extra' });
    expect(() => parseScenarioPackage(input)).toThrow(/unresolved-reference/);
  });

  it.each([
    [
      'duplicate stop',
      (input: ReturnType<typeof mini>) => {
        const stops = input.stops as { stopNodes: unknown[] };
        stops.stopNodes.push(stops.stopNodes[0]);
      },
      'duplicate-identifier',
    ],
    [
      'missing stop',
      (input: ReturnType<typeof mini>) => {
        const routes = input.routes as {
          routes: Array<{ patterns: Array<{ stopNodeIds: string[] }> }>;
        };
        routes.routes[0]!.patterns[0]!.stopNodeIds[0] = 'missing';
      },
      'unresolved-reference',
    ],
    [
      'missing settlement',
      (input: ReturnType<typeof mini>) => {
        const stops = input.stops as {
          stopNodes: Array<{ settlementId: string }>;
        };
        stops.stopNodes[0]!.settlementId = 'missing';
      },
      'unresolved-reference',
    ],
    [
      'invalid latitude',
      (input: ReturnType<typeof mini>) => {
        const stops = input.stops as {
          stopNodes: Array<{ position: { latitude: number } }>;
        };
        stops.stopNodes[0]!.position.latitude = 91;
      },
      'invalid-coordinate',
    ],
    [
      'invalid longitude',
      (input: ReturnType<typeof mini>) => {
        const stops = input.stops as {
          stopNodes: Array<{ position: { longitude: number } }>;
        };
        stops.stopNodes[0]!.position.longitude = 181;
      },
      'invalid-coordinate',
    ],
    [
      'duplicate pattern',
      (input: ReturnType<typeof mini>) => {
        const routes = input.routes as {
          routes: Array<{ patterns: unknown[] }>;
        };
        routes.routes[0]!.patterns.push(routes.routes[0]!.patterns[0]);
      },
      'duplicate-identifier',
    ],
    [
      'scenario mismatch',
      (input: ReturnType<typeof mini>) => {
        const stops = input.stops as { scenarioId: string };
        stops.scenarioId = 'other';
      },
      'unresolved-reference',
    ],
  ])('rejects malformed package: %s', (_name, mutate, code) => {
    const input = mini();
    mutate(input);
    expect(() => parseScenarioPackage(input)).toThrow(new RegExp(code));
  });

  it('accepts absent optional metadata and rejects malformed optional metadata', () => {
    const input = mini();
    delete input.presentation;
    delete input.provenance;
    expect(parseScenarioPackage(input).presentation).toBeUndefined();
    expect(() =>
      parseScenarioPackage({
        ...mini(),
        presentation: { schemaVersion: '1.0.0', scenarioId: 3 },
      }),
    ).toThrow(/malformed-asset/);
  });

  it('rejects a missing required manifest asset declaration', () => {
    const manifest = fixture('scenario.json') as {
      assets: Record<string, unknown>;
    };
    delete manifest.assets.routes;
    expect(() => parseScenarioManifest(manifest)).toThrow(
      /missing required asset routes/,
    );
  });

  it('validates catalogue uniqueness and primary settlement references', () => {
    const descriptor = {
      scenarioId: 'x',
      scenarioVersion: '1.0.0',
      title: 'X',
      primarySettlementId: 's',
      settlementIds: ['s'],
      manifestPath: 'x/scenario.json',
      status: 'test-fixture',
      contentHash: 'a'.repeat(64),
    };
    expect(() =>
      parseScenarioCatalog({
        schemaVersion: '1.0.0',
        catalogId: 'x',
        scenarios: [descriptor, descriptor],
      }),
    ).toThrow(/duplicate-identifier/);
    expect(() =>
      parseScenarioCatalog({
        schemaVersion: '1.0.0',
        catalogId: 'x',
        scenarios: [{ ...descriptor, settlementIds: ['other'] }],
      }),
    ).toThrow(/unresolved-reference/);
  });

  it('rejects unresolved stop places and repeated consecutive nodes', () => {
    const placeInput = mini();
    const stops = placeInput.stops as {
      stopNodes: Array<{ stopPlaceId: string | null }>;
    };
    stops.stopNodes[0]!.stopPlaceId = 'missing';
    expect(() => parseScenarioPackage(placeInput)).toThrow(
      /unresolved-reference/,
    );
    const repeated = mini();
    const routes = repeated.routes as {
      routes: Array<{ patterns: Array<{ stopNodeIds: string[] }> }>;
    };
    routes.routes[0]!.patterns[0]!.stopNodeIds[1] =
      routes.routes[0]!.patterns[0]!.stopNodeIds[0]!;
    expect(() => parseScenarioPackage(repeated)).toThrow(
      /graph-construction-invariant/,
    );
  });

  it('validates optional stop-place grouping and coordinates', () => {
    const input = mini();
    const stops = input.stops as {
      stopPlaces: unknown[];
      stopNodes: Array<{ stopPlaceId: string | null }>;
    };
    stops.stopPlaces.push({
      stopPlaceId: 'place-1',
      settlementId: 'es-torrevieja',
      name: 'Grouped stop',
      position: { latitude: 37.98, longitude: -0.68 },
    });
    stops.stopNodes[0]!.stopPlaceId = 'place-1';
    expect(parseScenarioPackage(input).stops.stopPlaces).toHaveLength(1);
  });
});
