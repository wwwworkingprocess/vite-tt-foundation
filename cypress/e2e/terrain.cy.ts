const terrainMap = () =>
  cy.get('[data-testid="d3d-map-representation"]', { timeout: 15000 });
const terrainZoomTo = (worldUnitsPerPixel: number) =>
  terrainMap().then(($map) => {
    const zoom = Number($map.attr('data-camera-zoom')),
      height = Number($map.attr('data-camera-viewport-height'));
    const desired = 20 / (height * worldUnitsPerPixel);
    cy.wrap($map.find('canvas')[0]!).trigger('wheel', {
      deltaY: -Math.log(desired / zoom) * 1000,
    });
  });
const terrainDrawn = () =>
  terrainMap().should(($map) => {
    expect($map.attr('data-rendered-terrain-identity')).to.equal(
      $map.attr('data-terrain-identity'),
    );
    expect($map.attr('data-rendered-terrain-viewport')).to.equal(
      $map.attr('data-terrain-viewport'),
    );
    for (const coordinate of ['zoom', 'target-x', 'target-z'])
      expect(
        Number($map.attr('data-rendered-camera-' + coordinate)),
      ).to.be.closeTo(Number($map.attr('data-camera-' + coordinate)), 1e-10);
  });
const closeTerrainDetails = () =>
  cy.get('[role="dialog"]').contains('button', 'Close').click();
const terrainPanTo = (kind: 'stop' | 'vehicle') =>
  terrainMap().then(($map) => {
    const canvas = $map.find('canvas')[0]!,
      rect = canvas.getBoundingClientRect();
    const dx = rect.width / 2 - Number($map.attr(`data-pointer-${kind}-x`));
    const dy = rect.height / 2 - Number($map.attr(`data-pointer-${kind}-y`));
    cy.wrap(canvas).trigger('pointerdown', {
      eventConstructor: 'PointerEvent',
      pointerId: 1,
      clientX: rect.left + 10,
      clientY: rect.top + 10,
    });
    cy.wrap(canvas).trigger('pointermove', {
      eventConstructor: 'PointerEvent',
      pointerId: 1,
      clientX: rect.left + 10 + dx,
      clientY: rect.top + 10 + dy,
    });
    cy.wrap(canvas).trigger('pointerup', {
      eventConstructor: 'PointerEvent',
      pointerId: 1,
      clientX: rect.left + 10 + dx,
      clientY: rect.top + 10 + dy,
    });
  });
const terrainPick = (kind: 'stop' | 'vehicle') =>
  terrainMap().then(($map) => {
    cy.wrap($map.find('canvas')[0]!).click(
      Number($map.attr(`data-pointer-${kind}-x`)),
      Number($map.attr(`data-pointer-${kind}-y`)),
    );
  });
