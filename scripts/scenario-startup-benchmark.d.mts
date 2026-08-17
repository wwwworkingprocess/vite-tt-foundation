export interface ScenarioStartupBenchmarkOptions {
  readonly scenario?: string;
  readonly city?: string;
  readonly all?: boolean;
  readonly runs: number;
  readonly json: boolean;
}

export function parseScenarioStartupBenchmarkArguments(
  values: readonly string[],
): ScenarioStartupBenchmarkOptions;

export function runScenarioStartupBenchmark(
  options: ScenarioStartupBenchmarkOptions,
): Promise<
  readonly Readonly<{
    scenarioId: string;
    cityDirectory: string;
    runCount: number;
    demandModelContentHash: string;
    structure: Readonly<Record<string, number>>;
    startupTimingsMilliseconds: Readonly<
      Record<string, Readonly<{ min: number; median: number; max: number }>>
    >;
    diagnosticTimingsMilliseconds: Readonly<
      Record<string, Readonly<{ min: number; median: number; max: number }>>
    >;
  }>[]
>;
