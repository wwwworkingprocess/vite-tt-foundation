import { z } from 'zod';
import type {
  DirectedScenarioGraph,
  RouteId,
  RoutePatternId,
  StopNodeId,
} from '@torrevieja-tycoon/transport-domain';
import type { SimulationTick } from './time.js';
import type { VehicleId, VehicleState } from './vehicle-movement.js';

export interface VehiclePatternRunState {
  readonly vehicleId: VehicleId;
  readonly patternRunSequence: number;
  readonly patternRunStartedAtTick: SimulationTick;
  readonly stopCallSequence: number;
}

export interface VehicleStopNodeCall {
  readonly vehicleId: VehicleId;
  readonly stopCallSequence: number;
  readonly patternRunSequence: number;
  readonly routeId: RouteId | null;
  readonly patternId: RoutePatternId;
  readonly stopNodeId: StopNodeId;
  readonly occurrenceIndex: number;
  readonly tick: SimulationTick;
}

export interface WaitingCohortCallIdentity {
  readonly routeId: RouteId | null;
  readonly patternId: RoutePatternId | string;
  readonly originStopNodeId: StopNodeId | string;
}

const positiveSafeInteger = z.number().int().positive().safe();
const nonnegativeSafeInteger = z.number().int().nonnegative().safe();
const operationSchema = z.strictObject({
  vehicleId: z.string().min(1),
  patternRunSequence: positiveSafeInteger,
  patternRunStartedAtTick: nonnegativeSafeInteger,
  stopCallSequence: positiveSafeInteger,
});
const callSchema = z.strictObject({
  vehicleId: z.string().min(1),
  stopCallSequence: positiveSafeInteger,
  patternRunSequence: positiveSafeInteger,
  routeId: z.string().min(1).nullable(),
  patternId: z.string().min(1),
  stopNodeId: z.string().min(1),
  occurrenceIndex: nonnegativeSafeInteger,
  tick: nonnegativeSafeInteger,
});

const freeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
};

const checkedIncrement = (value: number, label: string): number => {
  if (value >= Number.MAX_SAFE_INTEGER) throw new Error(`${label} overflow.`);
  return value + 1;
};

const occurrenceForArrival = (
  graph: DirectedScenarioGraph,
  vehicle: VehicleState,
  edgeSequence: number,
): number => {
  const pattern = graph.pattern(vehicle.patternId)!;
  return pattern.closesLoop && edgeSequence === pattern.stopNodeIds.length - 1
    ? 0
    : edgeSequence + 1;
};

const makeCall = (
  vehicle: VehicleState,
  operation: VehiclePatternRunState,
  stopNodeId: StopNodeId,
  occurrenceIndex: number,
  tick: SimulationTick,
): VehicleStopNodeCall =>
  freeze({
    vehicleId: vehicle.vehicleId,
    stopCallSequence: checkedIncrement(
      operation.stopCallSequence,
      'StopNode-call sequence',
    ),
    patternRunSequence: operation.patternRunSequence,
    routeId: vehicle.routeId ?? null,
    patternId: vehicle.patternId,
    stopNodeId,
    occurrenceIndex,
    tick,
  });

const activeEdgeSequence = (movement: VehicleState['movement']): number => {
  if (movement.kind === 'running-on-edge') return movement.edgeSequence;
  if (movement.kind === 'running-at-stop') return movement.nextEdgeSequence;
  throw new Error('Vehicle is not in an active movement state.');
};

const arrivalStopNode = (
  before: VehicleState['movement'],
  after: VehicleState['movement'],
): StopNodeId => {
  if (after.kind === 'running-at-stop') return after.stopNodeId;
  if (before.kind === 'running-on-edge') return before.toStopNodeId;
  throw new Error('Vehicle arrival transition is invalid.');
};

export function createVehicleOperationAuthority(
  graph: DirectedScenarioGraph,
  vehicle: VehicleState,
  tick: SimulationTick,
): Readonly<{
  operation: VehiclePatternRunState;
  call: VehicleStopNodeCall;
}> {
  const pattern = graph.pattern(vehicle.patternId)!;
  const operation = freeze({
    vehicleId: vehicle.vehicleId,
    patternRunSequence: 1,
    patternRunStartedAtTick: tick,
    stopCallSequence: 1,
  });
  return freeze({
    operation,
    call: {
      vehicleId: vehicle.vehicleId,
      stopCallSequence: 1,
      patternRunSequence: 1,
      routeId: vehicle.routeId ?? null,
      patternId: vehicle.patternId,
      stopNodeId: pattern.stopNodeIds[0]!,
      occurrenceIndex: 0,
      tick,
    },
  });
}

