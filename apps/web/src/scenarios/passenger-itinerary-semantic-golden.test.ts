import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectItinerarySemanticDigests,
  publicItinerarySemanticDigest,
  selectItineraryMigrationDescriptors,
  type PassengerItinerarySemanticDigest,
} from '../../../../scripts/passenger-itinerary-semantic-golden.mjs';

interface Golden {
  readonly baselineCommit: string;
  readonly algorithm: string;
  readonly globalSha256: string;
  readonly scenarios: readonly PassengerItinerarySemanticDigest[];
}

describe('Passenger Direct Itinerary V1 to V2 public semantic golden', () => {
  it('preserves every accepted direct itinerary winner across all scenarios', async () => {
    const golden = JSON.parse(
      await readFile(
        join(
          import.meta.dirname,
          '..',
          '..',
          '..',
          '..',
          'scripts',
          'fixtures',
          'passenger-direct-itinerary-v1-semantic-golden.json',
        ),
        'utf8',
      ),
    ) as Golden;
    const actual = await collectItinerarySemanticDigests(
      golden.scenarios.map(({ scenarioId }) => scenarioId),
    );

    expect(golden.baselineCommit).toBe(
      '1ae260290ccf92f9c43d59c3a622b32442505633',
    );
    expect(golden.algorithm).toBe(
      'sha256(JSON.stringify(ordered direct-entry identity fields))',
    );
    expect(actual).toEqual(golden.scenarios);
    expect(actual).toHaveLength(76);
    expect(publicItinerarySemanticDigest(actual)).toBe(golden.globalSha256);
  }, 180_000);

  it('does not add future catalogue scenarios to the frozen migration cohort', () => {
    const baseline = [{ scenarioId: 'baseline' }];
    const catalogue = {
      scenarios: [...baseline, { scenarioId: 'future-v2-only' }],
    };

    expect(
      selectItineraryMigrationDescriptors(catalogue, ['baseline']),
    ).toEqual(baseline);
    expect(() =>
      selectItineraryMigrationDescriptors(catalogue, ['missing-baseline']),
    ).toThrow(/missing-baseline/);
  });
});
