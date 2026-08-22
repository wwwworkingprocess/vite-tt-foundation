export interface PassengerEmissionRuntimeBenchmarkOptions {
  readonly warmup?: number;
  readonly ticks?: number;
}

export const passengerEmissionBenchmarkScenarios: readonly string[];

export function runPassengerEmissionRuntimeBenchmark(
  scenarioId: string,
  options?: PassengerEmissionRuntimeBenchmarkOptions,
  now?: () => number,
): Promise<Readonly<Record<string, unknown>>>;
