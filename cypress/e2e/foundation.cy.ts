type VehicleSvgState = readonly Readonly<Record<string, string | null>>[];
const vehicleSvgState = (): Cypress.Chainable<VehicleSvgState> =>
  cy.get('[data-testid="vehicle-position"]').then(($vehicles) =>
    [...$vehicles].map((vehicle) => ({
      vehicleId: vehicle.getAttribute('data-vehicle-id'),
      movementKind: vehicle.getAttribute('data-movement-kind'),
      edgeId: vehicle.getAttribute('data-edge-id'),
      progressNumerator: vehicle.getAttribute('data-progress-numerator'),
      progressDenominator: vehicle.getAttribute('data-progress-denominator'),
      cx: vehicle.getAttribute('cx'),
      cy: vehicle.getAttribute('cy'),
    })),
  );
const expectVehicleSvg = (expected: VehicleSvgState) =>
  vehicleSvgState().should('deep.equal', expected);
const restoreScenario = (scenarioId: string) =>
  cy
    .contains('[data-save-id]', scenarioId)
    .contains('button', 'Restore')
    .click();
const openDialog = (name: 'Simulation controls' | 'Load') => {
  cy.get('body').then(($body) => {
    const close = $body.find('[role="dialog"] button[aria-label^="Close "]');
    if (close.length) cy.wrap(close).click();
  });
  cy.contains('button', name).click();
};
const openSimulationControls = () => openDialog('Simulation controls');
const openSessionControls = () => openDialog('Load');
const restoreReadyTimeoutMs = 15_000;
const expectRestoredAuthority = (scenarioId: string) => {
  cy.get('[data-testid="worker-timeline"]', {
    timeout: restoreReadyTimeoutMs,
  }).should('contain.text', 'browser-foundation-restored-');
  cy.get('[data-testid="scenario-coordinate"]', {
    timeout: restoreReadyTimeoutMs,
  }).should('contain.text', `${scenarioId}@1.0.0#`);
  cy.get('[data-testid="worker-status"]', {
    timeout: restoreReadyTimeoutMs,
  }).should('contain.text', 'ready');
};
const startDefaultGame = () => {
  cy.get('[data-testid="open-screen"]', { timeout: 15_000 }).should(
    'be.visible',
  );
  cy.contains('button', 'Start new game', { timeout: 15_000 })
    .should('be.enabled')
    .click();
  cy.get('[data-testid="game-shell"]', { timeout: 15_000 }).should(
    'be.visible',
  );
};

