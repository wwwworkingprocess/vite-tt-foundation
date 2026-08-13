import { expect, it } from 'vitest';
import { productionPassengerDemandPolicyV1 } from './population-demand-plan.js';

it('promotes the accepted deterministic development-seed policy unchanged', () => {
  expect(productionPassengerDemandPolicyV1).toEqual({
    catchmentPolicy: { maxAccessDistanceCells: 5 },
    emissionPolicy: {
      emissionCreditsPerWeightPerTick: 1,
      creditsPerPassenger: 50_000,
    },
    accessPolicy: { accessTicksPerCell: 1 },
  });
  expect(Object.isFrozen(productionPassengerDemandPolicyV1)).toBe(true);
});
