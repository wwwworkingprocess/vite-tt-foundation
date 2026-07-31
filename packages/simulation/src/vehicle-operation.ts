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

const checkedAdd = (left: number, right: number, label: string): number => {
  if (right < 0 || left > Number.MAX_SAFE_INTEGER - right)
    throw new Error(`${label} overflow.`);
  return left + right;
};

const checkedMultiply = (
  left: number,
  right: number,
  label: string,
): number => {
  if (left !== 0 && right > Math.floor(Number.MAX_SAFE_INTEGER / left))
    throw new Error(`${label} overflow.`);
  return left * right;
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

type ActiveVehicleMovement = Extract<
  VehicleState['movement'],
  { readonly kind: 'running-at-stop' | 'running-on-edge' }
>;

const activeEdgeSequence = (movement: ActiveVehicleMovement): number => {
  if (movement.kind === 'running-on-edge') return movement.edgeSequence;
  return movement.nextEdgeSequence;
};

const arrivalStopNode = (
  after: Extract<
    VehicleState['movement'],
    { readonly kind: 'running-at-stop' | 'completed-at-stop' }
  >,
): StopNodeId => {
  return after.stopNodeId;
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
  if (
    input.operation.vehicleId !== input.before.vehicleId ||
    input.before.vehicleId !== input.after.vehicleId
  )
    throw new Error('Vehicle operation transition vehicle identity mismatch.');
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
    (afterMovement.kind === 'running-at-stop' ||
      afterMovement.kind === 'completed-at-stop')
  )
    completedUnitEdgeFromStop =
      !handedOff ||
      (afterMovement.kind === 'running-at-stop' &&
        afterMovement.nextEdgeSequence > 0);
  const arrivalEdgeSequence =
    arrivedFromEdge || completedUnitEdgeFromStop
      ? handedOff
        ? 0
        : activeEdgeSequence(beforeMovement as ActiveVehicleMovement)
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
      arrivalStopNode(
        afterMovement as Extract<
          VehicleState['movement'],
          { readonly kind: 'running-at-stop' | 'completed-at-stop' }
        >,
      ),
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
  const edgeCount = vehicle.movementPlan.edgeTravelTicks.length;
  if (vehicle.movement.kind === 'parked-at-stop') return 0;
  if (vehicle.movement.kind === 'completed-at-stop') return edgeCount;
  return activeEdgeSequence(vehicle.movement);
};

const routeEventPosition = (vehicle: VehicleState): number => {
  const legs = vehicle.routeLegs!;
  let eventsPerCycle = 0;
  for (const leg of legs)
    eventsPerCycle = checkedAdd(
      eventsPerCycle,
      leg.movementPlan.edgeTravelTicks.length + 1,
      'Route event position',
    );
  let position = checkedMultiply(
    vehicle.completedRouteCycles!,
    eventsPerCycle,
    'Route event position',
  );
  for (let index = 0; index < vehicle.routeLegIndex!; index += 1)
    position = checkedAdd(
      position,
      legs[index]!.movementPlan.edgeTravelTicks.length + 1,
      'Route event position',
    );
  return checkedAdd(position, completedEdges(vehicle), 'Route event position');
};

const elapsedWithinPatternRun = (vehicle: VehicleState): number => {
  const completed = completedEdges(vehicle);
  let elapsed = 0;
  for (let index = 0; index < completed; index += 1)
    elapsed = checkedAdd(
      elapsed,
      vehicle.movementPlan.edgeTravelTicks[index]!,
      'Pattern elapsed tick',
    );
  if (vehicle.movement.kind === 'running-on-edge')
    elapsed = checkedAdd(
      elapsed,
      vehicle.movement.progressTicks,
      'Pattern elapsed tick',
    );
  return elapsed;
};

