export interface PassengerWorkWindowAuditResult {
  readonly scenarioId: string;
  readonly windows: readonly Readonly<Record<string, string | number | null>>[];
}
export const passengerWorkWindowAuditScenarios: readonly string[];
export const passengerWorkWindowAuditCheckpoints: readonly number[];
export function runPassengerWorkWindowAudit(
  now?: () => number,
): Promise<readonly PassengerWorkWindowAuditResult[]>;