export function deriveVehicleOperationTransition(input: {
  readonly graph: DirectedScenarioGraph;
  readonly before: VehicleState;
  readonly after: VehicleState;
  readonly operation: VehiclePatternRunState;
  readonly tick: SimulationTick;
}): Readonly<{
  operation: VehiclePatternRunState;
  calls: readonly VehicleStopNodeCall[];
}> {
  let operation = input.operation;
  const calls: VehicleStopNodeCall[] = [];
  const handedOff = input.before.patternId !== input.after.patternId;
  const beforeMovement = input.before.movement;
  const afterMovement = input.after.movement;
  const arrivedFromEdge =
    beforeMovement.kind === 'running-on-edge' &&
    beforeMovement.progressTicks + 1 === beforeMovement.travelTicks;
  let completedUnitEdgeFromStop = false;
  if (
    beforeMovement.kind === 'running-at-stop' &&
    afterMovement.kind === 'running-at-stop'
  )
    completedUnitEdgeFromStop =
      !handedOff || afterMovement.nextEdgeSequence > 0;
  const arrivalEdgeSequence =
    arrivedFromEdge || completedUnitEdgeFromStop
      ? handedOff
        ? 0
        : activeEdgeSequence(beforeMovement)
      : undefined;
  const pattern = input.graph.pattern(input.before.patternId)!;
  const closedLoopRestart =
    input.before.routeLegs === undefined &&
    pattern.closesLoop &&
    arrivalEdgeSequence === pattern.stopNodeIds.length - 1;
  if (handedOff || closedLoopRestart) {
    operation = freeze({
      ...operation,
      patternRunSequence: checkedIncrement(
        operation.patternRunSequence,
        'Pattern-run sequence',
      ),
      patternRunStartedAtTick: input.tick,
    });
  }
  if (handedOff) {
    const origin = makeCall(
      input.after,
      operation,
      input.graph.pattern(input.after.patternId)!.stopNodeIds[0]!,
      0,
      input.tick,
    );
    calls.push(origin);
    operation = freeze({
      ...operation,
      stopCallSequence: origin.stopCallSequence,
    });
  }

  if (arrivedFromEdge || completedUnitEdgeFromStop) {
    const edgeSequence = arrivalEdgeSequence!;
    const call = makeCall(
      input.after,
      operation,
      arrivalStopNode(beforeMovement, afterMovement),
      occurrenceForArrival(input.graph, input.after, edgeSequence),
      input.tick,
    );
    calls.push(call);
    operation = freeze({
      ...operation,
      stopCallSequence: call.stopCallSequence,
    });
  }
  return freeze({ operation, calls });
}

const completedEdges = (vehicle: VehicleState): number => {
  return activeEdgeSequence(vehicle.movement);
};

const routeEventPosition = (vehicle: VehicleState): number => {
  const legs = vehicle.routeLegs!;
  const eventsPerCycle = legs.reduce(
    (total, leg) => total + leg.movementPlan.edgeTravelTicks.length + 1,
    0,
  );
  let position = vehicle.completedRouteCycles! * eventsPerCycle;
  for (let index = 0; index < vehicle.routeLegIndex!; index += 1)
    position += legs[index]!.movementPlan.edgeTravelTicks.length + 1;
  return position + completedEdges(vehicle);
};

export function fastForwardVehicleOperation(input: {
  readonly graph: DirectedScenarioGraph;
  readonly before: VehicleState;
  readonly after: VehicleState;
  readonly operation: VehiclePatternRunState;
  readonly tick: SimulationTick;
  readonly advancement: number;
}): VehiclePatternRunState {
  if (!input.before.routeLegs || !input.after.routeLegs) {
    const plan = input.before.movementPlan.edgeTravelTicks;
    const movement = input.before.movement;
    const edgeIndex = activeEdgeSequence(movement);
    let offset = plan
      .slice(0, edgeIndex)
      .reduce((total, ticks) => total + ticks, 0);
    if (movement.kind === 'running-on-edge') offset += movement.progressTicks;
    const cycleTicks = plan.reduce((total, ticks) => total + ticks, 0);
    const end = offset + input.advancement;
    const completedRuns = Math.floor(end / cycleTicks);
    const remainder = end % cycleTicks;
    let completedCalls = completedRuns * plan.length;
    let boundary = 0;
    const lowerBoundary = completedRuns > 0 ? 0 : offset;
    for (const ticks of plan) {
      boundary += ticks;
      if (boundary > lowerBoundary && boundary <= remainder)
        completedCalls += 1;
    }
    if (
      input.operation.patternRunSequence >
        Number.MAX_SAFE_INTEGER - completedRuns ||
      input.operation.stopCallSequence >
        Number.MAX_SAFE_INTEGER - completedCalls
    )
      throw new Error('Vehicle operating sequence overflow.');
    return freeze({
      vehicleId: input.operation.vehicleId,
      patternRunSequence: input.operation.patternRunSequence + completedRuns,
      patternRunStartedAtTick: (input.tick - remainder) as SimulationTick,
      stopCallSequence: input.operation.stopCallSequence + completedCalls,
    });
  }
  const legs = input.after.routeLegs;
  const beforeRun =
    input.before.completedRouteCycles! * legs.length +
    input.before.routeLegIndex!;
  const afterRun =
    input.after.completedRouteCycles! * legs.length +
    input.after.routeLegIndex!;
  const runDelta = afterRun - beforeRun;
  const callDelta =
    routeEventPosition(input.after) - routeEventPosition(input.before);
  if (
    runDelta < 0 ||
    callDelta < 0 ||
    input.operation.patternRunSequence > Number.MAX_SAFE_INTEGER - runDelta ||
    input.operation.stopCallSequence > Number.MAX_SAFE_INTEGER - callDelta
  )
    throw new Error('Vehicle operating sequence overflow.');
  let elapsed = 0;
  const movement = input.after.movement;
  const leg = legs[input.after.routeLegIndex!]!;
  const edgeCount = completedEdges(input.after);
  for (let index = 0; index < edgeCount; index += 1)
    elapsed += leg.movementPlan.edgeTravelTicks[index]!;
  if (movement.kind === 'running-on-edge') elapsed += movement.progressTicks;
  return freeze({
    vehicleId: input.operation.vehicleId,
    patternRunSequence: input.operation.patternRunSequence + runDelta,
    patternRunStartedAtTick: (input.tick - elapsed) as SimulationTick,
    stopCallSequence: input.operation.stopCallSequence + callDelta,
  });
}

