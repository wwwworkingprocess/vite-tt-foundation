import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildDirectedScenarioGraph,
  parseScenarioPackage,
} from '@torrevieja-tycoon/transport-domain';
import {
  createScenarioCoordinate,
  parsePassengerDemandPlan,
  parseVehicleId,
} from '@torrevieja-tycoon/simulation';
import {
  parseClientId,
  parseCommandId,
  parseCommandRevision,
  parseCorrelationId,
  parseGameId,
  parseSessionId,
  parseTimelineId,
} from '@torrevieja-tycoon/protocol';
import {
  createDirectTransportSimulationClient,
  createStructuredCloneTransportSimulationClient,
  type TransportCommandEnvelope,
  type TransportSimulationClient,
} from './transport-client.js';
import {
  createWorkerTransportSimulationClient,
  startTransportWorkerRuntime,
  type TransportWorkerEvent,
  type TransportWorkerLike,
} from './worker-transport-client.js';

const fixtureRoot = join(
  import.meta.dirname,
  '..',
  '..',
  'public',
  'scenarios',
  'torrevieja-v1',
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
const onePatternClosedLoopScenario = () => {
  const routes = structuredClone(json('routes.json')) as {
    routes: Array<{
      routeId: string;
      patterns: Array<{
        patternId: string;
        closesLoop: boolean;
        stopNodeIds: string[];
      }>;
    }>;
  };
  const route = routes.routes[0]!;
  const pattern = route.patterns[0]!;
  route.routeId = 'closed-loop-route';
  pattern.patternId = 'closed-loop-route-pattern';
  pattern.closesLoop = true;
  pattern.stopNodeIds = ['tv-stop-0108', 'tv-stop-0053', 'tv-stop-0078'];
  route.patterns = [pattern];
  return parseScenarioPackage({
    manifest: json('scenario.json'),
    settlements: json('settlements.json'),
    stops: json('stops.json'),
    routes,
    presentation: json('presentation.json'),
    provenance: json('provenance.json'),
  });
};
const demandPlan = (canonical: ReturnType<typeof scenario>) =>
  parsePassengerDemandPlan({
    schemaVersion: '1.0.0',
    demandModelContentHash: 'd'.repeat(64),
    scenario: createScenarioCoordinate(canonical),
    grid: {
      cityId: 'Q36730',
      populationGridSchemaVersion: '1.0.0',
      gridVersion: '1.0.0',
      rows: 1,
      columns: 3,
      resolutionDegrees: 0.001,
      totalActiveCellCount: 3,
      totalPopulationWeight: 6,
    },
    catchmentPolicy: { maxAccessDistanceCells: 5 },
    emissionPolicy: {
      emissionCreditsPerWeightPerTick: 2,
      creditsPerPassenger: 3,
    },
    accessPolicy: { accessTicksPerCell: 2 },
    cells: [
      {
        cellId: 'r0c0',
        row: 0,
        column: 0,
        populationWeight: 1,
        assignedStopPlaceId: 'tv-place-0053',
        distanceSquaredCells: 0,
      },
      {
        cellId: 'r0c1',
        row: 0,
        column: 1,
        populationWeight: 3,
        assignedStopPlaceId: 'tv-place-0065',
        distanceSquaredCells: 1,
      },
      {
        cellId: 'r0c2',
        row: 0,
        column: 2,
        populationWeight: 2,
        assignedStopPlaceId: null,
        distanceSquaredCells: null,
      },
    ],
    stops: [{ stopPlaceId: 'tv-place-0065' }, { stopPlaceId: 'tv-place-0053' }],
  });

const dispersedDemandPlan = (canonical: ReturnType<typeof scenario>) => {
  const stopPlaceIds = [
    'tv-place-0053',
    'tv-place-0065',
    'tv-place-0067',
    'tv-place-0093',
  ];
  return parsePassengerDemandPlan({
    schemaVersion: '1.0.0',
    demandModelContentHash: 'a'.repeat(64),
    scenario: createScenarioCoordinate(canonical),
    grid: {
      cityId: 'Q36730',
      populationGridSchemaVersion: '1.0.0',
      gridVersion: '1.0.0',
      rows: 1,
      columns: 4,
      resolutionDegrees: 0.001,
      totalActiveCellCount: 4,
      totalPopulationWeight: 10,
    },
    catchmentPolicy: { maxAccessDistanceCells: 5 },
    emissionPolicy: {
      emissionCreditsPerWeightPerTick: 1,
      creditsPerPassenger: 1,
    },
    accessPolicy: { accessTicksPerCell: 1 },
    cells: stopPlaceIds.map((assignedStopPlaceId, column) => ({
      cellId: `r0c${column}`,
      row: 0,
      column,
      populationWeight: column + 1,
      assignedStopPlaceId,
      distanceSquaredCells: 0,
    })),
    stops: stopPlaceIds.map((stopPlaceId) => ({ stopPlaceId })),
  });
};

class LoopbackWorker implements TransportWorkerLike {
  private readonly clientListeners = new Map<
    string,
    Set<(event: TransportWorkerEvent) => void>
  >();
  private readonly runtimeListeners = new Set<
    (event: { data: unknown }) => void
  >();
  private readonly runtime = startTransportWorkerRuntime(
    {
      postMessage: (message) =>
        queueMicrotask(() =>
          this.emitClient('message', { data: structuredClone(message) }),
        ),
      addEventListener: (_type, listener) =>
        this.runtimeListeners.add(listener),
      removeEventListener: (_type, listener) =>
        this.runtimeListeners.delete(listener),
      reportError: (error) =>
        queueMicrotask(() =>
          this.emitClient('error', { data: undefined, error }),
        ),
    },
    createDirectTransportSimulationClient,
  );
  postMessage(message: unknown) {
    queueMicrotask(() => {
      for (const listener of [...this.runtimeListeners])
        listener({ data: structuredClone(message) });
    });
  }
  addEventListener(
    type: string,
    listener: (event: TransportWorkerEvent) => void,
  ) {
    const listeners = this.clientListeners.get(type) ?? new Set();
    listeners.add(listener);
    this.clientListeners.set(type, listeners);
  }
  removeEventListener(
    type: string,
    listener: (event: TransportWorkerEvent) => void,
  ) {
    this.clientListeners.get(type)?.delete(listener);
  }
  terminate() {
    void this.runtime.close();
  }
  private emitClient(type: string, event: TransportWorkerEvent) {
    for (const listener of [...(this.clientListeners.get(type) ?? [])])
      listener(event);
  }
}

const factories: ReadonlyArray<
  readonly [string, () => TransportSimulationClient]
> = [
  ['direct', createDirectTransportSimulationClient],
  ['clone', createStructuredCloneTransportSimulationClient],
  [
    'worker',
    () =>
      createWorkerTransportSimulationClient({
        workerFactory: () => new LoopbackWorker(),
      }),
  ],
];
const envelope = (
  sequence: number,
  command: TransportCommandEnvelope['command'],
): TransportCommandEnvelope => ({
  kind: 'foundation-command',
  gameId: parseGameId('game'),
  timelineId: parseTimelineId('timeline'),
  commandId: parseCommandId(`vehicle-command-${sequence}`),
  correlationId: parseCorrelationId(`vehicle-command-${sequence}`),
  clientId: parseClientId('test-client'),
  sessionId: parseSessionId('test-session'),
  command,
});
const envelopeWithId = (
  id: string,
  command: TransportCommandEnvelope['command'],
): TransportCommandEnvelope => ({
  ...envelope(999, command),
  commandId: parseCommandId(id),
  correlationId: parseCorrelationId(id),
});

describe.each(factories)(
  '%s vehicle client contract',
  (_name, createClient) => {
    it('creates, starts, advances, publishes, exports, and freezes one fleet', async () => {
      const client = createClient();
      const canonical = scenario();
      const patternId = canonical.routes.routes[0]!.patterns[0]!.patternId;
      const updates: unknown[] = [];
      client.subscribeReliableUpdates((update) => updates.push(update));
      await client.connect({
        kind: 'transport-client-connect',
        contractVersion: 4,
        mode: 'new',
        gameId: parseGameId('game'),
        timelineId: parseTimelineId('timeline'),
        initialSimulationTick: 0,
        scenario: canonical,
      });
      await client.sendCommand(
        envelope(1, {
          kind: 'transport.vehicle.create',
          vehicleId: parseVehicleId('vehicle-demo-1'),
          label: 'Demo vehicle',
          passengerCapacity: 3,
          patternId,
          movementPlan: {
            kind: 'vehicle-movement-plan-v1',
            edgeTravelTicks: [3, 4, 5, 6],
          },
        }),
      );
      await client.sendCommand(
        envelope(2, {
          kind: 'transport.vehicle.start',
          vehicleId: parseVehicleId('vehicle-demo-1'),
        }),
      );
      await client.sendCommand(
        envelope(3, { type: 'foundation.advance-ticks', count: 5 }),
      );
      const exported = await client.exportSnapshot();
      expect(exported.snapshot.schemaVersion).toBe(9);
      expect(exported.snapshot.state.passengerDemand).toEqual({
        status: 'disabled',
      });
      expect(exported.snapshot.state.fleet[0]?.movement).toMatchObject({
        kind: 'running-on-edge',
        edgeSequence: 1,
        progressTicks: 2,
        travelTicks: 4,
      });
      expect(exported.snapshot.state.vehicleOperations).toEqual([
        expect.objectContaining({
          vehicleId: 'vehicle-demo-1',
          patternRunSequence: 1,
          patternRunStartedAtTick: 0,
          movementStartedAtTick: 0,
          stopCallSequence: 2,
        }),
      ]);
      expect(exported.snapshot.state.currentStopCalls).toEqual([]);
      expect(exported.snapshot.state.currentAlightingEvents).toEqual([]);
      expect(exported.snapshot.state.currentBoardingEvents).toEqual([]);
      expect(exported.snapshot.state.currentJourneyCompletionEvents).toEqual(
        [],
      );
      expect(exported.snapshot.state.vehicleCapacities).toEqual([
        { vehicleId: 'vehicle-demo-1', passengerCapacity: 3 },
      ]);
      expect(updates).toHaveLength(3);
      expect(updates[0]).toMatchObject({
        vehicleOperations: [{ stopCallSequence: 1 }],
        currentStopCalls: [{ occurrenceIndex: 0, stopCallSequence: 1 }],
        vehiclePassengerLoads: [
          {
            vehicleId: 'vehicle-demo-1',
            passengerCapacity: 3,
            onboardPassengerCount: 0,
            remainingPassengerCapacity: 3,
            currentAlightedPassengerCount: 0,
            currentBoardedPassengerCount: 0,
          },
        ],
        currentAlightingEvents: [],
        currentBoardingEvents: [],
        currentJourneyCompletionEvents: [],
      });
      expect(updates[2]).toMatchObject({
        vehicleOperations: [{ stopCallSequence: 2 }],
        currentStopCalls: [],
      });
      expect(Object.isFrozen(exported.snapshot.state.fleet)).toBe(true);
      expect(Object.isFrozen(updates[2])).toBe(true);
      await client.close();
    });

    it('advances identical fixed-point passenger authority and projections', async () => {
      const client = createClient();
      const canonical = scenario();
      const reliable: unknown[] = [];
      const render: unknown[] = [];
      client.subscribeReliableUpdates((update) => reliable.push(update));
      client.subscribeRenderSnapshots((snapshot) => render.push(snapshot));
      await client.connect({
        kind: 'transport-client-connect',
        contractVersion: 4,
        mode: 'new',
        gameId: parseGameId('game'),
        timelineId: parseTimelineId('timeline'),
        initialSimulationTick: 0,
        scenario: canonical,
        passengerDemandPlan: demandPlan(canonical),
      });
      await client.sendCommand(
        envelope(90, { type: 'foundation.advance-ticks', count: 3 }),
      );
      const exported = await client.exportSnapshot();
      expect(exported.snapshot.state.passengerDemand).toMatchObject({
        status: 'active',
        processedThroughTick: 3,
        totalEmittedPassengerCount: 12,
        servedEmittedPassengerCount: 8,
        unservedAtSourcePassengerCount: 4,
      });
      expect(reliable.at(-1)).toMatchObject({
        passengerDemand: {
          status: 'active',
          totalEmittedPassengerCount: 12,
          unservedAtSourcePassengerCount: 4,
        },
        passengerOriginStopArrivalEvents: [
          {
            tick: 2,
            stopPlaceId: 'tv-place-0053',
            arrivedPassengerCount: 1,
          },
          {
            tick: 3,
            stopPlaceId: 'tv-place-0053',
            arrivedPassengerCount: 1,
          },
          {
            tick: 3,
            stopPlaceId: 'tv-place-0065',
            arrivedPassengerCount: 2,
          },
        ],
      });
      expect(render.at(-1)).toMatchObject({
        passengerOriginStopArrivalEvents: (
          reliable.at(-1) as {
            passengerOriginStopArrivalEvents: unknown;
          }
        ).passengerOriginStopArrivalEvents,
      });
      const synchronized = await client.synchronize({
        kind: 'foundation-synchronization-request',
        gameId: parseGameId('game'),
        timelineId: parseTimelineId('timeline'),
      });
      expect(synchronized).toMatchObject({
        passengerOriginStopArrivalEvents: [],
      });
      expect(Object.isFrozen(exported.snapshot.state.passengerDemand)).toBe(
        true,
      );
      await client.close();
    });

    it('preserves V3 repeating RouteId assignment through publications and export', async () => {
      const client = createClient();
      const canonical = scenario();
      const graph = buildDirectedScenarioGraph(canonical);
      const route = canonical.routes.routes[0]!;
      await client.connect({
        kind: 'transport-client-connect',
        contractVersion: 4,
        mode: 'new',
        gameId: parseGameId('game'),
        timelineId: parseTimelineId('timeline'),
        initialSimulationTick: 0,
        scenario: canonical,
      });
      await client.sendCommand(
        envelope(101, {
          kind: 'transport.vehicle.create-route-cycle',
          vehicleId: parseVehicleId('route-vehicle'),
          label: 'Route vehicle',
          routeId: route.routeId,
          legs: route.patterns.map((pattern) => ({
            patternId: pattern.patternId,
            movementPlan: {
              kind: 'vehicle-movement-plan-v1',
              edgeTravelTicks: graph
                .patternEdges(pattern.patternId)
                .map(() => 1),
            },
          })),
        }),
      );
      await client.sendCommand(
        envelope(102, {
          kind: 'transport.vehicle.start',
          vehicleId: parseVehicleId('route-vehicle'),
        }),
      );
      await client.sendCommand(
        envelope(103, { type: 'foundation.advance-ticks', count: 5 }),
      );
      const vehicle = (await client.exportSnapshot()).snapshot.state.fleet[0];
      expect(vehicle).toMatchObject({
        routeId: route.routeId,
        routeLegIndex: 1,
        patternId: route.patterns[1]!.patternId,
        completedRouteCycles: 0,
        movement: { kind: 'running-at-stop' },
      });
      expect(Object.isFrozen(vehicle?.routeLegs)).toBe(true);
      await client.close();
    });

    it('serializes concurrent vehicle commands without losing fleet entries', async () => {
      const client = createClient();
      const canonical = scenario();
      const patternId = canonical.routes.routes[0]!.patterns[0]!.patternId;
      await client.connect({
        kind: 'transport-client-connect',
        contractVersion: 4,
        mode: 'new',
        gameId: parseGameId('game'),
        timelineId: parseTimelineId('timeline'),
        initialSimulationTick: 0,
        scenario: canonical,
      });
      await Promise.all(
        ['vehicle-a', 'vehicle-b'].map((id, index) =>
          client.sendCommand(
            envelope(index + 10, {
              kind: 'transport.vehicle.create',
              vehicleId: parseVehicleId(id),
              label: id,
              patternId,
              movementPlan: {
                kind: 'vehicle-movement-plan-v1',
                edgeTravelTicks: [1, 2, 3, 4],
              },
            }),
          ),
        ),
      );
      expect(
        (await client.exportSnapshot()).snapshot.state.fleet.map(
          ({ vehicleId }) => vehicleId,
        ),
      ).toEqual(['vehicle-a', 'vehicle-b']);
      await client.close();
    });

    it('preserves one canonical stable intent across every command family', async () => {
      const client = createClient();
      const canonical = scenario();
      const patternId = canonical.routes.routes[0]!.patterns[0]!.patternId;
      const publications: unknown[] = [];
      client.subscribeReliableUpdates((value) => publications.push(value));
      await client.connect({
        kind: 'transport-client-connect',
        contractVersion: 4,
        mode: 'new',
        gameId: parseGameId('game'),
        timelineId: parseTimelineId('timeline'),
        initialSimulationTick: 0,
        scenario: canonical,
      });
      const zero = envelopeWithId('shared-foundation', {
        type: 'foundation.advance-ticks',
        count: 0,
      });
      expect(await client.sendCommand(zero)).toMatchObject({
        status: 'applied',
      });
      expect(
        await client.sendCommand(
          envelopeWithId('shared-foundation', {
            kind: 'transport.vehicle.create',
            vehicleId: parseVehicleId('blocked'),
            label: 'Blocked',
            patternId,
            movementPlan: {
              kind: 'vehicle-movement-plan-v1',
              edgeTravelTicks: [1, 1, 1, 1],
            },
          }),
        ),
      ).toMatchObject({ code: 'command-id-conflict' });

      const create = envelopeWithId('shared-vehicle', {
        kind: 'transport.vehicle.create',
        vehicleId: parseVehicleId('stable'),
        label: '  Stable vehicle  ',
        patternId,
        movementPlan: {
          kind: 'vehicle-movement-plan-v1',
          edgeTravelTicks: [1, 2, 3, 4],
        },
      });
      expect(await client.sendCommand(create)).toMatchObject({
        status: 'applied',
        duplicate: false,
      });
      expect(
        await client.sendCommand({
          ...create,
          command: {
            movementPlan: {
              edgeTravelTicks: [1, 2, 3, 4],
              kind: 'vehicle-movement-plan-v1',
            },
            patternId,
            label: 'Stable vehicle',
            vehicleId: parseVehicleId('stable'),
            kind: 'transport.vehicle.create',
          },
        }),
      ).toMatchObject({ status: 'applied', duplicate: true });
      expect(
        await client.sendCommand(
          envelopeWithId('duplicate-vehicle-id', {
            kind: 'transport.vehicle.create',
            vehicleId: parseVehicleId('stable'),
            label: 'Another stable vehicle',
            patternId,
            movementPlan: {
              kind: 'vehicle-movement-plan-v1',
              edgeTravelTicks: [2, 2, 2, 2],
            },
          }),
        ),
      ).toMatchObject({ code: 'invalid-message' });
      expect(
        await client.sendCommand(
          envelopeWithId('shared-vehicle', {
            type: 'foundation.advance-ticks',
            count: 0,
          }),
        ),
      ).toMatchObject({ code: 'command-id-conflict' });
      expect(
        await client.sendCommand(
          envelopeWithId('shared-vehicle', {
            kind: 'transport.vehicle.start',
            vehicleId: parseVehicleId('stable'),
          }),
        ),
      ).toMatchObject({ code: 'command-id-conflict' });

      const stale = {
        ...envelopeWithId('stale-vehicle', {
          kind: 'transport.vehicle.create',
          vehicleId: parseVehicleId('stale'),
          label: 'Stale',
          patternId,
          movementPlan: {
            kind: 'vehicle-movement-plan-v1',
            edgeTravelTicks: [1, 1, 1, 1],
          },
        }),
        expectedCommandRevision: parseCommandRevision(99),
      };
      expect(await client.sendCommand(stale)).toMatchObject({
        status: 'rejected',
        duplicate: false,
      });
      expect(await client.sendCommand(stale)).toMatchObject({
        status: 'rejected',
        duplicate: true,
      });

      const mismatched = {
        ...envelopeWithId('retryable-id', {
          kind: 'transport.vehicle.create',
          vehicleId: parseVehicleId('retryable'),
          label: 'Retryable',
          patternId,
          movementPlan: {
            kind: 'vehicle-movement-plan-v1',
            edgeTravelTicks: [1, 1, 1, 1],
          },
        }),
        gameId: parseGameId('other-game'),
      };
      expect(await client.sendCommand(mismatched)).toMatchObject({
        code: 'identity-mismatch',
      });
      expect(
        await client.sendCommand({
          ...mismatched,
          gameId: parseGameId('game'),
        }),
      ).toMatchObject({ status: 'applied', duplicate: false });
      const foundationRetry = envelopeWithId('foundation-retry', {
        type: 'foundation.advance-ticks',
        count: 0,
      });
      expect(
        await client.sendCommand({
          ...foundationRetry,
          gameId: parseGameId('other-game'),
        }),
      ).toMatchObject({ code: 'identity-mismatch' });
      expect(await client.sendCommand(foundationRetry)).toMatchObject({
        status: 'applied',
        duplicate: false,
      });
      const exported = await client.exportSnapshot();
      expect(exported.commandRevision).toBe(4);
      expect(exported.streamOffset).toBe(4);
      expect(
        exported.snapshot.state.fleet.map(({ vehicleId }) => vehicleId),
      ).toEqual(['stable', 'retryable']);
      expect(publications).toHaveLength(4);
      await client.close();
    });
  },
);

it('keeps nontrivial dispersed passenger authority identical across direct, clone, and Worker clients', async () => {
  const canonical = scenario();
  const snapshots = [] as Awaited<
    ReturnType<TransportSimulationClient['exportSnapshot']>
  >[];
  for (const [, createClient] of factories) {
    const client = createClient();
    await client.connect({
      kind: 'transport-client-connect',
      contractVersion: 4,
      mode: 'new',
      gameId: parseGameId('game'),
      timelineId: parseTimelineId('timeline'),
      initialSimulationTick: 0,
      scenario: canonical,
      passengerDemandPlan: dispersedDemandPlan(canonical),
    });
    await client.sendCommand(
      envelope(500, { type: 'foundation.advance-ticks', count: 9 }),
    );
    snapshots.push(await client.exportSnapshot());
    await client.close();
  }
  expect(snapshots[1]).toEqual(snapshots[0]);
  expect(snapshots[2]).toEqual(snapshots[0]);
  const state = snapshots[0]!.snapshot.state;
  if (state.passengerDemand.status !== 'active')
    throw new Error('Expected active passenger authority.');
  expect(state.passengerDemand.destinationCursors).toHaveLength(4);
  expect(
    state.passengerDemand.destinationCursors.some(
      ({ destinationCursor }) => destinationCursor > 0,
    ),
  ).toBe(true);
  expect(state.passengerDemand.waitingCohorts.length).toBeGreaterThan(0);
  expect(
    new Set(
      state.passengerDemand.waitingCohorts.map(
        ({ destinationCellId }) => destinationCellId,
      ),
    ).size,
  ).toBeGreaterThan(1);
  expect(
    new Set(
      state.passengerDemand.waitingCohorts.map(
        ({ destinationStopPlaceId }) => destinationStopPlaceId,
      ),
    ).size,
  ).toBeGreaterThan(1);
  expect(
    state.passengerDemand.directItineraryUnavailablePassengerCount,
  ).toBeGreaterThan(0);
  expect(state.tick).toBe(9);
});

type ExportedTransportState = Awaited<
  ReturnType<TransportSimulationClient['exportSnapshot']>
>['snapshot']['state'];

it('keeps one-leg route-cycle handoffs identical across direct, clone, and Worker execution', async () => {
  const states: ExportedTransportState[] = [];
  for (const [, createClient] of factories) {
    const client = createClient();
    try {
      const canonical = onePatternClosedLoopScenario();
      const graph = buildDirectedScenarioGraph(canonical);
      const route = canonical.routes.routes[0]!;
      const pattern = route.patterns[0]!;
      await client.connect({
        kind: 'transport-client-connect',
        contractVersion: 4,
        mode: 'new',
        gameId: parseGameId('game'),
        timelineId: parseTimelineId('timeline'),
        initialSimulationTick: 0,
        scenario: canonical,
      });
      await client.sendCommand(
        envelope(201, {
          kind: 'transport.vehicle.create-route-cycle',
          vehicleId: parseVehicleId('route-loop-bus'),
          label: 'Route loop bus',
          routeId: route.routeId,
          legs: [
            {
              patternId: pattern.patternId,
              movementPlan: {
                kind: 'vehicle-movement-plan-v1',
                edgeTravelTicks: graph
                  .patternEdges(pattern.patternId)
                  .map(() => 2),
              },
            },
          ],
        }),
      );
      await client.sendCommand(
        envelope(202, {
          kind: 'transport.vehicle.start',
          vehicleId: parseVehicleId('route-loop-bus'),
        }),
      );
      await client.sendCommand(
        envelope(203, { type: 'foundation.advance-ticks', count: 7 }),
      );
      states.push((await client.exportSnapshot()).snapshot.state);
    } finally {
      await client.close();
    }
  }

  expect(states[1]).toEqual(states[0]);
  expect(states[2]).toEqual(states[0]);
  expect(states[0]).toMatchObject({
    tick: 7,
    fleet: [
      {
        routeId: 'closed-loop-route',
        routeLegIndex: 0,
        completedRouteCycles: 1,
        patternId: 'closed-loop-route-pattern',
      },
    ],
    vehicleOperations: [
      {
        patternRunSequence: 2,
        patternRunStartedAtTick: 7,
        stopCallSequence: 5,
      },
    ],
    currentStopCalls: [
      {
        vehicleId: 'route-loop-bus',
        stopCallSequence: 5,
        patternRunSequence: 2,
        routeId: 'closed-loop-route',
        patternId: 'closed-loop-route-pattern',
        stopNodeId: 'tv-stop-0108',
        occurrenceIndex: 0,
        tick: 7,
      },
    ],
  });
});

describe('direct vehicle client failure and idempotency behavior', () => {
  it('isolates listeners, subscriptions, invalid commands, duplicates, and conflicts', async () => {
    const client = createDirectTransportSimulationClient();
    const canonical = scenario();
    const patternId = canonical.routes.routes[0]!.patterns[0]!.patternId;
    const healthy: unknown[] = [];
    const removeFirst = client.subscribeReliableUpdates(() => {
      throw new Error('listener failed');
    });
    client.subscribeReliableUpdates((update) => healthy.push(update));
    removeFirst();
    removeFirst();
    await expect(
      client.sendCommand(
        envelope(1, { type: 'foundation.advance-ticks', count: 1 }),
      ),
    ).rejects.toThrow('not ready');
    await client.connect({
      kind: 'transport-client-connect',
      contractVersion: 4,
      mode: 'new',
      gameId: parseGameId('game'),
      timelineId: parseTimelineId('timeline'),
      initialSimulationTick: 0,
      scenario: canonical,
    });
    await expect(
      client.connect({
        kind: 'transport-client-connect',
        contractVersion: 4,
        mode: 'new',
        gameId: parseGameId('game'),
        timelineId: parseTimelineId('other'),
        initialSimulationTick: 0,
        scenario: canonical,
      }),
    ).rejects.toThrow('only from idle');
    const create = envelope(2, {
      kind: 'transport.vehicle.create',
      vehicleId: parseVehicleId('vehicle-idempotent'),
      label: 'Vehicle',
      patternId,
      movementPlan: {
        kind: 'vehicle-movement-plan-v1',
        edgeTravelTicks: [3, 4, 5, 6],
      },
    });
    expect(await client.sendCommand(create)).toMatchObject({
      status: 'applied',
    });
    expect(await client.sendCommand(create)).toMatchObject({ duplicate: true });
    const conflict = {
      ...create,
      command: { ...create.command, label: 'Changed' },
    };
    expect((await client.sendCommand(conflict)).kind).toBe(
      'foundation-protocol-error',
    );
    const invalid = envelope(3, {
      kind: 'transport.vehicle.create',
      vehicleId: parseVehicleId('invalid-plan'),
      label: 'Invalid',
      patternId,
      movementPlan: { kind: 'vehicle-movement-plan-v1', edgeTravelTicks: [1] },
    });
    expect((await client.sendCommand(invalid)).kind).toBe(
      'foundation-protocol-error',
    );
    expect(
      await client.sendCommand({
        ...envelope(4, { type: 'foundation.advance-ticks', count: 1 }),
        expectedCommandRevision: parseCommandRevision(99),
      }),
    ).toMatchObject({ status: 'rejected' });
    expect(healthy).toHaveLength(1);
    await client.close();
    expect(() => client.subscribeReliableUpdates(() => undefined)).toThrow(
      'closed',
    );
  });
});
