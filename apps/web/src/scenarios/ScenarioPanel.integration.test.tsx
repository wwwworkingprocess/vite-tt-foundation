import { expect, it } from 'vitest';
import { createCityScenarioGroups } from '../ui/open-screen-model.js';

it('groups production presentation by primary settlement identity', () => {
  const groups = createCityScenarioGroups(
    {
      scenarios: [
        { scenarioId: 'a', title: 'A', primarySettlementId: 'city-a' },
        { scenarioId: 'b', title: 'B', primarySettlementId: 'city-b' },
      ],
    } as never,
    { 'city-a': 'City A' },
  );
  expect(groups.map(({ name }) => name)).toEqual(['City A', 'city-b']);
});
