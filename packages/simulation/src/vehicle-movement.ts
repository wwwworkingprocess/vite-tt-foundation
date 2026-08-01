import { z } from 'zod';
import type {
  DirectedEdge,
  DirectedEdgeId,
  DirectedScenarioGraph,
  RouteId,
  RoutePatternId,
  StopNodeId,
} from '@torrevieja-tycoon/transport-domain';
import type { SimulationTick, TickAdvancement } from './time.js';
import { deepFreeze as freeze } from './authority-utils.js';

declare const vehicleIdBrand: unique symbol;
export type VehicleId = string & { readonly [vehicleIdBrand]: true };

export interface VehicleMovementPlanV1 {
  readonly kind: 'vehicle-movement-plan-v1';
  readonly edgeTravelTicks: readonly number[];
}

export interface VehicleRouteLeg {
  readonly patternId: RoutePatternId;
  readonly movementPlan: VehicleMovementPlanV1;
}

export type VehicleMovementState =
  | Readonly<{
      kind: 'parked-at-stop';
      stopNodeId: StopNodeId;
      nextEdgeSequence: 0;
    }>
  | Readonly<{
      kind: 'running-at-stop';
      stopNodeId: StopNodeId;
      nextEdgeSequence: number;
    }>
  | Readonly<{
      kind: 'running-on-edge';
      edgeId: DirectedEdgeId;
      edgeSequence: number;
      fromStopNodeId: StopNodeId;
      toStopNodeId: StopNodeId;
      progressTicks: number;
      travelTicks: number;
    }>
  | Readonly<{
      kind: 'completed-at-stop';
      stopNodeId: StopNodeId;
    }>;

export interface VehicleState {
  readonly vehicleId: VehicleId;
  readonly label: string;
  readonly patternId: RoutePatternId;
  readonly movementPlan: VehicleMovementPlanV1;
  readonly movement: VehicleMovementState;
  readonly routeId?: RouteId;
  readonly routeLegs?: readonly VehicleRouteLeg[];
  readonly routeLegIndex?: number;
  readonly completedRouteCycles?: number;
}

export type TransportVehicleCommand =
  | Readonly<{
      kind: 'transport.vehicle.create';
      vehicleId: VehicleId;
      label: string;
      patternId: RoutePatternId;
      movementPlan: VehicleMovementPlanV1;
    }>
  | Readonly<{
      kind: 'transport.vehicle.create-route-cycle';
      vehicleId: VehicleId;
      label: string;
      routeId: RouteId;
      legs: readonly VehicleRouteLeg[];
    }>
  | Readonly<{
      kind: 'transport.vehicle.start';
      vehicleId: VehicleId;
    }>;

const vehicleIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const planSchema = z.strictObject({
  kind: z.literal('vehicle-movement-plan-v1'),
  edgeTravelTicks: z.array(z.number().int().positive().safe()),
});
const createSchema = z.strictObject({
  kind: z.literal('transport.vehicle.create'),
  vehicleId: vehicleIdSchema,
  label: z.string().trim().min(1).max(128),
  patternId: z.string().min(1),
  movementPlan: planSchema,
});
const startSchema = z.strictObject({
  kind: z.literal('transport.vehicle.start'),
  vehicleId: vehicleIdSchema,
});
const routeCycleCreateSchema = z.strictObject({
  kind: z.literal('transport.vehicle.create-route-cycle'),
  vehicleId: vehicleIdSchema,
  label: z.string().trim().min(1).max(128),
  routeId: z.string().min(1),
  legs: z
    .array(
      z.strictObject({
        patternId: z.string().min(1),
        movementPlan: planSchema,
      }),
    )
    .min(1),
});
const commandSchema = z.discriminatedUnion('kind', [
  createSchema,
  routeCycleCreateSchema,
  startSchema,
]);
const movementSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('parked-at-stop'),
    stopNodeId: z.string().min(1),
    nextEdgeSequence: z.literal(0),
  }),
  z.strictObject({
    kind: z.literal('running-at-stop'),
    stopNodeId: z.string().min(1),
    nextEdgeSequence: z.number().int().nonnegative().safe(),
  }),
  z.strictObject({
    kind: z.literal('running-on-edge'),
    edgeId: z.string().min(1),
    edgeSequence: z.number().int().nonnegative().safe(),
    fromStopNodeId: z.string().min(1),
    toStopNodeId: z.string().min(1),
    progressTicks: z.number().int().nonnegative().safe(),
    travelTicks: z.number().int().positive().safe(),
  }),
  z.strictObject({
    kind: z.literal('completed-at-stop'),
    stopNodeId: z.string().min(1),
  }),
]);

