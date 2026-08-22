export interface SimulationRuntimeBenchmarkOptions {
  readonly scenario: string;
  readonly runs: number;
  readonly ticks: number;
  readonly warmup: number;
  readonly passengerWorkWindow?: number;
  readonly json?: boolean;
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
  }>
>;
