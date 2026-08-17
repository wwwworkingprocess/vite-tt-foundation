export function scenarioCityDirectory(primarySettlementName: string): string;

export function validateScenarioCityDirectory(input: {
  readonly scenarioId: string;
  readonly primarySettlementName: string;
  readonly manifestPath: string;
}): string;
