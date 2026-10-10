const recordTerrainState = (name: string) =>
  terrainMap().then(($map) =>
    cy.writeFile(
      'node_modules/.cache/terrain-hardening/diagnostics/' + name + '.json',
      { ...$map[0]!.dataset },
    ),
  );
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
    expect($map.attr('data-rendered-terrain-lod')).to.equal(
      $map.attr('data-terrain-render-lod'),
    );
    expect(
      Number($map.attr('data-terrain-rendered-patches')),
    ).to.be.greaterThan(0);
    for (const layer of ['Ground', 'Street', 'Landscape', 'Reservation'])
      expect($map[0]!.dataset['city' + layer + 'DrapeLimited']).to.equal(
        'false',
      );
    expect($map.attr('data-route-drape-limited-geometry-count')).to.equal('0');
    for (const coordinate of ['zoom', 'target-x', 'target-z'])
      expect(
        Number($map.attr('data-rendered-camera-' + coordinate)),
      ).to.be.closeTo(Number($map.attr('data-camera-' + coordinate)), 1e-10);
  });
const roadDrawn = (level: 'A' | 'B' | 'C') =>
  terrainMap()
    .should('have.attr', 'data-road-network-status', 'ready')
    .and('have.attr', 'data-road-network-level', level)
    .and('have.attr', 'data-rendered-road-network-level', level)
    .and(
      'have.attr',
      'data-road-network-features',
      String({ A: 124, B: 664, C: 4364 }[level]),
    )
    .and('have.attr', 'data-city-street-triangles', '0');
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
  cy.intercept('GET', '**/terrain/terrain.zip*', () => {
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
    .and('have.attr', 'data-terrain-elevation-scale', '10')
    .and('have.attr', 'data-terrain-grid-visible', 'false')
    .and('have.attr', 'data-terrain-native-samples', '161680')
    .and('have.attr', 'data-terrain-land-samples', '115166')
    .and('have.attr', 'data-terrain-water-samples', '46514')
    .and('have.attr', 'data-terrain-render-stride', '8');
  roadDrawn('A');
  cy.get('[aria-label="Routes"] [data-route-id="legacy-A"]').click();
  cy.contains('button', 'Add bus').should('be.enabled').click();
  cy.get('button[aria-label="Select mini representation for swap"]').click();
  cy.contains('button', 'Swap visualizations').click();
  terrainMap()
    .should('have.attr', 'data-representation-mode', 'normal')
    .should(($map) => {
      expect(Number($map.attr('data-terrain-render-stride'))).to.be.at.least(4);
      expect(Number($map.attr('data-terrain-triangles'))).to.be.lessThan(40000);
      expect(Number($map.attr('data-terrain-meshes'))).to.equal(2);
    });
  cy.then(() => expect(products).to.equal(1));
  terrainMap()
    .should(($map) =>
      expect($map.attr('data-terrain-geometry-builds')).to.match(
        /^[1-9][0-9]*$/,
      ),
    )
    .then(($map) => {
      const lod = $map.attr('data-terrain-render-lod');
      const builds = $map.attr('data-terrain-geometry-builds');
      cy.get('[aria-label="Routes"] [data-route-id="legacy-A"]').click();
      cy.contains('button', 'Focus route').click();
      terrainMap()
        .should('have.attr', 'data-camera-mode', 'route-fit')
        .should(($focused) => {
          if ($focused.attr('data-terrain-render-lod') === lod)
            expect($focused.attr('data-terrain-geometry-builds')).to.equal(
              builds,
            );
        });
      terrainDrawn();
      recordTerrainState('terrain-focused-route');
      cy.screenshot('terrain-focused-route');
      cy.contains('button', 'Show full network').click();
    });
  terrainZoomTo(0.4);
  terrainMap().should('have.attr', 'data-lod', 'far');
  terrainDrawn();
  terrainMap().should(($map) => {
    expect(Number($map.attr('data-terrain-triangles'))).to.be.lessThan(10000);
    expect($map.attr('data-terrain-render-stride')).to.equal('8');
    expect(Number($map.attr('data-city-landscape-triangles'))).to.equal(0);
    expect(Number($map.attr('data-city-street-triangles'))).to.equal(0);
  });
  roadDrawn('A');
  recordTerrainState('terrain-full-network-far');
  cy.screenshot('terrain-full-network-far');
  terrainZoomTo(0.1);
  terrainMap().should('have.attr', 'data-lod', 'medium');
  terrainPanTo('vehicle');
  terrainDrawn();
  terrainMap().should('have.attr', 'data-terrain-render-stride', '4');
  roadDrawn('B');
  recordTerrainState('terrain-medium-coast');
  cy.screenshot('terrain-medium-coast');
  terrainZoomTo(0.03);
  terrainMap().should('have.attr', 'data-lod', 'near');
  terrainPanTo('stop');
  terrainDrawn();
  terrainMap().should(($map) => {
    const patches = Number($map.attr('data-terrain-meshes'));
    expect(patches).to.equal(53);
    expect($map.attr('data-terrain-triangles')).to.equal('553692');
    expect($map.attr('data-terrain-vertices')).to.equal('283086');
    expect(Number($map.attr('data-terrain-rendered-patches'))).to.be.lessThan(
      patches,
    );
    expect($map.attr('data-terrain-render-stride')).to.equal('1');
  });
  // Capped zoom guarantees native detail even for large coverage/viewport sizes.
  terrainMap().find('canvas').trigger('wheel', { deltaY: -10000 });
  terrainMap()
    .should('have.attr', 'data-camera-maximum-zoom', 'true')
    .and('have.attr', 'data-terrain-render-stride', '1')
    .and('have.attr', 'data-terrain-grid-visible', 'true')
    .should(($map) => {
      expect(Number($map.attr('data-camera-zoom'))).to.equal(
        Number($map.attr('data-camera-max-zoom')),
      );
      const window = JSON.parse($map.attr('data-terrain-grid-window')!);
      expect(
        (window.endCol - window.col) * (window.endRow - window.row),
      ).to.be.lessThan(161680 / 4);
      expect(Number($map.attr('data-terrain-grid-segments'))).to.be.greaterThan(
        0,
      );
    });
  terrainPanTo('stop');
  terrainDrawn();
  roadDrawn('C');
  recordTerrainState('terrain-maximum-native-grid');
  cy.screenshot('terrain-maximum-native-grid');
  terrainMap().then(($map) => {
    const window = $map.attr('data-terrain-grid-window'),
      builds = $map.attr('data-terrain-geometry-builds');
    const canvas = $map.find('canvas')[0]!,
      rect = canvas.getBoundingClientRect();
    cy.wrap(canvas).trigger('pointerdown', {
      eventConstructor: 'PointerEvent',
      pointerId: 1,
      clientX: rect.left + 10,
      clientY: rect.top + 10,
    });
    cy.wrap(canvas).trigger('pointermove', {
      eventConstructor: 'PointerEvent',
      pointerId: 1,
      clientX: rect.left + 180,
      clientY: rect.top + 80,
    });
    cy.wrap(canvas).trigger('pointerup', {
      eventConstructor: 'PointerEvent',
      pointerId: 1,
      clientX: rect.left + 180,
      clientY: rect.top + 80,
    });
    terrainMap()
      .should('have.attr', 'data-terrain-geometry-builds', builds)
      .should(($pan) => {
        expect($pan.attr('data-terrain-grid-window')).not.to.equal(window);
      });
  });
  terrainZoomTo(0.03);
  terrainMap().should('have.attr', 'data-terrain-grid-visible', 'false');
  terrainPanTo('stop');
  terrainDrawn();
  recordTerrainState('terrain-near-built-up');
  cy.screenshot('terrain-near-built-up');
  terrainMap().should('have.attr', 'data-camera-mode', 'manual');
  terrainMap().then(($map) => {
    const id = $map.attr('data-pointer-stop-id');
    terrainPick('stop');
    terrainMap().should('have.attr', 'data-selected-stop-id', id);
  });
  cy.get('[role="dialog"]').should('contain.text', 'Stop overview');
  closeTerrainDetails();
  terrainDrawn();
  recordTerrainState('terrain-selected-stop');
  cy.screenshot('terrain-selected-stop');
  terrainPanTo('vehicle');
  terrainPick('vehicle');
  cy.get('[role="dialog"]').should('contain.text', 'Vehicle');
  closeTerrainDetails();
  terrainDrawn();
  recordTerrainState('terrain-selected-vehicle');
  cy.screenshot('terrain-selected-vehicle');
  // Command propagation while paused is deterministic; starting at a stop must
  // not depend on a renderer allowing a wall-clock tick before the assertion.
  terrainMap().then(($map) => {
    const builds = $map.attr('data-terrain-geometry-builds');
    const roadBuilds = $map.attr('data-road-network-geometry-builds');
    cy.contains('button', 'Simulation controls').click();
    cy.get('[role="dialog"]')
      .contains('button', /^Pause$/)
      .click();
    cy.get('[data-testid="pacing-status"]').should(
      'have.text',
      'Pacing status: paused',
    );
    cy.get('[data-testid="pacing-rate"]').should(
      'have.text',
      'Effective rate: 0×',
    );
    cy.contains('button', /^Start browser-demo-vehicle-/)
      .should('be.enabled')
      .click();
    cy.get('[data-testid="vehicle-movement"]').should(
      'contain.text',
      'running-at-stop',
    );
    cy.get('button[aria-label="Close Simulation controls"]').click();
    terrainMap()
      .should('have.attr', 'data-vehicle-movement-kind', 'running-at-stop')
      .and('have.attr', 'data-terrain-geometry-builds', builds)
      .and('have.attr', 'data-selected-kind', 'vehicle')
      .and('have.attr', 'data-road-network-geometry-builds', roadBuilds);
    terrainDrawn();
    terrainPick('vehicle');
    cy.get('[role="dialog"]').should('contain.text', 'Vehicle');
    closeTerrainDetails();
  });
  roadDrawn('C');
  terrainZoomTo(0.1);
  roadDrawn('B');
  terrainZoomTo(0.4);
  roadDrawn('A');
  recordTerrainState('terrain-started-vehicle');
  cy.screenshot('terrain-started-vehicle');
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
  cy.then(() => expect(products).to.equal(1));
});