const routeFieldNames = [
  'routeId',
  'routeLegs',
  'routeLegIndex',
  'completedRouteCycles',
] as const;

const vehicleSchema = z
  .strictObject({
    vehicleId: vehicleIdSchema,
    label: z.string().trim().min(1).max(128),
    patternId: z.string().min(1),
    movementPlan: planSchema,
    movement: movementSchema,
    routeId: z.string().min(1).optional(),
    routeLegs: z
      .array(
        z.strictObject({
          patternId: z.string().min(1),
          movementPlan: planSchema,
        }),
      )
      .optional(),
    routeLegIndex: z.number().int().nonnegative().safe().optional(),
    completedRouteCycles: z.number().int().nonnegative().safe().optional(),
  })
  .superRefine((vehicle, context) => {
    const present = routeFieldNames.filter(
      (field) => vehicle[field] !== undefined,
    );

    if (present.length !== 0 && present.length !== routeFieldNames.length) {
      context.addIssue({
        code: 'custom',
        message:
          'Route-cycle assignment must provide routeId, routeLegs, routeLegIndex, and completedRouteCycles together.',
      });
    }
  });

export const parseVehicleId = (value: unknown): VehicleId =>
  vehicleIdSchema.parse(value) as VehicleId;

export function parseVehicleMovementPlan(
  value: unknown,
  expectedEdgeCount: number,
): VehicleMovementPlanV1 {
  const plan = planSchema.parse(value);
  if (plan.edgeTravelTicks.length !== expectedEdgeCount)
    throw new Error(
      `Vehicle movement plan requires exactly ${expectedEdgeCount} edge travel values.`,
    );
  return freeze({
    kind: 'vehicle-movement-plan-v1',
    edgeTravelTicks: [...plan.edgeTravelTicks],
  });
}

export function parseTransportVehicleCommand(
  value: unknown,
  graph: DirectedScenarioGraph,
): TransportVehicleCommand {
  const command = commandSchema.parse(value);
  if (command.kind === 'transport.vehicle.start')
    return freeze({ ...command, vehicleId: parseVehicleId(command.vehicleId) });
  if (command.kind === 'transport.vehicle.create-route-cycle') {
    const route = graph.route(command.routeId);
    if (!route) throw new Error(`Unknown route: ${command.routeId}.`);
    if (
      command.legs.length !== route.patterns.length ||
      command.legs.some(
        (leg, index) => leg.patternId !== route.patterns[index]!.patternId,
      ) ||
      new Set(command.legs.map((leg) => leg.patternId)).size !==
        command.legs.length
    )
      throw new Error(
        `Route ${command.routeId} legs must match canonical order.`,
      );
    const legs = command.legs.map((leg) => {
      const edges = graph.patternEdges(leg.patternId);
      return {
        patternId: route.patterns.find(
          (pattern) => pattern.patternId === leg.patternId,
        )!.patternId,
        movementPlan: parseVehicleMovementPlan(leg.movementPlan, edges.length),
      };
    });
    return freeze({
      kind: command.kind,
      vehicleId: parseVehicleId(command.vehicleId),
      label: command.label,
      routeId: route.routeId,
      legs,
    });
  }
  const pattern = graph.pattern(command.patternId);
  if (!pattern) throw new Error(`Unknown route pattern: ${command.patternId}.`);
  const edges = graph.patternEdges(pattern.patternId);
  return freeze({
    kind: command.kind,
    vehicleId: parseVehicleId(command.vehicleId),
    label: command.label,
    patternId: pattern.patternId,
    movementPlan: parseVehicleMovementPlan(command.movementPlan, edges.length),
  });
}