export function parseVehicleOperationAuthority(
  value: unknown,
): readonly VehiclePatternRunState[] {
  return freeze(
    z.array(operationSchema).parse(value) as VehiclePatternRunState[],
  );
}

export function parseVehicleStopNodeCalls(
  value: unknown,
): readonly VehicleStopNodeCall[] {
  return freeze(z.array(callSchema).parse(value) as VehicleStopNodeCall[]);
}

export function vehicleCallCanServeWaitingCohort(
  call: VehicleStopNodeCall,
  cohort: WaitingCohortCallIdentity,
): boolean {
  return (
    call.routeId === cohort.routeId &&
    call.patternId === cohort.patternId &&
    call.stopNodeId === cohort.originStopNodeId
  );
}

export function validateVehicleOperationAuthority(input: {
  readonly graph: DirectedScenarioGraph;
  readonly fleet: readonly VehicleState[];
  readonly operations: unknown;
  readonly calls: unknown;
  readonly tick: SimulationTick;
}): Readonly<{
  operations: readonly VehiclePatternRunState[];
  calls: readonly VehicleStopNodeCall[];
}> {
  const operations = parseVehicleOperationAuthority(input.operations);
  const calls = parseVehicleStopNodeCalls(input.calls);
  if (operations.length !== input.fleet.length)
    throw new Error('Vehicle operating state must match the fleet exactly.');
  const fleet = new Map(
    input.fleet.map((vehicle) => [vehicle.vehicleId, vehicle]),
  );
  const operationIds = new Set<string>();
  for (const operation of operations) {
    const vehicle = fleet.get(operation.vehicleId);
    if (operationIds.has(operation.vehicleId) || !vehicle)
      throw new Error('Vehicle operating state identity is invalid.');
    operationIds.add(operation.vehicleId);
    if (operation.patternRunStartedAtTick > input.tick)
      throw new Error('Pattern-run start tick cannot be in the future.');
    if (
      vehicle.routeLegs &&
      operation.patternRunSequence !==
        vehicle.completedRouteCycles! * vehicle.routeLegs.length +
          vehicle.routeLegIndex! +
          1
    )
      throw new Error('Pattern-run sequence does not match route authority.');
  }
  let previousKey = '';
  const latest = new Map<string, number>();
  for (const call of calls) {
    const vehicle = fleet.get(call.vehicleId);
    const operation = operations.find(
      ({ vehicleId }) => vehicleId === call.vehicleId,
    );
    if (!vehicle || !operation || call.tick !== input.tick)
      throw new Error('Current StopNode call authority is invalid.');
    const route =
      call.routeId === null ? null : input.graph.route(call.routeId);
    const pattern = input.graph.pattern(call.patternId);
    if (
      !pattern ||
      (route !== null &&
        !route?.patterns.some(
          ({ patternId }) => patternId === call.patternId,
        )) ||
      pattern.stopNodeIds[call.occurrenceIndex] !== call.stopNodeId ||
      call.patternRunSequence !== operation.patternRunSequence ||
      call.stopCallSequence > operation.stopCallSequence
    )
      throw new Error(
        'Current StopNode call does not match canonical authority.',
      );
    const key = `${call.vehicleId}\0${String(call.stopCallSequence).padStart(16, '0')}`;
    if (key <= previousKey)
      throw new Error('Current StopNode calls are not canonical.');
    previousKey = key;
    const previous = latest.get(call.vehicleId);
    if (previous !== undefined && call.stopCallSequence !== previous + 1)
      throw new Error('Current StopNode call sequences must be contiguous.');
    latest.set(call.vehicleId, call.stopCallSequence);
  }
  for (const operation of operations) {
    const finalCall = latest.get(operation.vehicleId);
    if (finalCall !== undefined && finalCall !== operation.stopCallSequence)
      throw new Error(
        'Current StopNode calls do not reach the persisted counter.',
      );
    const initialCall = calls.find(
      (call) => call.vehicleId === operation.vehicleId,
    );
    if (
      operation.stopCallSequence === 1 &&
      (initialCall?.stopCallSequence !== 1 || initialCall.occurrenceIndex !== 0)
    )
      throw new Error('Initial vehicle origin call is required.');
  }
  return freeze({ operations, calls });
}
