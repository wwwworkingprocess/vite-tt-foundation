import { z } from 'zod';
import type {
  DirectedScenarioGraph,
  RouteId,
  RoutePatternId,
  StopNodeId,
} from '@torrevieja-tycoon/transport-domain';
import type { SimulationTick } from './time.js';
import type { VehicleId, VehicleState } from './vehicle-movement.js';
import {
  checkedAdd,
  checkedMultiply,
  deepFreeze as freeze,
  nonnegativeSafeInteger,
  positiveSafeInteger,
} from './authority-utils.js';

export interface VehiclePatternRunState {
  readonly vehicleId: VehicleId;
  readonly patternRunSequence: number;
  readonly patternRunStartedAtTick: SimulationTick;
  readonly movementStartedAtTick: SimulationTick | null;
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

const invalidOperation =
  'Invalid vehicle operation authority: must match the fleet; future canonical counter, sequence, same order, run start, movement-start, origin, terminal, or current call.';
const operationContext = 'Vehicle operation';
const sequenceOverflow = 'Vehicle operating sequence overflow.';
const operationSchema = z.strictObject({
  vehicleId: z.string().min(1),
  patternRunSequence: positiveSafeInteger,
  patternRunStartedAtTick: nonnegativeSafeInteger,
  movementStartedAtTick: nonnegativeSafeInteger.nullable(),
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
      operationContext,
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
    movementStartedAtTick: null,
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
        operationContext,
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
      operationContext,
    );
  let position = checkedMultiply(
    vehicle.completedRouteCycles!,
    eventsPerCycle,
    operationContext,
  );
  for (let index = 0; index < vehicle.routeLegIndex!; index += 1)
    position = checkedAdd(
      position,
      legs[index]!.movementPlan.edgeTravelTicks.length + 1,
      operationContext,
    );
  return checkedAdd(position, completedEdges(vehicle), operationContext);
};

const elapsedWithinPatternRun = (vehicle: VehicleState): number => {
  const completed = completedEdges(vehicle);
  let elapsed = 0;
  for (let index = 0; index < completed; index += 1)
    elapsed = checkedAdd(
      elapsed,
      vehicle.movementPlan.edgeTravelTicks[index]!,
      operationContext,
    );
  if (vehicle.movement.kind === 'running-on-edge')
    elapsed = checkedAdd(
      elapsed,
      vehicle.movement.progressTicks,
      operationContext,
    );
  return elapsed;
};

export function completedLoopEventsAtElapsedTick(
  plan: readonly number[],
  elapsed: number,
): number {
  let cycleTicks = 0;
  for (const ticks of plan)
    cycleTicks = checkedAdd(cycleTicks, ticks, operationContext);
  const completeCycles = Math.floor(elapsed / cycleTicks);
  const remainder = elapsed % cycleTicks;
  let events = checkedMultiply(completeCycles, plan.length, operationContext);
  let boundary = 0;
  for (const ticks of plan) {
    boundary = checkedAdd(boundary, ticks, operationContext);
    if (boundary <= remainder)
      events = checkedIncrement(events, operationContext);
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
      cycleTicks = checkedAdd(cycleTicks, ticks, operationContext);
    const end = checkedAdd(offset, input.advancement, operationContext);
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
      throw new Error(sequenceOverflow);
    return freeze({
      vehicleId: input.operation.vehicleId,
      patternRunSequence: input.operation.patternRunSequence + completedRuns,
      patternRunStartedAtTick:
        completedRuns === 0
          ? input.operation.patternRunStartedAtTick
          : ((input.tick - remainder) as SimulationTick),
      movementStartedAtTick: input.operation.movementStartedAtTick,
      stopCallSequence: input.operation.stopCallSequence + completedCalls,
    });
  }
  const beforeRun = routeRunIndex(input.before);
  const afterRun = routeRunIndex(input.after);
  const runDelta = afterRun - beforeRun;
  const callDelta =
    routeEventPosition(input.after) - routeEventPosition(input.before);
  if (
    runDelta < 0 ||
    callDelta < 0 ||
    input.operation.patternRunSequence > Number.MAX_SAFE_INTEGER - runDelta ||
    input.operation.stopCallSequence > Number.MAX_SAFE_INTEGER - callDelta
  )
    throw new Error(sequenceOverflow);
  const elapsed = elapsedWithinPatternRun(input.after);
  return freeze({
    vehicleId: input.operation.vehicleId,
    patternRunSequence: input.operation.patternRunSequence + runDelta,
    patternRunStartedAtTick:
      runDelta === 0
        ? input.operation.patternRunStartedAtTick
        : ((input.tick - elapsed + 1) as SimulationTick),
    movementStartedAtTick: input.operation.movementStartedAtTick,
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

const movementPlanTicks = (plan: readonly number[]): number => {
  let total = 0;
  for (const ticks of plan) total = checkedAdd(total, ticks, operationContext);
  return total;
};

const routeRunIndex = (vehicle: VehicleState): number =>
  checkedAdd(
    checkedMultiply(
      vehicle.completedRouteCycles!,
      vehicle.routeLegs!.length,
      operationContext,
    ),
    vehicle.routeLegIndex!,
    operationContext,
  );

const routeElapsedBeforeRun = (vehicle: VehicleState): number => {
  const runIndex = routeRunIndex(vehicle);
  const legs = vehicle.routeLegs!;
  const completeCycles = Math.floor(runIndex / legs.length);
  const remainingLegs = runIndex % legs.length;
  let cycleTicks = 0;
  for (const leg of legs)
    cycleTicks = checkedAdd(
      cycleTicks,
      movementPlanTicks(leg.movementPlan.edgeTravelTicks),
      operationContext,
    );
  let elapsed = checkedMultiply(completeCycles, cycleTicks, operationContext);
  for (let index = 0; index < remainingLegs; index += 1)
    elapsed = checkedAdd(
      elapsed,
      movementPlanTicks(legs[index]!.movementPlan.edgeTravelTicks),
      operationContext,
    );
  return elapsed;
};

const routeRunStartedAtTick = (
  vehicle: VehicleState,
  movementStartedAtTick: SimulationTick,
): SimulationTick =>
  checkedAdd(
    movementStartedAtTick,
    checkedIncrement(routeElapsedBeforeRun(vehicle), operationContext),
    operationContext,
  ) as SimulationTick;

const validateMovementTimeline = (
  graph: DirectedScenarioGraph,
  vehicle: VehicleState,
  operation: VehiclePatternRunState,
  tick: SimulationTick,
): void => {
  if (vehicle.movement.kind === 'parked-at-stop') {
    if (operation.movementStartedAtTick !== null)
      throw new Error(invalidOperation);
    return;
  }
  if (
    operation.movementStartedAtTick === null ||
    operation.movementStartedAtTick > tick
  )
    throw new Error(invalidOperation);
  let expectedElapsed = elapsedWithinPatternRun(vehicle);
  if (vehicle.routeLegs)
    expectedElapsed = checkedAdd(
      expectedElapsed,
      routeElapsedBeforeRun(vehicle),
      operationContext,
    );
  else if (graph.pattern(vehicle.patternId)!.closesLoop) {
    expectedElapsed = checkedAdd(
      expectedElapsed,
      checkedMultiply(
        operation.patternRunSequence - 1,
        movementPlanTicks(vehicle.movementPlan.edgeTravelTicks),
        operationContext,
      ),
      operationContext,
    );
  }
  const actualElapsed = tick - operation.movementStartedAtTick;
  if (
    vehicle.movement.kind === 'completed-at-stop'
      ? actualElapsed < expectedElapsed
      : actualElapsed !== expectedElapsed
  )
    throw new Error(invalidOperation);
};

export function deriveExpectedCurrentVehicleCalls(input: {
  readonly graph: DirectedScenarioGraph;
  readonly vehicle: VehicleState;
  readonly operation: VehiclePatternRunState;
  readonly tick: SimulationTick;
}): readonly VehicleStopNodeCall[] {
  const calls: VehicleStopNodeCall[] = [];
  const initialOriginIsCurrent =
    input.operation.stopCallSequence === 1 &&
    input.operation.patternRunStartedAtTick === input.tick;
  const laterRunOriginIsCurrent =
    input.operation.patternRunSequence > 1 &&
    input.operation.patternRunStartedAtTick === input.tick;
  const completed = completedEdges(input.vehicle);
  let arrivalIsCurrent = false;
  if (completed > 0 && input.operation.movementStartedAtTick !== null) {
    let elapsed = 0;
    for (let index = 0; index < completed; index += 1)
      elapsed = checkedAdd(
        elapsed,
        input.vehicle.movementPlan.edgeTravelTicks[index]!,
        operationContext,
      );
    const firstRouteRun =
      input.vehicle.routeLegs !== undefined &&
      routeRunIndex(input.vehicle) === 0;
    const baseTick = firstRouteRun
      ? input.operation.movementStartedAtTick
      : input.vehicle.routeLegs
        ? input.operation.patternRunStartedAtTick - 1
        : input.operation.patternRunSequence === 1
          ? input.operation.movementStartedAtTick
          : input.operation.patternRunStartedAtTick;
    arrivalIsCurrent =
      checkedAdd(baseTick, elapsed, operationContext) === input.tick;
  }
  const originIsCurrent = initialOriginIsCurrent || laterRunOriginIsCurrent;
  if (originIsCurrent) {
    const originSequence =
      arrivalIsCurrent && completed > 0
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
  if (arrivalIsCurrent && completed > 0)
    calls.push(
      expectedCall(
        input.graph,
        input.vehicle,
        input.operation,
        input.graph.pattern(input.vehicle.patternId)!.closesLoop &&
          completed === input.vehicle.movementPlan.edgeTravelTicks.length
          ? 0
          : completed,
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
    throw new Error(invalidOperation);
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index]!;
    const vehicle = input.fleet[index]!;
    if (operation.vehicleId !== vehicle.vehicleId)
      throw new Error(invalidOperation);
    if (operation.patternRunStartedAtTick > input.tick)
      throw new Error(invalidOperation);
    let expectedRunSequence = 1;
    let expectedStopCallSequence: number;
    if (vehicle.routeLegs) {
      const runIndex = routeRunIndex(vehicle);
      expectedRunSequence = checkedIncrement(runIndex, operationContext);
      if (runIndex === 0) {
        if (
          operation.movementStartedAtTick !== null &&
          operation.patternRunStartedAtTick > operation.movementStartedAtTick
        )
          throw new Error(invalidOperation);
      } else if (
        operation.patternRunStartedAtTick !==
        routeRunStartedAtTick(vehicle, operation.movementStartedAtTick!)
      )
        throw new Error(invalidOperation);
      expectedStopCallSequence = checkedAdd(
        1,
        routeEventPosition(vehicle),
        operationContext,
      );
    } else if (input.graph.pattern(vehicle.patternId)!.closesLoop) {
      if (operation.movementStartedAtTick === null) expectedRunSequence = 1;
      else {
        const cycleTicks = movementPlanTicks(
          vehicle.movementPlan.edgeTravelTicks,
        );
        const completedRuns = Math.floor(
          (input.tick - operation.movementStartedAtTick) / cycleTicks,
        );
        expectedRunSequence = checkedIncrement(completedRuns, operationContext);
        if (completedRuns === 0) {
          if (
            operation.patternRunStartedAtTick > operation.movementStartedAtTick
          )
            throw new Error(invalidOperation);
        } else if (
          operation.patternRunStartedAtTick !==
          checkedAdd(
            operation.movementStartedAtTick,
            checkedMultiply(completedRuns, cycleTicks, operationContext),
            operationContext,
          )
        )
          throw new Error(invalidOperation);
      }
      expectedStopCallSequence = checkedAdd(
        1,
        checkedAdd(
          checkedMultiply(
            expectedRunSequence - 1,
            vehicle.movementPlan.edgeTravelTicks.length,
            operationContext,
          ),
          completedEdges(vehicle),
          operationContext,
        ),
        operationContext,
      );
    } else {
      if (
        operation.patternRunSequence !== 1 ||
        (operation.movementStartedAtTick !== null &&
          operation.patternRunStartedAtTick > operation.movementStartedAtTick)
      )
        throw new Error(invalidOperation);
      expectedStopCallSequence = checkedAdd(
        1,
        completedEdges(vehicle),
        operationContext,
      );
    }
    if (operation.patternRunSequence !== expectedRunSequence)
      throw new Error(invalidOperation);
    validateMovementTimeline(input.graph, vehicle, operation, input.tick);
    if (operation.stopCallSequence !== expectedStopCallSequence)
      throw new Error(invalidOperation);
  }
  const expectedCalls = input.fleet
    .flatMap((vehicle, index) =>
      deriveExpectedCurrentVehicleCalls({
        graph: input.graph,
        vehicle,
        operation: operations[index]!,
        tick: input.tick,
      }),
    )
    .sort(
      (left, right) =>
        left.vehicleId.localeCompare(right.vehicleId) ||
        left.stopCallSequence - right.stopCallSequence,
    );
  if (JSON.stringify(calls) !== JSON.stringify(expectedCalls))
    throw new Error(invalidOperation);
  return freeze({ operations, calls });
}