it('leaves non-Torrevieja roads absent without hiding native terrain or gameplay', () => {
  cy.visit('/');
  cy.get('[data-testid="open-screen"]').should('be.visible');
  cy.get('select[aria-label="City"]').select('es-alicante');
  cy.contains('label', 'Scenario')
    .find('select')
    .select('alicante-legacy-core-v1');
  cy.contains('button', 'Start new game').should('be.enabled').click();
  terrainMap()
    .should('have.attr', 'data-road-network-status', 'absent')
    .and('have.attr', 'data-road-network-level', '')
    .and('have.attr', 'data-road-network-features', '0')
    .and('have.attr', 'data-rendered-road-network-level', '');
  cy.get('[data-testid="game-shell"]').should('be.visible');
});

it('reports missing required road infrastructure while preserving the game and native terrain', () => {
  cy.intercept('GET', '**/road-network/road-network.zip*', {
    statusCode: 503,
    body: 'Unavailable',
  });
  cy.visit('/');
  cy.get('[data-testid="open-screen"]').should('be.visible');
  cy.contains('button', 'Start new game').should('be.enabled').click();
  terrainMap()
    .should('have.attr', 'data-road-network-status', 'error')
    .and(
      'have.attr',
      'data-road-network-error',
      'Public layer unavailable: road-network',
    )
    .and('have.attr', 'data-road-network-level', '')
    .and('have.attr', 'data-rendered-road-network-level', '')
    .and('have.attr', 'data-terrain-status', 'ready');
  cy.get('[data-testid="game-shell"]').should('be.visible');
  cy.get('[aria-label="Routes"] [data-route-id="legacy-A"]').click();
  cy.contains('button', 'Add bus').should('be.enabled');
});