export function completedLoopEventsAtElapsedTick(
  plan: readonly number[],
  elapsed: number,
): number {
  let cycleTicks = 0;
  for (const ticks of plan)
    cycleTicks = checkedAdd(cycleTicks, ticks, 'Loop cycle tick');
  const completeCycles = Math.floor(elapsed / cycleTicks);
  const remainder = elapsed % cycleTicks;
  let events = checkedMultiply(
    completeCycles,
    plan.length,
    'Loop event position',
  );
  let boundary = 0;
  for (const ticks of plan) {
    boundary = checkedAdd(boundary, ticks, 'Loop edge boundary');
    if (boundary <= remainder)
      events = checkedIncrement(events, 'Loop event position');
  }
  return events;
}

export function fastForwardVehicleOperation(input: {
  readonly graph: DirectedScenarioGraph;
  readonly before: VehicleState;
  readonly after: VehicleState;
  readonly operation: VehiclePatternRunState;
  readonly tick: SimulationTick;
  readonly advancement: number;
}): VehiclePatternRunState {
  if (
    input.operation.vehicleId !== input.before.vehicleId ||
    input.before.vehicleId !== input.after.vehicleId
  )
    throw new Error(
      'Vehicle operation fast-forward vehicle identity mismatch.',
    );
  if (!input.before.routeLegs || !input.after.routeLegs) {
    const plan = input.before.movementPlan.edgeTravelTicks;
    const offset = elapsedWithinPatternRun(input.before);
    let cycleTicks = 0;
    for (const ticks of plan)
      cycleTicks = checkedAdd(cycleTicks, ticks, 'Loop cycle tick');
    const end = checkedAdd(offset, input.advancement, 'Loop elapsed endpoint');
    const completedRuns = Math.floor(end / cycleTicks);
    const remainder = end % cycleTicks;
    const completedCalls =
      completedLoopEventsAtElapsedTick(plan, end) -
      completedLoopEventsAtElapsedTick(plan, offset);
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
      patternRunStartedAtTick:
        completedRuns === 0
          ? input.operation.patternRunStartedAtTick
          : ((input.tick - remainder) as SimulationTick),
      stopCallSequence: input.operation.stopCallSequence + completedCalls,
    });
  }
  const legs = input.after.routeLegs;
  const beforeRun = checkedAdd(
    checkedMultiply(
      input.before.completedRouteCycles!,
      legs.length,
      'Pattern-run position',
    ),
    input.before.routeLegIndex!,
    'Pattern-run position',
  );
  const afterRun = checkedAdd(
    checkedMultiply(
      input.after.completedRouteCycles!,
      legs.length,
      'Pattern-run position',
    ),
    input.after.routeLegIndex!,
    'Pattern-run position',
  );
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
  const elapsed = elapsedWithinPatternRun(input.after);
  return freeze({
    vehicleId: input.operation.vehicleId,
    patternRunSequence: input.operation.patternRunSequence + runDelta,
    patternRunStartedAtTick:
      runDelta === 0
        ? input.operation.patternRunStartedAtTick
        : ((input.tick - elapsed + 1) as SimulationTick),
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

const expectedCall = (
  graph: DirectedScenarioGraph,
  vehicle: VehicleState,
  operation: VehiclePatternRunState,
  occurrenceIndex: number,
  stopCallSequence: number,
  tick: SimulationTick,
): VehicleStopNodeCall => {
  const pattern = graph.pattern(vehicle.patternId)!;
  return freeze({
    vehicleId: vehicle.vehicleId,
    stopCallSequence,
    patternRunSequence: operation.patternRunSequence,
    routeId: vehicle.routeId ?? null,
    patternId: vehicle.patternId,
    stopNodeId: pattern.stopNodeIds[occurrenceIndex]!,
    occurrenceIndex,
    tick,
  });
};

export function deriveExpectedCurrentVehicleCalls(input: {
  readonly graph: DirectedScenarioGraph;
  readonly vehicle: VehicleState;
  readonly operation: VehiclePatternRunState;
  readonly tick: SimulationTick;
  readonly serializedCalls?: readonly VehicleStopNodeCall[];
}): readonly VehicleStopNodeCall[] {
  const { movement } = input.vehicle;
  const calls: VehicleStopNodeCall[] = [];
  const originIsCurrent =
    input.operation.patternRunStartedAtTick === input.tick &&
    (movement.kind === 'parked-at-stop' ||
      movement.kind === 'running-on-edge' ||
      (movement.kind === 'running-at-stop' && movement.nextEdgeSequence === 0));
  const arrivedAtStop =
    movement.kind === 'running-at-stop' && movement.nextEdgeSequence > 0;
  if (
    originIsCurrent ||
    (arrivedAtStop && input.operation.patternRunStartedAtTick === input.tick)
  ) {
    const originSequence = arrivedAtStop
      ? input.operation.stopCallSequence - 1
      : input.operation.stopCallSequence;
    calls.push(
      expectedCall(
        input.graph,
        input.vehicle,
        input.operation,
        0,
        originSequence,
        input.tick,
      ),
    );
  }
  if (arrivedAtStop)
    calls.push(
      expectedCall(
        input.graph,
        input.vehicle,
        input.operation,
        movement.nextEdgeSequence,
        input.operation.stopCallSequence,
        input.tick,
      ),
    );
  if (
    movement.kind === 'completed-at-stop' &&
    (input.serializedCalls?.length ?? 0) > 0
  )
    calls.push(
      expectedCall(
        input.graph,
        input.vehicle,
        input.operation,
        input.vehicle.movementPlan.edgeTravelTicks.length,
        input.operation.stopCallSequence,
        input.tick,
      ),
    );
  return freeze(calls);
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
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index]!;
    const vehicle = input.fleet[index]!;
    if (operation.vehicleId !== vehicle.vehicleId)
      throw new Error(
        'Vehicle operating state must use the same order as the fleet.',
      );
    if (operation.patternRunStartedAtTick > input.tick)
      throw new Error('Pattern-run start tick cannot be in the future.');
    let expectedRunSequence = 1;
    let expectedStopCallSequence: number;
    if (vehicle.routeLegs) {
      expectedRunSequence = checkedAdd(
        checkedMultiply(
          vehicle.completedRouteCycles!,
          vehicle.routeLegs.length,
          'Pattern-run sequence',
        ),
        vehicle.routeLegIndex! + 1,
        'Pattern-run sequence',
      );
      expectedStopCallSequence = checkedAdd(
        1,
        routeEventPosition(vehicle),
        'StopNode-call sequence',
      );
    } else if (input.graph.pattern(vehicle.patternId)!.closesLoop) {
      expectedRunSequence = operation.patternRunSequence;
      expectedStopCallSequence = checkedAdd(
        1,
        checkedAdd(
          checkedMultiply(
            operation.patternRunSequence - 1,
            vehicle.movementPlan.edgeTravelTicks.length,
            'StopNode-call sequence',
          ),
          completedEdges(vehicle),
          'StopNode-call sequence',
        ),
        'StopNode-call sequence',
      );
    } else {
      expectedStopCallSequence = checkedAdd(
        1,
        completedEdges(vehicle),
        'StopNode-call sequence',
      );
    }
    if (operation.patternRunSequence !== expectedRunSequence)
      throw new Error('Pattern-run sequence counter is not canonical.');
    if (operation.stopCallSequence !== expectedStopCallSequence)
      throw new Error('StopNode-call sequence counter is not canonical.');
  }
  const expectedCalls = input.fleet
    .flatMap((vehicle, index) =>
      deriveExpectedCurrentVehicleCalls({
        graph: input.graph,
        vehicle,
        operation: operations[index]!,
        tick: input.tick,
        serializedCalls: calls.filter(
          ({ vehicleId }) => vehicleId === vehicle.vehicleId,
        ),
      }),
    )
    .sort(
      (left, right) =>
        left.vehicleId.localeCompare(right.vehicleId) ||
        left.stopCallSequence - right.stopCallSequence,
    );
  if (JSON.stringify(calls) !== JSON.stringify(expectedCalls))
    throw new Error('Current StopNode calls are not canonical for this tick.');
  return freeze({ operations, calls });
}
