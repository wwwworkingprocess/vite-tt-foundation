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

describe('foundation screen', () => {
  it('renders without a fatal application error', () => {
    cy.visit('/');
    cy.contains('h1', 'Torrevieja Tycoon').should('be.visible');
    cy.get('canvas').should('be.visible');
    cy.get('[data-testid="worker-status"]').should('contain.text', 'ready');
    cy.get('[data-testid="worker-tick"]').should('contain.text', '0');
    cy.contains('button', 'Normal 20×').click();
    cy.get('[data-testid="worker-tick"]').should(($tick) => {
      expect(Number($tick.text().split(': ')[1])).to.be.greaterThan(0);
    });
    cy.contains('button', 'Grant demo 2× bonus').click();
    cy.get('[data-testid="pacing-rate"]').should('contain.text', '40×');
    cy.get('[data-testid="bonus-ticks"]').should('not.contain.text', '24');
    cy.contains('button', 'Pause').click();
    cy.get('[data-testid="worker-tick"]')
      .invoke('text')
      .then((pausedTick) => {
        cy.wait(350);
        cy.get('[data-testid="worker-tick"]').should('have.text', pausedTick);
      });
    cy.contains('button', 'Close transport Worker').click();
    cy.get('[data-testid="worker-status"]').should('contain.text', 'closed');
    cy.contains('button', 'Start new transport session').click();
    cy.get('[data-testid="worker-status"]').should('contain.text', 'ready');
    cy.get('[data-testid="worker-timeline"]').should(
      'contain.text',
      'browser-foundation-timeline-2',
    );
  });

  it('keeps selection separate from authority and restores both scenarios', () => {
    cy.visit('/');
    cy.get('[data-testid="worker-status"]').should('contain.text', 'ready');
    cy.get('[data-testid="active-scenario"]').should(
      'contain.text',
      'torrevieja-v1',
    );
    cy.contains('button', 'Create demo vehicle').click();
    cy.get('[data-testid="vehicle-count"]').should('contain.text', '1');
    cy.contains('button', 'Create demo vehicle').click();
    cy.get('[data-testid="vehicle-count"]').should('contain.text', '2');
    cy.contains('button', 'Create demo vehicle').click();
    cy.get('[data-testid="vehicle-count"]').should('contain.text', '3');
    cy.contains('button', 'Start browser-demo-vehicle-001').click();
    cy.get('[data-testid="vehicle-movement"]').should(
      'contain.text',
      'running-at-stop',
    );
    cy.get('[data-testid="vehicle-movement-svg"]').should(
      'have.attr',
      'data-scenario-id',
      'torrevieja-v1',
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
    cy.contains('button', 'Pause').click();
    cy.get('[data-testid="pacing-status"]').should('contain.text', 'paused');
    cy.contains('button', 'Start browser-demo-vehicle-002').click();
    cy.contains('button', /^Normal /).click();
    cy.get('[data-testid="vehicle-row-browser-demo-vehicle-002"]').should(
      'have.attr',
      'data-movement-kind',
      'running-on-edge',
    );
    cy.contains('button', 'Pause').click();
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
    cy.contains('button', 'Save transport session').click();
    cy.get('[data-testid="manual-save-availability"]').should(
      'contain.text',
      'available',
    );

    cy.get('select').select('torrevieja-mini-v1');
    cy.get('[data-testid="selected-scenario"]').should(
      'contain.text',
      'torrevieja-mini-v1',
    );
    cy.get('[data-testid="active-scenario"]').should(
      'contain.text',
      'torrevieja-v1',
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
      'torrevieja-v1',
    );

    cy.contains('button', 'Close transport Worker').click();
    cy.contains('button', 'Start new transport session').click();
    cy.get('[data-testid="worker-status"]').should('contain.text', 'ready');
    cy.get('[data-testid="active-scenario"]').should(
      'contain.text',
      'torrevieja-mini-v1',
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
    cy.contains('button', 'Pause').click();
    cy.get('[data-testid="pacing-status"]').should('contain.text', 'paused');
    let miniTick = 0;
    let miniSvg: VehicleSvgState;
    cy.get('[data-testid="worker-tick"]').then(($tick) => {
      miniTick = Number($tick.text().split(': ')[1]);
    });
    vehicleSvgState().then((snapshot) => {
      miniSvg = snapshot;
      cy.wait(350);
      expectVehicleSvg(snapshot);
    });
    cy.contains('button', 'Save transport session').click();
    cy.get('[data-testid="manual-save-availability"]').should(
      'contain.text',
      'available',
    );
    cy.get('[data-testid="save-library"] [data-save-id]').should(
      'have.length',
      2,
    );

    restoreScenario('torrevieja-v1');
    cy.get('[data-testid="scenario-coordinate"]').should(
      'contain.text',
      'torrevieja-v1@1.0.0#',
    );
    cy.get('[data-testid="worker-tick"]').should(($tick) =>
      expect(Number($tick.text().split(': ')[1])).to.equal(fullTick),
    );
    cy.get('[data-testid="vehicle-count"]').should('contain.text', '3');
    cy.then(() => expectVehicleSvg(fullSvg));
    cy.get('[data-testid="command-revision"]').should('contain.text', '0');
    cy.get('[data-testid="stream-offset"]').should('contain.text', '0');

    restoreScenario('torrevieja-mini-v1');
    cy.get('[data-testid="scenario-coordinate"]').should(
      'contain.text',
      'torrevieja-mini-v1@1.0.0#',
    );
    cy.get('[data-testid="worker-tick"]').should(($tick) =>
      expect(Number($tick.text().split(': ')[1])).to.equal(miniTick),
    );
    cy.get('[data-testid="vehicle-movement-svg"]').should(
      'have.attr',
      'data-scenario-id',
      'torrevieja-mini-v1',
    );
    cy.get('[data-testid="vehicle-count"]').should('contain.text', '2');
    cy.then(() => expectVehicleSvg(miniSvg));
    cy.contains('button', /^Normal /).click();
    cy.get('[data-testid="worker-tick"]').should(($tick) =>
      expect(Number($tick.text().split(': ')[1])).to.be.greaterThan(miniTick),
    );
    cy.then(() =>
      vehicleSvgState().should((current) =>
        expect(current).not.to.deep.equal(miniSvg),
      ),
    );
    cy.contains('button', 'Pause').click();
    cy.get('[data-testid="pacing-status"]').should('contain.text', 'paused');
    vehicleSvgState().then((snapshot) => {
      cy.wait(350);
      expectVehicleSvg(snapshot);
    });
    cy.contains('button', 'Close transport Worker').click();
    cy.get('[data-testid="worker-status"]').should('contain.text', 'closed');
  });
});