export function applyVehicleCommand(
  graph: DirectedScenarioGraph,
  fleet: readonly VehicleState[],
  value: unknown,
): readonly VehicleState[] {
  const command = parseTransportVehicleCommand(value, graph);
  const existing = fleet.find(
    ({ vehicleId }) => vehicleId === command.vehicleId,
  );
  if (command.kind === 'transport.vehicle.create') {
    if (existing)
      throw new Error(`Duplicate vehicle ID: ${command.vehicleId}.`);
    // Canonical route patterns are validated to contain at least one edge.
    const firstEdge = graph.patternEdges(command.patternId)[0]!;
    return freeze([
      ...fleet,
      {
        vehicleId: command.vehicleId,
        label: command.label,
        patternId: command.patternId,
        movementPlan: command.movementPlan,
        movement: {
          kind: 'parked-at-stop',
          stopNodeId: firstEdge.fromStopNodeId,
          nextEdgeSequence: 0,
        },
      },
    ]);
  }
  if (command.kind === 'transport.vehicle.create-route-cycle') {
    if (existing)
      throw new Error(`Duplicate vehicle ID: ${command.vehicleId}.`);
    const firstLeg = command.legs[0]!;
    const firstEdge = graph.patternEdges(firstLeg.patternId)[0]!;
    return freeze([
      ...fleet,
      {
        vehicleId: command.vehicleId,
        label: command.label,
        routeId: command.routeId,
        routeLegs: command.legs,
        routeLegIndex: 0,
        completedRouteCycles: 0,
        patternId: firstLeg.patternId,
        movementPlan: firstLeg.movementPlan,
        movement: {
          kind: 'parked-at-stop',
          stopNodeId: firstEdge.fromStopNodeId,
          nextEdgeSequence: 0,
        },
      },
    ]);
  }
  if (!existing) throw new Error(`Unknown vehicle ID: ${command.vehicleId}.`);
  if (existing.movement.kind !== 'parked-at-stop')
    throw new Error(`Vehicle ${command.vehicleId} is not parked.`);
  const originStopNodeId = existing.movement.stopNodeId;
  return freeze(
    fleet.map((vehicle) =>
      vehicle.vehicleId === command.vehicleId
        ? {
            ...vehicle,
            movement: {
              kind: 'running-at-stop' as const,
              stopNodeId: originStopNodeId,
              nextEdgeSequence: 0,
            },
          }
        : vehicle,
    ),
  );
}

type ActiveMovement = Extract<
  VehicleMovementState,
  { readonly kind: 'running-at-stop' | 'running-on-edge' }
>;

const onEdge = (
  edge: Readonly<DirectedEdge>,
  travelTicks: number,
  progressTicks: number,
): Extract<VehicleMovementState, { readonly kind: 'running-on-edge' }> =>
  freeze({
    kind: 'running-on-edge',
    edgeId: edge.edgeId,
    edgeSequence: edge.sequence,
    fromStopNodeId: edge.fromStopNodeId,
    toStopNodeId: edge.toStopNodeId,
    progressTicks,
    travelTicks,
  });

function advanceVehicle(
  graph: DirectedScenarioGraph,
  vehicle: VehicleState,
  count: TickAdvancement,
): VehicleState {
  if (
    count === 0 ||
    vehicle.movement.kind === 'parked-at-stop' ||
    vehicle.movement.kind === 'completed-at-stop'
  )
    return vehicle;
  if (vehicle.routeId && vehicle.routeLegs)
    return advanceRouteCycleVehicle(graph, vehicle, count);
  const edges = graph.patternEdges(vehicle.patternId);
  // Created and restored vehicles have already passed graph-bound validation.
  const pattern = graph.pattern(vehicle.patternId)!;
  let remaining = count as number;
  let movement: ActiveMovement = vehicle.movement;
  let loopCycleTicks: number | undefined;
  if (pattern.closesLoop) {
    let total = 0;
    for (const travelTicks of vehicle.movementPlan.edgeTravelTicks) {
      if (travelTicks > Number.MAX_SAFE_INTEGER - total) {
        total = 0;
        break;
      }
      total += travelTicks;
    }
    loopCycleTicks = total === 0 ? undefined : total;
  }
  while (remaining > 0) {
    if (
      movement.kind === 'running-at-stop' &&
      loopCycleTicks !== undefined &&
      remaining >= loopCycleTicks
    ) {
      remaining %= loopCycleTicks;
      if (remaining === 0) break;
    }
    const sequence =
      movement.kind === 'running-at-stop'
        ? movement.nextEdgeSequence
        : movement.edgeSequence;
    const edge = edges[sequence]!;
    const travelTicks = vehicle.movementPlan.edgeTravelTicks[sequence]!;
    // The validated plan and canonical edge sequence have identical lengths.
    const progress =
      movement.kind === 'running-on-edge' ? movement.progressTicks : 0;
    const untilArrival = travelTicks - progress;
    if (remaining < untilArrival) {
      movement = onEdge(edge, travelTicks, progress + remaining);
      remaining = 0;
      continue;
    }
    remaining -= untilArrival;
    const finalEdge = sequence === edges.length - 1;
    if (finalEdge && !pattern.closesLoop) {
      return freeze({
        ...vehicle,
        movement: {
          kind: 'completed-at-stop',
          stopNodeId: edge.toStopNodeId,
        },
      });
    } else {
      movement = freeze({
        kind: 'running-at-stop',
        stopNodeId: edge.toStopNodeId,
        nextEdgeSequence: finalEdge ? 0 : sequence + 1,
      });
    }
  }
  return freeze({ ...vehicle, movement });
}

