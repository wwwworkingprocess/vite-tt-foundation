import { createPassengerDemandPlan } from '@torrevieja-tycoon/simulation';
import {
  buildStopCatchments,
  type CanonicalScenario,
} from '@torrevieja-tycoon/transport-domain';
import type { ScenarioPopulationView } from './population-field-loader.js';

export const productionPassengerDemandPolicyV1 = Object.freeze({
  catchmentPolicy: Object.freeze({ maxAccessDistanceCells: 5 }),
  emissionPolicy: Object.freeze({
    emissionCreditsPerWeightPerTick: 1,
    creditsPerPassenger: 50_000,
  }),
  accessPolicy: Object.freeze({ accessTicksPerCell: 1 }),
});

export const createProductionPassengerDemandPlan = (input: {
  readonly scenario: CanonicalScenario;
  readonly population: ScenarioPopulationView;
}) => {
  if (
    input.population.operationalCropPolicy.maxAccessDistanceCells !==
    productionPassengerDemandPolicyV1.catchmentPolicy.maxAccessDistanceCells
  )
    throw new Error(
      'Operational population crop policy does not match passenger catchment policy.',
    );
  return createPassengerDemandPlan({
    catchment: buildStopCatchments({
      grid: input.population.grid,
      scenario: input.scenario,
      maxAccessDistanceCells:
        productionPassengerDemandPolicyV1.catchmentPolicy
          .maxAccessDistanceCells,
    }),
    demandModelContentHash: input.population.demandModelContentHash,
    emissionPolicy: productionPassengerDemandPolicyV1.emissionPolicy,
    accessPolicy: productionPassengerDemandPolicyV1.accessPolicy,
  });
};
