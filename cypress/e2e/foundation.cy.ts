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
  cy.get('[data-testid="vehicle-position"]').should(($vehicles) => {
    const current = [...$vehicles].map((vehicle) => ({
      vehicleId: vehicle.getAttribute('data-vehicle-id'),
      movementKind: vehicle.getAttribute('data-movement-kind'),
      edgeId: vehicle.getAttribute('data-edge-id'),
      progressNumerator: vehicle.getAttribute('data-progress-numerator'),
      progressDenominator: vehicle.getAttribute('data-progress-denominator'),
      cx: vehicle.getAttribute('cx'),
      cy: vehicle.getAttribute('cy'),
    }));
    expect(current).to.deep.equal(expected);
  });
const expectVehicleSvgToChange = (expected: VehicleSvgState) =>
  cy.get('[data-testid="vehicle-position"]').should(($vehicles) => {
    const current = [...$vehicles].map((vehicle) => ({
      vehicleId: vehicle.getAttribute('data-vehicle-id'),
      movementKind: vehicle.getAttribute('data-movement-kind'),
      edgeId: vehicle.getAttribute('data-edge-id'),
      progressNumerator: vehicle.getAttribute('data-progress-numerator'),
      progressDenominator: vehicle.getAttribute('data-progress-denominator'),
      cx: vehicle.getAttribute('cx'),
      cy: vehicle.getAttribute('cy'),
    }));
    expect(current).not.to.deep.equal(expected);
  });
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
const restoreReadyTimeoutMs = 60_000;
const representationSettleMs = 250;
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
    cy.get('[data-testid="primary-visualization"]')
      .should('have.attr', 'data-family', 'dom2d')
      .and('have.attr', 'data-view', 'map');
    cy.get('[data-testid="secondary-minimap"]')
      .should('have.attr', 'data-family', 'd3d')
      .and('have.attr', 'data-view', 'main');
    cy.get('[data-testid="canvas2d-representation"]').should('not.exist');
    cy.get('[data-testid="scenario-menu-trigger"]').click();
    cy.get('.scenario-menu-panel').then(($menu) => {
      cy.get('.mini-representation-boundary').then(($miniBoundary) => {
        expect(Number(getComputedStyle($menu[0]).zIndex)).to.be.greaterThan(
          Number(getComputedStyle($miniBoundary[0]).zIndex),
        );
      });
    });
    cy.document()
      .its('documentElement.scrollHeight')
      .then((height) => {
        cy.window().its('innerHeight').should('equal', height);
      });
    cy.get('[data-testid="scenario-menu-trigger"]').click();
    cy.get('button[aria-label="Select mini representation for swap"]').click();
    cy.contains('button', 'Use Canvas 2D in mini').should('be.visible').click();
    cy.get('[data-testid="primary-visualization"]')
      .should('have.attr', 'data-family', 'dom2d')
      .and('have.attr', 'data-representation-mode', 'normal');
    cy.get('[data-testid="secondary-minimap"]')
      .should('have.attr', 'data-family', 'canvas2d')
      .and('have.attr', 'data-view', 'map')
      .and('have.attr', 'data-representation-mode', 'mini');
    cy.get('[data-testid="canvas2d-representation"]').should('be.visible');
    cy.get('[aria-label="Three-dimensional renderer smoke test"]').should(
      'not.exist',
    );
    cy.contains('button', 'Hide population').click();
    cy.contains('button', 'Hide passengers').click();
    cy.get('button[aria-label="Select mini representation for swap"]').click();
    cy.contains('button', 'Swap visualizations').click();
    cy.get('[data-testid="primary-visualization"]')
      .should('have.attr', 'data-family', 'canvas2d')
      .and('have.attr', 'data-view', 'map');
    cy.get('[data-testid="secondary-minimap"]')
      .should('have.attr', 'data-family', 'dom2d')
      .and('have.attr', 'data-view', 'map');
    cy.contains('button', 'Show population').should('be.visible').click();
    cy.contains('button', 'Show passengers').should('be.visible').click();
    cy.get('button[aria-label="Select mini representation for swap"]').click();
    cy.contains('button', 'Swap visualizations').click();
    cy.contains('button', 'Hide population').should('be.visible');
    cy.contains('button', 'Hide passengers').should('be.visible');
    cy.get('button[aria-label="Select mini representation for swap"]').click();
    cy.contains('button', 'Swap visualizations').click();
    cy.get('[data-testid="canvas2d-representation"]')
      .should('have.attr', 'tabindex', '0')
      .focus()
      .type('{home}{enter}');
    cy.get('[role="dialog"]')
      .should('contain.text', 'Stop overview')
      .find('button')
      .contains('Close')
      .click();
    cy.get('[data-testid="stop-inspector"]').should('exist');
    cy.get('[data-testid="canvas2d-representation"]')
      .should('have.focus')
      .type('{enter}');
    cy.get('[role="dialog"]')
      .should('contain.text', 'Stop overview')
      .find('button')
      .contains('Close')
      .click();
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
    cy.wait(representationSettleMs);
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
    cy.wait(representationSettleMs);
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
    expectVehicleSvgToChange(secondarySvg);
    cy.get('[role="dialog"]').contains('button', 'Pause').click();
    cy.get('[data-testid="pacing-status"]').should('contain.text', 'paused');
    cy.wait(representationSettleMs);
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