it('renders native terrain, preserves entity/focus interaction, and reuses products across scenarios', () => {
  let products = 0;
  cy.intercept('GET', '**/terrain/es-torrevieja/*', () => {
    products++;
  });
  cy.visit('/');
  cy.get('[data-testid="open-screen"]', { timeout: 15000 }).should(
    'be.visible',
  );
  cy.contains('label', 'Scenario')
    .find('select')
    .select('torrevieja-legacy-all-v1');
  cy.contains('button', 'Start new game').should('be.enabled').click();
  terrainMap()
    .should('have.attr', 'data-terrain-status', 'ready')
    .and('have.attr', 'data-terrain-native-samples', '161680')
    .and('have.attr', 'data-terrain-land-samples', '115166')
    .and('have.attr', 'data-terrain-water-samples', '46514')
    .and('have.attr', 'data-terrain-vertices', '17810');
  cy.get('[aria-label="Routes"] [data-route-id="legacy-A"]').click();
  cy.contains('button', 'Add bus').should('be.enabled').click();
  cy.get('button[aria-label="Select mini representation for swap"]').click();
  cy.contains('button', 'Swap visualizations').click();
  terrainMap()
    .should('have.attr', 'data-representation-mode', 'normal')
    .and('have.attr', 'data-terrain-vertices', '278634')
    .and('have.attr', 'data-terrain-triangles', '553692')
    .and('have.attr', 'data-terrain-meshes', '2');
  cy.then(() => expect(products).to.equal(3));
  terrainMap()
    .should(($map) =>
      expect($map.attr('data-terrain-geometry-builds')).to.match(
        /^[1-9][0-9]*$/,
      ),
    )
    .then(($map) => {
      const builds = $map.attr('data-terrain-geometry-builds');
      cy.get('[aria-label="Routes"] [data-route-id="legacy-A"]').click();
      cy.contains('button', 'Focus route').click();
      terrainMap()
        .should('have.attr', 'data-camera-mode', 'route-fit')
        .and('have.attr', 'data-terrain-geometry-builds', builds);
      terrainDrawn();
      cy.screenshot('terrain-focused-route');
      cy.contains('button', 'Show full network').click();
    });
  terrainZoomTo(0.4);
  terrainMap().should('have.attr', 'data-lod', 'far');
  terrainDrawn();
  cy.screenshot('terrain-full-network-far');
  terrainZoomTo(0.1);
  terrainMap().should('have.attr', 'data-lod', 'medium');
  terrainPanTo('vehicle');
  terrainDrawn();
  cy.screenshot('terrain-medium-coast');
  terrainZoomTo(0.03);
  terrainMap().should('have.attr', 'data-lod', 'near');
  terrainPanTo('stop');
  terrainDrawn();
  cy.screenshot('terrain-near-built-up');
  terrainMap().should('have.attr', 'data-camera-mode', 'manual');
  terrainPick('stop');
  cy.get('[role="dialog"]').should('contain.text', 'Stop overview');
  closeTerrainDetails();
  terrainDrawn();
  cy.screenshot('terrain-selected-stop');
  terrainPanTo('vehicle');
  terrainPick('vehicle');
  cy.get('[role="dialog"]').should('contain.text', 'Vehicle');
  closeTerrainDetails();
  terrainDrawn();
  cy.screenshot('terrain-selected-vehicle');
  cy.contains('button', 'Simulation controls').click();
  cy.contains('button', /^Start browser-demo-vehicle-/)
    .should('be.enabled')
    .click();
  cy.get('[data-testid="vehicle-movement"]').should(
    'contain.text',
    'running-on-edge',
  );
  cy.contains('button', /^Normal /)
    .should('be.enabled')
    .click();
  cy.get('button[aria-label="Close Simulation controls"]').click();
  terrainMap().then(($map) => {
    const x = $map.attr('data-pointer-vehicle-x'),
      y = $map.attr('data-pointer-vehicle-y'),
      builds = $map.attr('data-terrain-geometry-builds');
    terrainMap().should(($next) =>
      expect([
        $next.attr('data-pointer-vehicle-x'),
        $next.attr('data-pointer-vehicle-y'),
      ]).not.to.deep.equal([x, y]),
    );
    terrainMap().should('have.attr', 'data-terrain-geometry-builds', builds);
  });
  terrainDrawn();
  cy.screenshot('terrain-moving-vehicle');
  cy.contains('button', 'Simulation controls').click();
  cy.get('[role="dialog"]').contains('button', 'Pause').click();
  cy.get('button[aria-label="Close Simulation controls"]').click();
  cy.get('[data-testid="scenario-menu-trigger"]').click();
  cy.contains('label', 'Scenario')
    .find('select')
    .select('torrevieja-legacy-north-v1');
  cy.get('[data-testid="scenario-status"]').should('contain.text', 'ready');
  cy.get('[data-testid="scenario-menu-trigger"]').click();
  cy.contains('button', 'Restart').click();
  terrainMap()
    .should('have.attr', 'data-scenario-id', 'torrevieja-legacy-north-v1')
    .and('have.attr', 'data-terrain-status', 'ready');
  cy.then(() => expect(products).to.equal(3));
});