function safeRouteCycleTicks(legs: readonly VehicleRouteLeg[]) {
  let total = 0;
  for (const leg of legs)
    for (const ticks of leg.movementPlan.edgeTravelTicks) {
      if (ticks > Number.MAX_SAFE_INTEGER - total) return undefined;
      total += ticks;
    }
  return total === 0 ? undefined : total;
}

function advanceRouteCycleVehicle(
  graph: DirectedScenarioGraph,
  input: VehicleState,
  count: TickAdvancement,
): VehicleState {
  const legs = input.routeLegs!;
  let remaining = count as number;
  let vehicle = input;
  let movement: ActiveMovement = input.movement as ActiveMovement;
  const cycleTicks = safeRouteCycleTicks(legs);
  while (remaining > 0) {
    let legIndex = vehicle.routeLegIndex!;
    let leg = legs[legIndex]!;
    let edges = graph.patternEdges(leg.patternId);
    if (
      movement.kind === 'running-at-stop' &&
      movement.nextEdgeSequence === edges.length
    ) {
      const nextLegIndex = (legIndex + 1) % legs.length;
      const wrapped = nextLegIndex === 0;
      legIndex = nextLegIndex;
      leg = legs[legIndex]!;
      edges = graph.patternEdges(leg.patternId);
      movement = freeze({
        kind: 'running-at-stop',
        stopNodeId: edges[0]!.fromStopNodeId,
        nextEdgeSequence: 0,
      });
      vehicle = freeze({
        ...vehicle,
        routeLegIndex: legIndex,
        completedRouteCycles: vehicle.completedRouteCycles! + (wrapped ? 1 : 0),
        patternId: leg.patternId,
        movementPlan: leg.movementPlan,
        movement,
      });
    }
    if (
      movement.kind === 'running-at-stop' &&
      cycleTicks !== undefined &&
      remaining > cycleTicks
    ) {
      const skipped = Math.floor((remaining - 1) / cycleTicks);
      remaining -= skipped * cycleTicks;
      vehicle = freeze({
        ...vehicle,
        completedRouteCycles: vehicle.completedRouteCycles! + skipped,
      });
    }
    const sequence =
      movement.kind === 'running-at-stop'
        ? movement.nextEdgeSequence
        : movement.edgeSequence;
    const edge = edges[sequence]!;
    const travelTicks = leg.movementPlan.edgeTravelTicks[sequence]!;
    const progress =
      movement.kind === 'running-on-edge' ? movement.progressTicks : 0;
    const untilArrival = travelTicks - progress;
    if (remaining < untilArrival) {
      movement = onEdge(edge, travelTicks, progress + remaining);
      remaining = 0;
    } else {
      remaining -= untilArrival;
      movement = freeze({
        kind: 'running-at-stop',
        stopNodeId: edge.toStopNodeId,
        nextEdgeSequence: sequence + 1,
      });
    }
    vehicle = freeze({ ...vehicle, movement });
  }
  return vehicle;
}

export function advanceVehicleFleet(
  graph: DirectedScenarioGraph,
  fleet: readonly VehicleState[],
  count: TickAdvancement,
): readonly VehicleState[] {
  if (count === 0) return fleet;
  return freeze(fleet.map((vehicle) => advanceVehicle(graph, vehicle, count)));
}

