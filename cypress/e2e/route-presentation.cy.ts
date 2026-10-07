const closeDetails = () =>
  cy.get('[role="dialog"]').contains('button', 'Close').click();
const swap = () => {
  cy.get('button[aria-label="Select mini representation for swap"]').click();
  cy.contains('button', 'Swap visualizations').click();
};

it('shares all-lines enrichment and retains focus/selection through entity details and renderer swaps', () => {
  cy.intercept('GET', '**/route-presentation/torrevieja/*.json').as(
    'routeAsset',
  );
  cy.visit('/');
  cy.get('[data-testid="open-screen"]', { timeout: 15000 }).should(
    'be.visible',
  );
  cy.contains('label', 'Scenario')
    .find('select')
    .select('torrevieja-legacy-all-v1');
  cy.contains('button', 'Start new game').should('be.enabled').click();
  cy.get('[data-testid="game-shell"]', { timeout: 15000 }).should('be.visible');
  cy.wait('@routeAsset');
  cy.get('[data-testid="vehicle-movement-svg"] polyline[data-edge-id]').should(
    'have.length',
    244,
  );
  cy.get('[data-edge-group-id][data-route-id="legacy-A"]')
    .first()
    .should('have.attr', 'opacity', '0.8');
  cy.get('[aria-label="Routes"] [data-route-id="legacy-A"]').click();
  cy.contains('button', 'Add bus').should('be.enabled').click();
  cy.get('[data-edge-group-id][data-route-id="legacy-A"]')
    .first()
    .should('have.attr', 'opacity', '1');
  cy.get('polyline[data-route-id="legacy-A"]')
    .first()
    .should('have.attr', 'stroke', '#D32F2F')
    .should(($line) =>
      expect($line.attr('points')!.split(' ').length).to.be.greaterThan(2),
    );
  cy.get('[data-edge-group-id][data-route-id="legacy-B"]')
    .first()
    .should('have.attr', 'opacity', '0.8');
  cy.contains('button', 'Focus route').click();
  cy.get('[data-testid="vehicle-movement-svg"]').should(
    'have.attr',
    'data-map-viewport',
    'route',
  );
  cy.get('[data-testid="vehicle-movement-svg"]').then(($map) => {
    cy.get('svg[aria-label="Operational population grid"]').should(
      'have.attr',
      'viewBox',
      $map.attr('viewBox'),
    );
  });
  cy.get(
    '[data-testid="vehicle-movement-svg"] [data-stop-node-id="tv-stop-0137"]',
  )
    .first()
    .focus();
  cy.press(Cypress.Keyboard.Keys.ENTER);
  closeDetails();
  cy.get('[aria-label="Transport routes"]').should(
    'have.attr',
    'data-focused-route-id',
    'legacy-A',
  );
  cy.get('[data-testid="vehicle-position"]').first().click();
  closeDetails();
  cy.get('[aria-label="Transport routes"]').should(
    'have.attr',
    'data-focused-route-id',
    'legacy-A',
  );
  cy.get('button[aria-label="Select mini representation for swap"]').click();
  cy.contains('button', 'Use Canvas 2D in mini').click();
  swap();
  cy.get('[data-testid="primary-visualization"]').should(
    'have.attr',
    'data-family',
    'canvas2d',
  );
  cy.get('[data-testid="canvas2d-representation"]').should(
    'have.attr',
    'data-map-viewport',
    'route',
  );
  cy.get('button[aria-label="Select mini representation for swap"]').click();
  cy.contains('button', 'Use 3D in mini').click();
  swap();
  cy.get('[data-testid="d3d-map-representation"]', { timeout: 15000 })
    .should('have.attr', 'data-enriched-edge-count', '244')
    .and('have.attr', 'data-focused-route-id', 'legacy-A')
    .and('have.attr', 'data-vehicle-hud-count', '1')
    .and('have.attr', 'data-selected-kind', 'vehicle');
  cy.get('[aria-label="Routes"] [data-route-id="legacy-A"]').click();
  cy.contains('button', 'Show full network').click();
  cy.get('[data-testid="d3d-map-representation"]').should(
    'have.attr',
    'data-camera-mode',
    'full',
  );
  cy.get('[data-testid="d3d-map-representation"] canvas').trigger('wheel', {
    deltaY: -120,
  });
  cy.get('[data-testid="d3d-map-representation"]').should(
    'have.attr',
    'data-camera-mode',
    'manual',
  );
  cy.get('[data-testid="d3d-map-representation"]').then(($map) => {
    const canvas = $map.find('canvas')[0]!;
    cy.wrap(canvas).click(
      Number($map.attr('data-pointer-stop-x')),
      Number($map.attr('data-pointer-stop-y')),
    );
  });
  cy.get('[role="dialog"]').should('contain.text', 'Stop overview');
  closeDetails();
  cy.get('[data-testid="d3d-map-representation"]').then(($map) => {
    const canvas = $map.find('canvas')[0]!;
    cy.wrap(canvas).click(
      Number($map.attr('data-pointer-vehicle-x')),
      Number($map.attr('data-pointer-vehicle-y')),
    );
  });
  cy.get('[role="dialog"]').should('contain.text', 'Vehicle');
  closeDetails();
  cy.screenshot('route-enrichment-d3d-all-lines');
});
