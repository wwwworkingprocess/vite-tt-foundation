import { createRepresentationProfileResult } from '../../apps/web/src/performance/representation-profile-summary.js';
import { representationProfilePrefix } from '../../apps/web/src/performance/representation-profiler.js';

const scenarios = [
  { id: 'torrevieja-legacy-abc-v1', city: 'Torrevieja' },
  { id: 'cartagena-radial-legacy-all-v1', city: 'Cartagena' },
  { id: 'malaga-day-legacy-all-v1', city: 'Málaga' },
] as const;
const warmupMs = 1_000;
const observationMs = 3_000;
const results: unknown[] = [];

const tick = () =>
  cy
    .get('[data-testid="worker-tick"]')
    .invoke('text')
    .then((text) => Number(text.split(': ')[1]));

const openSimulationControls = () => {
  cy.contains('button', 'Simulation controls').click();
  cy.get('[data-testid="simulation-controls-content"]').should('exist');
};

const closeDialog = () =>
  cy.get('[role="dialog"] button[aria-label^="Close "]').click();

const setToggle = (kind: 'population' | 'passengers', visible: boolean) => {
  const desired = `${visible ? 'Show' : 'Hide'} ${kind}`;
  cy.get('body').then(($body) => {
    const button = [...$body.find('button')].find(
      (candidate) => candidate.textContent === desired,
    );
    if (button) cy.wrap(button).click();
  });
};

const setSvgMode = (mode: 'mini' | 'normal') => {
  cy.get('[data-view="transport"]').then(($surface) => {
    if ($surface.attr('data-representation-mode') !== mode)
      cy.contains('button', 'Swap visualizations').click();
  });
  cy.get('[data-view="transport"]').should(
    'have.attr',
    'data-representation-mode',
    mode,
  );
};

const selectAndStart = (scenario: (typeof scenarios)[number]) => {
  cy.visit('/?profile-performance=1');
  cy.get('[data-testid="open-screen"]', { timeout: 15_000 }).should(
    'be.visible',
  );
  cy.get('select[aria-label="City"]').select(scenario.city);
  cy.contains('label', 'Scenario').find('select').select(scenario.id);
  cy.contains('button', 'Start new game').should('be.enabled').click();
  cy.get('[data-testid="game-shell"]', { timeout: 20_000 }).should(
    'be.visible',
  );
  cy.get('[data-testid="vehicle-movement-svg"]', { timeout: 20_000 }).should(
    'have.attr',
    'data-scenario-id',
    scenario.id,
  );
  openSimulationControls();
  cy.contains('button', 'Normal 20×').click();
  closeDialog();
};

const profile = (input: {
  scenarioId: string;
  mode: 'mini' | 'normal';
  passengersVisible: boolean;
  populationVisible: boolean;
}) => {
  cy.contains('button', 'Restart').should('be.enabled').click();
  cy.get('[data-testid="vehicle-movement-svg"]', { timeout: 20_000 }).should(
    'have.attr',
    'data-scenario-id',
    input.scenarioId,
  );
  openSimulationControls();
  const passengerAuthority =
    input.scenarioId === 'torrevieja-legacy-abc-v1' &&
    input.mode === 'normal' &&
    !input.populationVisible;
  if (passengerAuthority) {
    cy.contains('button', 'Maximum 60×').click();
    cy.get('[data-testid="worker-tick"]', { timeout: 60_000 }).should(
      ($tick) => {
        expect(Number($tick.text().split(': ')[1])).to.be.at.least(200);
      },
    );
    cy.contains('button', 'Create demo vehicle').click();
    cy.get('[data-testid="vehicle-count"]').should('not.contain.text', ': 0');
  }
  cy.contains('button', 'Normal 20×').click();
  closeDialog();
  setSvgMode(input.mode);
  setToggle('passengers', input.passengersVisible);
  setToggle('population', input.populationVisible);
  cy.wait(warmupMs);
  cy.get('[data-testid="vehicle-movement-svg"]').then(($svg) => {
    const primitiveSnapshot = {
      routeEdgePrimitives: Number($svg.attr('data-directed-edge-count')),
      stopPlaceMarkers: new Set(
        $svg
          .find('[data-testid="passenger-stop-status"]')
          .toArray()
          .map((element) => element.getAttribute('data-stop-place-id')),
      ).size,
      passengerStopStatusCircles: $svg.find(
        '[data-testid="passenger-stop-status"]',
      ).length,
      vehicleMarkers: $svg.find('[data-testid="vehicle-position"]').length,
      waitingLabels: $svg.find('[data-testid="stop-waiting-passenger-count"]')
        .length,
      onboardLabels: $svg.find(
        '[data-testid="vehicle-onboard-passenger-count"]',
      ).length,
      arrivalPulses: $svg.find('[data-testid="passenger-arrival-pulse"]')
        .length,
      populationPrimitives: Cypress.$('[data-testid="population-band"]').length,
    };
    openSimulationControls();
    tick().then((startTick) => {
      closeDialog();
      cy.window().then((window) => {
        for (const entry of window.performance.getEntriesByType('mark'))
          if (entry.name.startsWith(representationProfilePrefix))
            window.performance.clearMarks(entry.name);
        for (const entry of window.performance.getEntriesByType('measure'))
          if (entry.name.startsWith(representationProfilePrefix))
            window.performance.clearMeasures(entry.name);
      });
      cy.wait(observationMs);
      openSimulationControls();
      tick().then((endTick) => {
        closeDialog();
        cy.window().then((window) => {
          const entries = [
            ...window.performance.getEntriesByType('mark'),
            ...window.performance.getEntriesByType('measure'),
          ]
            .filter(({ name }) => name.startsWith(representationProfilePrefix))
            .map((entry) => ({
              name: entry.name,
              entryType: entry.entryType,
              duration: entry.duration,
              detail: (entry as PerformanceMark | PerformanceMeasure).detail as
                Record<string, unknown> | undefined,
            }));
          results.push(
            createRepresentationProfileResult({
              scenarioId: input.scenarioId,
              representationMode: input.mode,
              passengersVisible: input.passengersVisible,
              populationVisible: input.populationVisible,
              threePrimary: input.mode === 'mini',
              observationDurationMs: observationMs,
              startTick,
              endTick,
              entries,
              primitiveSnapshot,
            }),
          );
        });
      });
    });
  });
};

describe('finite representation runtime profile', () => {
  for (const scenario of scenarios) {
    it(`profiles ${scenario.id}`, () => {
      selectAndStart(scenario);
      const variants =
        scenario.id === 'torrevieja-legacy-abc-v1'
          ? ([
              ['mini', true, true],
              ['mini', true, false],
              ['mini', false, true],
              ['mini', false, false],
              ['normal', true, true],
              ['normal', true, false],
              ['normal', false, true],
              ['normal', false, false],
            ] as const)
          : ([
              ['normal', true, true],
              ['normal', false, false],
            ] as const);
      for (const [mode, passengersVisible, populationVisible] of variants)
        profile({
          scenarioId: scenario.id,
          mode,
          passengersVisible,
          populationVisible,
        });
    });
  }

  after(() => cy.task('writeRepresentationProfiles', results));
});
