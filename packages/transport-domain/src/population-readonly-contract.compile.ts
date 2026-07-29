import type {
  ActivePopulationCell,
  CityPopulationGrid,
} from './city-population-grid.js';
import type { StopCatchmentResult } from './stop-catchment.js';

export function assertPopulationReadonlyContracts(
  grid: CityPopulationGrid,
  cell: ActivePopulationCell,
  result: StopCatchmentResult,
) {
  // @ts-expect-error population matrix rows are deeply readonly
  grid.populationWeights.push([]);
  // @ts-expect-error population matrix values are deeply readonly
  grid.populationWeights[0]![0] = 1;
  // @ts-expect-error cell centres are deeply readonly
  cell.center.latitude = 0;
  // @ts-expect-error assignment arrays are deeply readonly
  result.cellAssignments.push(result.cellAssignments[0]!);
  // @ts-expect-error assignment centres are deeply readonly
  result.cellAssignments[0]!.center.longitude = 0;
  // @ts-expect-error stop summaries are deeply readonly
  result.stopSummaries[0]!.assignedPopulationWeight = 0;
  // @ts-expect-error coverage is deeply readonly
  result.coverage.coverageBasisPoints = 0;
}
