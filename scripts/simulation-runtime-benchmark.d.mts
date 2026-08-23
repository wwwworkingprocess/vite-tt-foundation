export interface SimulationRuntimeBenchmarkOptions {
  readonly scenario: string;
  readonly runs: number;
  readonly ticks: number;
  readonly warmup: number;
  readonly passengerWorkWindow?: number;
  readonly profilePassengerPhases?: boolean;
  readonly json?: boolean;
}

export interface PassengerRuntimePhaseSummary {
  readonly invocations: number;
  readonly totalMs: number;
  readonly msPerTick: number;
  readonly meanMsPerInvocation: number;
  readonly shareOfMeasuredPassengerTime: number;
  readonly work: Readonly<Record<string, number>>;
}

export interface PassengerRuntimeNestedPhaseSummary {
  readonly invocations: number;
  readonly totalMs: number;
  readonly msPerTick: number;
  readonly meanMsPerInvocation: number;
  readonly shareOfDestinationWaitingTime: number;
  readonly work: Readonly<Record<string, number>>;
}

export interface PassengerWaitingActivationPhaseSummary {
  readonly invocations: number;
  readonly totalMs: number;
  readonly msPerTick: number;
  readonly meanMsPerInvocation: number;
  readonly shareOfWaitingActivationTime: number;
  readonly work: Readonly<Record<string, number>>;
}

export interface PassengerWaitingActivationBreakdown {
  readonly planPreparation: PassengerWaitingActivationPhaseSummary;
  readonly existingAuthorityPreparation: PassengerWaitingActivationPhaseSummary;
  readonly newAssignmentActivation: PassengerWaitingActivationPhaseSummary;
  readonly orderingFinalization: PassengerWaitingActivationPhaseSummary;
  readonly unattributed: Readonly<{
    totalMs: number;
    msPerTick: number;
    shareOfWaitingActivationTime: number;
  }>;
}

export interface PassengerDestinationWaitingBreakdown {
  readonly destinationAllocation: PassengerRuntimeNestedPhaseSummary;
  readonly waitingActivation: PassengerRuntimeNestedPhaseSummary &
    Readonly<{ breakdown?: PassengerWaitingActivationBreakdown }>;
  readonly accessingOrdering: PassengerRuntimeNestedPhaseSummary;
  readonly stopAuthorityMaterialization: PassengerRuntimeNestedPhaseSummary;
  readonly stateFinalization: PassengerRuntimeNestedPhaseSummary;
  readonly unattributed: Readonly<{
    totalMs: number;
    msPerTick: number;
    shareOfDestinationWaitingTime: number;
  }>;
}

export function parseSimulationRuntimeBenchmarkArguments(
  values: readonly string[],
): Readonly<Required<SimulationRuntimeBenchmarkOptions>>;

export function runSimulationRuntimeBenchmark(
  options: SimulationRuntimeBenchmarkOptions,
  now?: () => number,
): Promise<
  Readonly<{
    configuration: Readonly<Record<string, string | number>>;
    structure: Readonly<Record<string, number>>;
    timings: Readonly<
      Record<string, Readonly<{ min: number; median: number; max: number }>>
    >;
    finalAuthority: Readonly<Record<string, number | string>>;
    passengerPhases?: Readonly<Record<string, PassengerRuntimePhaseSummary>>;
    passengerDestinationWaitingBreakdown?: PassengerDestinationWaitingBreakdown;
    measuredPassengerPhaseTotalMs?: number;
    unattributedSimulationMs?: number;
  }>
>;

export function summarizePassengerRuntimePhases(
  phaseDurations: Readonly<Record<string, readonly number[]>>,
  phaseWork: Readonly<Record<string, Readonly<Record<string, number>>>>,
  measuredTicks: number,
  wholeSimulationMilliseconds: number,
): Readonly<{
  passengerPhases: Readonly<Record<string, PassengerRuntimePhaseSummary>>;
  measuredPassengerPhaseTotalMs: number;
  unattributedSimulationMs: number;
}>;

export function summarizePassengerDestinationWaitingBreakdown(
  destinationWaitingTotalMs: number,
  destinationAllocationDurations: readonly number[],
  waitingActivationDurations: readonly number[],
  destinationAllocationWork: Readonly<Record<string, number>>,
  waitingActivationWork: Readonly<Record<string, number>>,
  residualDurations: Readonly<Record<string, readonly number[]>>,
  residualWork: Readonly<Record<string, Readonly<Record<string, number>>>>,
  measuredTicks: number,
  waitingActivationBreakdown?: PassengerWaitingActivationBreakdown,
): PassengerDestinationWaitingBreakdown;

export function summarizePassengerWaitingActivationBreakdown(
  waitingActivationTotalMs: number,
  durations: Readonly<Record<string, readonly number[]>>,
  work: Readonly<Record<string, Readonly<Record<string, number>>>>,
  measuredTicks: number,
): PassengerWaitingActivationBreakdown;