export function restoreVehicleFleet(
  graph: DirectedScenarioGraph,
  value: unknown,
  snapshotTick: SimulationTick,
): readonly VehicleState[] {
  const parsed = parseVehicleFleetSnapshot(value);
  const ids = new Set<string>();
  const fleet = parsed.map((entry) => {
    const vehicleId = parseVehicleId(entry.vehicleId);
    if (ids.has(vehicleId))
      throw new Error(`Duplicate vehicle ID: ${vehicleId}.`);
    ids.add(vehicleId);
    const routeFields = [
      entry.routeId,
      entry.routeLegs,
      entry.routeLegIndex,
      entry.completedRouteCycles,
    ];
    const routeCycle = routeFields.every((field) => field !== undefined);
    if (!routeCycle && routeFields.some((field) => field !== undefined))
      throw new Error(`Vehicle ${vehicleId} route assignment is incomplete.`);
    if (routeCycle) {
      const route = graph.route(entry.routeId!);
      if (
        !route ||
        entry.routeLegs!.length !== route.patterns.length ||
        entry.routeLegIndex! >= entry.routeLegs!.length ||
        entry.routeLegs!.some(
          (leg, index) => leg.patternId !== route.patterns[index]!.patternId,
        ) ||
        new Set(entry.routeLegs!.map((leg) => leg.patternId)).size !==
          entry.routeLegs!.length
      )
        throw new Error(`Vehicle ${vehicleId} route assignment is invalid.`);
      const legs = entry.routeLegs!.map((leg) => ({
        patternId: graph.pattern(leg.patternId)!.patternId,
        movementPlan: parseVehicleMovementPlan(
          leg.movementPlan,
          graph.patternEdges(leg.patternId).length,
        ),
      }));
      if (
        entry.patternId !== legs[entry.routeLegIndex!]!.patternId ||
        JSON.stringify(entry.movementPlan) !==
          JSON.stringify(legs[entry.routeLegIndex!]!.movementPlan)
      )
        throw new Error(`Vehicle ${vehicleId} active route leg is invalid.`);
      if (entry.movement.kind === 'completed-at-stop')
        throw new Error(
          `Repeating route-cycle vehicle ${vehicleId} cannot be completed.`,
        );
      if (entry.completedRouteCycles! > snapshotTick)
        throw new Error(
          `Vehicle ${vehicleId} completed route cycles exceed the simulation tick.`,
        );
      entry = freeze({ ...entry, routeLegs: legs });
    }
    const pattern = graph.pattern(entry.patternId);
    if (!pattern) throw new Error(`Unknown route pattern: ${entry.patternId}.`);
    const edges = graph.patternEdges(pattern.patternId);
    const movementPlan = parseVehicleMovementPlan(
      entry.movementPlan,
      edges.length,
    );
    const movement = entry.movement;
    if (movement.kind === 'parked-at-stop') {
      if (movement.stopNodeId !== edges[0]!.fromStopNodeId)
        throw new Error(`Vehicle ${vehicleId} parked origin is invalid.`);
    } else if (movement.kind === 'running-at-stop') {
      const edge = edges[movement.nextEdgeSequence];
      const routeTerminal =
        routeCycle &&
        movement.nextEdgeSequence === edges.length &&
        edges.at(-1)?.toStopNodeId === movement.stopNodeId;
      if (
        (!edge || edge.fromStopNodeId !== movement.stopNodeId) &&
        !routeTerminal
      )
        throw new Error(`Vehicle ${vehicleId} next edge is invalid.`);
    } else if (movement.kind === 'running-on-edge') {
      const edge = edges[movement.edgeSequence];
      if (
        !edge ||
        edge.edgeId !== movement.edgeId ||
        edge.fromStopNodeId !== movement.fromStopNodeId ||
        edge.toStopNodeId !== movement.toStopNodeId ||
        movement.travelTicks !==
          movementPlan.edgeTravelTicks[movement.edgeSequence] ||
        movement.progressTicks >= movement.travelTicks
      )
        throw new Error(`Vehicle ${vehicleId} edge movement is invalid.`);
    } else {
      const last = edges.at(-1);
      if (
        pattern.closesLoop ||
        !last ||
        movement.stopNodeId !== last.toStopNodeId
      )
        throw new Error(`Vehicle ${vehicleId} completion is invalid.`);
    }
    return {
      vehicleId,
      label: entry.label,
      patternId: pattern.patternId,
      movementPlan,
      movement,
      ...(routeCycle
        ? {
            routeId: entry.routeId!,
            routeLegs: entry.routeLegs!,
            routeLegIndex: entry.routeLegIndex!,
            completedRouteCycles: entry.completedRouteCycles!,
          }
        : {}),
    };
  });
  return freeze(fleet);
}

export function parseVehicleFleetSnapshot(
  value: unknown,
): readonly VehicleState[] {
  return freeze(
    z
      .array(vehicleSchema)
      .parse(value)
      .map((entry) => ({
        label: entry.label,
        vehicleId: parseVehicleId(entry.vehicleId),
        patternId: entry.patternId as RoutePatternId,
        movementPlan: freeze({
          ...entry.movementPlan,
          edgeTravelTicks: [...entry.movementPlan.edgeTravelTicks],
        }),
        movement: entry.movement as VehicleMovementState,
        ...(entry.routeId === undefined
          ? {}
          : {
              routeId: entry.routeId as RouteId,
              routeLegs: entry.routeLegs!.map((leg) => ({
                patternId: leg.patternId as RoutePatternId,
                movementPlan: freeze({
                  ...leg.movementPlan,
                  edgeTravelTicks: [...leg.movementPlan.edgeTravelTicks],
                }),
              })),
              routeLegIndex: entry.routeLegIndex!,
              completedRouteCycles: entry.completedRouteCycles!,
            }),
      })),
  );
}