describe('foundation screen', () => {
  it('renders without a fatal application error', () => {
    cy.visit('/');
    cy.contains('h1', 'Torrevieja Tycoon').should('be.visible');
    cy.get('[data-testid="open-screen"]').should('be.visible');
    cy.get('[data-testid="game-shell"]').should('not.exist');
    startDefaultGame();
    cy.get('[data-testid="top-navigation"]').should('be.visible');
    cy.get('[data-testid="primary-visualization"]').should(
      'have.attr',
      'data-view',
      'transport',
    );
    cy.get('[data-testid="secondary-minimap"]').should(
      'have.attr',
      'data-view',
      'three',
    );
    cy.get('[data-testid="scenario-menu-trigger"]').click();
    cy.get('.scenario-menu-panel').then(($menu) => {
      cy.get('[data-testid="secondary-minimap"]').then(($minimap) => {
        expect(Number(getComputedStyle($menu[0]).zIndex)).to.be.greaterThan(
          Number(getComputedStyle($minimap[0]).zIndex),
        );
      });
    });
    cy.document()
      .its('documentElement.scrollHeight')
      .then((height) => {
        cy.window().its('innerHeight').should('equal', height);
      });
    cy.contains('button', 'Swap visualizations').click();
    cy.get('[data-testid="primary-visualization"]').should(
      'have.attr',
      'data-view',
      'three',
    );
    cy.contains('button', 'Project info').focus().click();
    cy.get('[role="dialog"]').should('contain.text', 'Project foundation');
    cy.get('body').type('{esc}');
    cy.contains('button', 'Project info').should('have.focus');
    openSimulationControls();
    cy.get('canvas').should('be.visible');
    cy.get('[data-testid="simulation-controls-content"]').should('exist');
    cy.get('[data-testid="save-library"]').should('not.exist');
    cy.get('[data-testid="worker-status"]').should('contain.text', 'ready');
    cy.get('[data-testid="worker-tick"]').should('contain.text', '0');
    cy.contains('button', 'Normal 20×').click();
    cy.get('[data-testid="worker-tick"]').should(($tick) => {
      expect(Number($tick.text().split(': ')[1])).to.be.greaterThan(0);
    });
    cy.contains('button', 'Grant demo 2× bonus').click();
    cy.get('[data-testid="pacing-rate"]').should('contain.text', '40×');
    cy.get('[data-testid="bonus-ticks"]').should('not.contain.text', '24');
    cy.get('[role="dialog"]').contains('button', 'Pause').click();
    cy.get('[data-testid="worker-tick"]')
      .invoke('text')
      .then((pausedTick) => {
        cy.wait(350);
        cy.get('[data-testid="worker-tick"]').should('have.text', pausedTick);
      });
    cy.get('button[aria-label="Close Simulation controls"]').click();
    cy.contains('button', 'Save').click();
    cy.get('.navigation-status').should('contain.text', 'Save completed.');
    openSessionControls();
    cy.get('[data-testid="session-controls-content"]').should('be.visible');
    cy.get('[data-testid="save-library"]').should('exist');
    cy.get('[data-testid="worker-tick"]').should('not.exist');
    cy.contains('button', 'Close transport Worker').click();
    openSimulationControls();
    cy.get('[data-testid="worker-status"]').should('contain.text', 'closed');
    openSessionControls();
    cy.contains('button', 'Start new transport session').click();
    openSimulationControls();
    cy.get('[data-testid="worker-status"]').should('contain.text', 'ready');
    cy.get('[data-testid="worker-timeline"]').should(
      'contain.text',
      'browser-foundation-timeline-2',
    );
  });

  it('keeps selection separate from authority and restores both scenarios', () => {
    cy.visit('/');
    startDefaultGame();
    cy.get('[data-testid="scenario-menu-trigger"]').click();
    openSimulationControls();
    cy.get('[data-testid="worker-status"]').should('contain.text', 'ready');
    cy.get('[data-testid="active-scenario"]').should(
      'contain.text',
      'torrevieja-legacy-abc-v1',
    );
    cy.get('[data-testid="route-list"] [data-route-id]').should(
      'have.length',
      3,
    );
    cy.contains('[data-testid="route-list"]', 'A — Torrevieja - La Mata');
    cy.contains('label', 'Vehicle route').find('select').select('legacy-A');
    cy.contains('button', 'Create demo vehicle').click();
    cy.get('[data-testid="vehicle-count"]').should('contain.text', '1');
    cy.contains('label', 'Vehicle route').find('select').select('legacy-B');
    cy.contains('button', 'Create demo vehicle').click();
    cy.get('[data-testid="vehicle-count"]').should('contain.text', '2');
    cy.contains('label', 'Vehicle route').find('select').select('legacy-C');
    cy.contains('button', 'Create demo vehicle').click();
    cy.get('[data-testid="vehicle-count"]').should('contain.text', '3');
    cy.get('[role="dialog"]').contains('button', 'Pause').click();
    cy.get('[data-testid="pacing-status"]').should('contain.text', 'paused');
    cy.contains('button', 'Start browser-demo-vehicle-001').click();
    cy.get('[data-testid="vehicle-movement"]').should(
      'contain.text',
      'running-at-stop',
    );
    cy.get('[data-testid="vehicle-movement-svg"]').should(
      'have.attr',
      'data-scenario-id',
      'torrevieja-legacy-abc-v1',
    );
    cy.get('[data-testid="vehicle-row-browser-demo-vehicle-001"]').should(
      'have.attr',
      'data-route-id',
      'legacy-A',
    );
    cy.get('[data-testid="vehicle-row-browser-demo-vehicle-002"]').should(
      'have.attr',
      'data-route-id',
      'legacy-B',
    );
    cy.get('[data-testid="vehicle-row-browser-demo-vehicle-003"]').should(
      'have.attr',
      'data-route-id',
      'legacy-C',
    );
    let initialVehiclePosition = '';
    cy.get('[data-testid="vehicle-position"]').then(($vehicle) => {
      initialVehiclePosition = `${$vehicle.attr('cx')}:${$vehicle.attr('cy')}`;
    });
    cy.contains('button', /^Normal /).click();
    cy.get('[data-testid="worker-tick"]').should(($tick) =>
      expect(Number($tick.text().split(': ')[1])).to.be.greaterThan(0),
    );
    cy.get('[data-testid="vehicle-position"]').should(($vehicle) =>
      expect(`${$vehicle.attr('cx')}:${$vehicle.attr('cy')}`).not.to.equal(
        initialVehiclePosition,
      ),
    );
    cy.get('[role="dialog"]').contains('button', 'Pause').click();
    cy.get('[data-testid="pacing-status"]').should('contain.text', 'paused');
    cy.contains('button', 'Start browser-demo-vehicle-002').click();
    cy.contains('button', /^Normal /).click();
    cy.get('[data-testid="vehicle-row-browser-demo-vehicle-002"]').should(
      'have.attr',
      'data-movement-kind',
      'running-on-edge',
    );
    cy.get('[role="dialog"]').contains('button', 'Pause').click();
    cy.get('[data-testid="pacing-status"]').should('contain.text', 'paused');
    let fullTick = 0;
    let fullTimeline = '';
    let fullSvg: VehicleSvgState;
    cy.get('[data-testid="worker-tick"]').then(($tick) => {
      fullTick = Number($tick.text().split(': ')[1]);
    });
    cy.get('[data-testid="worker-timeline"]').then(($timeline) => {
      fullTimeline = $timeline.text();
    });
    vehicleSvgState().then((snapshot) => {
      fullSvg = snapshot;
      cy.wait(350);
      expectVehicleSvg(snapshot);
    });
    openSessionControls();
    cy.contains('button', 'Save transport session').click();
    cy.get('[data-testid="manual-save-availability"]').should(
      'contain.text',
      'available',
    );
    openSimulationControls();

    cy.intercept(
      {
        method: 'GET',
        url: '**/torrevieja-legacy-east-v1/scenario.json',
        times: 1,
      },
      (request) => {
        request.continue((response) => response.setDelay(5_000));
      },
    ).as('loadSecondarySelection');
    cy.contains('label', 'Scenario')
      .find('select')
      .select('torrevieja-legacy-east-v1', { force: true });
    cy.get('[data-testid="requested-scenario"]').should(
      'contain.text',
      'torrevieja-legacy-east-v1 (loading)',
    );
    cy.get('[data-testid="active-scenario"]').should(
      'contain.text',
      'torrevieja-legacy-abc-v1',
    );
    cy.get('[data-testid="worker-timeline"]').should(($timeline) =>
      expect($timeline.text()).to.equal(fullTimeline),
    );
    cy.get('[data-testid="worker-tick"]').should(($tick) =>
      expect(Number($tick.text().split(': ')[1])).to.equal(fullTick),
    );
    cy.get('[data-testid="vehicle-movement-svg"]').should(
      'have.attr',
      'data-scenario-id',
      'torrevieja-legacy-abc-v1',
    );

    openSessionControls();
    cy.contains('button', 'Close transport Worker').click();
    cy.contains('button', 'Start new transport session').should('be.disabled');
    cy.wait('@loadSecondarySelection');
    openSimulationControls();
    cy.get('[data-testid="selected-scenario"]').should(
      'contain.text',
      'torrevieja-legacy-east-v1',
    );
    openSessionControls();
    cy.contains('button', 'Start new transport session')
      .should('be.enabled')
      .click();
    openSimulationControls();
    cy.get('[data-testid="worker-status"]').should('contain.text', 'ready');
    cy.get('[data-testid="active-scenario"]').should(
      'contain.text',
      'torrevieja-legacy-east-v1',
    );
    cy.contains('button', 'Create demo vehicle').click();
    cy.get('[data-testid="vehicle-count"]').should('contain.text', '1');
    cy.contains('button', 'Create demo vehicle').click();
    cy.get('[data-testid="vehicle-count"]').should('contain.text', '2');
    cy.contains('button', 'Start browser-demo-vehicle-001').click();
    cy.contains('button', /^Normal /).click();
    cy.get('[data-testid="worker-tick"]').should(($tick) =>
      expect(Number($tick.text().split(': ')[1])).to.be.greaterThan(0),
    );
    cy.get('[role="dialog"]').contains('button', 'Pause').click();
    cy.get('[data-testid="pacing-status"]').should('contain.text', 'paused');
    let secondaryTick = 0;
    let secondarySvg: VehicleSvgState;
    cy.get('[data-testid="worker-tick"]').then(($tick) => {
      secondaryTick = Number($tick.text().split(': ')[1]);
    });
    vehicleSvgState().then((snapshot) => {
      secondarySvg = snapshot;
      cy.wait(350);
      expectVehicleSvg(snapshot);
    });
    openSessionControls();
    cy.contains('button', 'Save transport session').click();
    cy.get('[data-testid="manual-save-availability"]').should(
      'contain.text',
      'available',
    );
    cy.get('[data-testid="save-library"] [data-save-id]').should(
      'have.length',
      2,
    );

    restoreScenario('torrevieja-legacy-abc-v1');
    openSimulationControls();
    expectRestoredAuthority('torrevieja-legacy-abc-v1');
    cy.get('[data-testid="worker-tick"]').should(($tick) =>
      expect(Number($tick.text().split(': ')[1])).to.equal(fullTick),
    );
    cy.get('[data-testid="vehicle-count"]').should('contain.text', '3');
    cy.then(() => expectVehicleSvg(fullSvg));
    cy.get('[data-testid="command-revision"]').should('contain.text', '0');
    cy.get('[data-testid="stream-offset"]').should('contain.text', '0');
    openSessionControls();
    cy.get('[data-testid="persistence-status"]').should(
      'have.text',
      'Persistence status: idle',
    );
    restoreScenario('torrevieja-legacy-east-v1');
    openSimulationControls();
    expectRestoredAuthority('torrevieja-legacy-east-v1');
    cy.get('[data-testid="worker-tick"]').should(($tick) =>
      expect(Number($tick.text().split(': ')[1])).to.equal(secondaryTick),
    );
    cy.get('[data-testid="vehicle-movement-svg"]').should(
      'have.attr',
      'data-scenario-id',
      'torrevieja-legacy-east-v1',
    );
    cy.get('[data-testid="vehicle-count"]').should('contain.text', '2');
    cy.then(() => expectVehicleSvg(secondarySvg));
    cy.contains('button', /^Normal /).click();
    cy.get('[data-testid="worker-tick"]').should(($tick) =>
      expect(Number($tick.text().split(': ')[1])).to.be.greaterThan(
        secondaryTick,
      ),
    );
    cy.then(() =>
      vehicleSvgState().should((current) =>
        expect(current).not.to.deep.equal(secondarySvg),
      ),
    );
    cy.get('[role="dialog"]').contains('button', 'Pause').click();
    cy.get('[data-testid="pacing-status"]').should('contain.text', 'paused');
    vehicleSvgState().then((snapshot) => {
      cy.wait(350);
      expectVehicleSvg(snapshot);
    });
    openSessionControls();
    cy.contains('button', 'Close transport Worker').click();
    openSimulationControls();
    cy.get('[data-testid="worker-status"]').should('contain.text', 'closed');
  });
});
