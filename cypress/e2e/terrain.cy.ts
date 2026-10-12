let roadProductCounts: Record<string, Record<'A' | 'B' | 'C', number>>;
before(() =>
  cy.task('roadProductCounts').then((counts) => {
    roadProductCounts = counts as typeof roadProductCounts;
  }),
);
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
    for (const layer of ['ground', 'landscape']) {
      expect($map.attr('data-city-' + layer + '-triangles')).to.equal('0');
      expect($map.attr('data-city-' + layer + '-vertices')).to.equal('0');
    }
    expect($map.attr('data-route-drape-limited-geometry-count')).to.equal('0');
    for (const coordinate of ['zoom', 'target-x', 'target-z'])
      expect(
        Number($map.attr('data-rendered-camera-' + coordinate)),
      ).to.be.closeTo(Number($map.attr('data-camera-' + coordinate)), 1e-10);
  });
const roadDrawn = (level: 'A' | 'B' | 'C', city = 'es-torrevieja') =>
  terrainMap()
    .should('have.attr', 'data-road-network-status', 'ready')
    .and('have.attr', 'data-road-network-level', level)
    .and('have.attr', 'data-rendered-road-network-level', level)
    .and(
      'have.attr',
      'data-road-network-features',
      String(roadProductCounts[city]![level]),
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
  let products = 0,
    cellArchives = 0;
  cy.intercept('GET', '**/street-cells/street-cells.zip*', () => {
    cellArchives++;
  });
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
  terrainMap()
    .should('have.attr', 'data-street-cells-status', 'inactive')
    .and('have.attr', 'data-street-cells-count', '0');
  terrainMap().should('have.attr', 'data-cell-buildings-status', 'ready');
  cy.then(() => expect(cellArchives).to.equal(1));
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
      // Capture a static presentation through existing host controls; do not
      // race worker fleet/UI updates while Cypress freezes browser animation.
      cy.contains('button', /^Pause$/).click();
      cy.screenshot('terrain-focused-route');
      cy.contains('button', /^Resume$/).click();
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
  terrainMap()
    .should('have.attr', 'data-rendered-street-cells-level', 'C')
    .and('have.attr', 'data-street-cells-count', '1623')
    .and('have.attr', 'data-street-cells-unique-edges', '15109');
  cy.then(() => expect(cellArchives).to.equal(1));
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
    const cellBuilds = $map.attr('data-street-cells-geometry-builds');
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
      .and('have.attr', 'data-road-network-geometry-builds', roadBuilds)
      .and('have.attr', 'data-street-cells-geometry-builds', cellBuilds)
      .and('have.attr', 'data-rendered-street-cells-level', 'C');
    terrainDrawn();
    terrainPick('vehicle');
    cy.get('[role="dialog"]').should('contain.text', 'Vehicle');
    closeTerrainDetails();
  });
  roadDrawn('C');
  terrainZoomTo(0.1);
  roadDrawn('B');
  terrainMap()
    .should('have.attr', 'data-rendered-street-cells-level', 'B')
    .and('have.attr', 'data-street-cells-count', '584');
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

it('switches between cataloged cities and unsupported Cartagena without stale road products', () => {
  let archiveRequests = 0;
  cy.intercept('GET', '**/road-network/road-network.zip*', () => {
    archiveRequests++;
  });
  cy.visit('/');
  cy.get('[data-testid="open-screen"]').should('be.visible');
  cy.contains('button', 'Start new game').should('be.enabled').click();
  roadDrawn('A');
  const changeCity = (city: string, scenario: string) => {
    cy.get('[data-testid="scenario-menu-trigger"]').click();
    cy.get('select[aria-label="City"]').select(city);
    cy.contains('label', 'Scenario')
      .find('select')
      .should('be.enabled')
      .select(scenario);
    cy.get('[data-testid="scenario-status"]').should('contain.text', 'ready');
    cy.get('[data-testid="scenario-menu-trigger"]').click();
    cy.contains('button', 'Restart').click();
    terrainMap().should('have.attr', 'data-scenario-id', scenario);
  };
  changeCity('es-elche', 'elche-urban-abc-v1');
  roadDrawn('A', 'es-elche');
  changeCity('es-alicante', 'alicante-legacy-core-v1');
  roadDrawn('A', 'es-alicante');
  changeCity('es-cartagena', 'cartagena-legacy-core-v1');
  terrainMap()
    .should('have.attr', 'data-road-network-status', 'absent')
    .and('have.attr', 'data-road-network-level', '')
    .and('have.attr', 'data-road-network-features', '0')
    .and('have.attr', 'data-rendered-road-network-level', '');
  cy.get('[data-testid="game-shell"]').should('be.visible');
  cy.then(() => expect(archiveRequests).to.equal(1));
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

// Deterministic test framing uses the existing canonical map/world transform;
// no runtime controls, pixel assertions or compiled parcel authority are added.
const frameTerrainTarget = (target: { x: number; z: number }) => {
  terrainMap().then(($map) => {
    const canvas = $map.find('canvas')[0]!,
      rect = canvas.getBoundingClientRect();
    const units =
      20 /
      (Number($map.attr('data-camera-viewport-height')) *
        Number($map.attr('data-camera-zoom')));
    const tx = target.x - Number($map.attr('data-camera-target-x')),
      tz = target.z - Number($map.attr('data-camera-target-z'));
    const dx = (tz - tx) / (Math.SQRT2 * units),
      dy = (-(tx + tz) * Math.sin((35 * Math.PI) / 180)) / (Math.SQRT2 * units);
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
  terrainDrawn();
};
const frameCellDowntown = (city = 'es-torrevieja') =>
  cy
    .task('streetCellDowntown', city)
    .then((point) => frameTerrainTarget(point as { x: number; z: number }));
it('draws inspectable V2 C safe-zone boundaries beside downtown roads and preserves static buffers on pan', () => {
  cy.viewport(1000, 660);
  cy.visit('/');
  cy.get('[data-testid="open-screen"]').should('be.visible');
  cy.contains('label', 'Scenario')
    .find('select')
    .select('torrevieja-legacy-all-v1');
  cy.contains('button', 'Start new game').click();
  terrainMap().should('have.attr', 'data-terrain-status', 'ready');
  cy.get('button[aria-label="Select mini representation for swap"]').click();
  cy.contains('button', 'Swap visualizations').click();
  terrainMap().should('have.attr', 'data-representation-mode', 'normal');
  terrainDrawn();
  terrainZoomTo(0.03);
  terrainMap().should('have.attr', 'data-lod', 'near');
  terrainMap().find('canvas').trigger('wheel', { deltaY: -10000 });
  terrainMap().should('have.attr', 'data-camera-maximum-zoom', 'true');
  frameCellDowntown();
  roadDrawn('C');
  terrainMap()
    .should('have.attr', 'data-rendered-street-cells-level', 'C')
    .and('have.attr', 'data-street-cells-batches', '1')
    .and('have.attr', 'data-street-cells-displayed-count', '1437')
    .should(($map) => {
      const displayed = Number($map.attr('data-street-cells-displayed-count'));
      const rejected = Number($map.attr('data-street-cells-nondrawable-count'));
      expect(displayed).to.equal(1437);
      expect(rejected).to.equal(186);
      expect(displayed + rejected).to.equal(1623);
      expect(
        JSON.parse($map.attr('data-street-cells-nondrawable-cells')!),
      ).to.have.length(rejected);
    });
  terrainMap().then(($map) => {
    const builds = $map.attr('data-street-cells-geometry-builds');
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
      clientX: rect.left + 50,
      clientY: rect.top + 30,
    });
    cy.wrap(canvas).trigger('pointerup', {
      eventConstructor: 'PointerEvent',
      pointerId: 1,
      clientX: rect.left + 50,
      clientY: rect.top + 30,
    });
    terrainDrawn();
    terrainMap().should(
      'have.attr',
      'data-street-cells-geometry-builds',
      builds,
    );
    frameCellDowntown();
    terrainMap().should(
      'have.attr',
      'data-street-cells-geometry-builds',
      builds,
    );
  });
  recordTerrainState('street-cells-downtown');
  cy.screenshot('street-cells-downtown');
  terrainZoomTo(0.1);
  terrainMap()
    .should('have.attr', 'data-rendered-street-cells-level', 'B')
    .and('have.attr', 'data-street-cells-count', '584');
  frameCellDowntown();
  recordTerrainState('street-cells-torrevieja-B');
  cy.screenshot('street-cells-torrevieja-B');
  terrainZoomTo(0.3);
  terrainMap()
    .should('have.attr', 'data-rendered-street-cells-level', 'A')
    .and('have.attr', 'data-street-cells-count', '84');
  frameCellDowntown();
  recordTerrainState('street-cells-torrevieja-A');
  cy.screenshot('street-cells-torrevieja-A');
  terrainZoomTo(0.03);
  frameCellDowntown();
  terrainMap().should('have.attr', 'data-rendered-street-cells-level', 'C');
});
it('preserves native downtown gameplay when the mandatory StreetCell archive cannot load', () => {
  cy.intercept('GET', '**/street-cells/street-cells.zip*', {
    statusCode: 503,
    body: '',
  });
  cy.viewport(1000, 660);
  cy.visit('/');
  cy.get('[data-testid="open-screen"]').should('be.visible');
  cy.contains('label', 'Scenario')
    .find('select')
    .select('torrevieja-legacy-all-v1');
  cy.contains('button', 'Start new game').click();
  terrainMap().should('have.attr', 'data-terrain-status', 'ready');
  cy.get('button[aria-label="Select mini representation for swap"]').click();
  cy.contains('button', 'Swap visualizations').click();
  terrainMap().should('have.attr', 'data-representation-mode', 'normal');
  terrainDrawn();
  terrainZoomTo(0.03);
  terrainMap().find('canvas').trigger('wheel', { deltaY: -10000 });
  terrainMap().should('have.attr', 'data-camera-maximum-zoom', 'true');
  frameCellDowntown();
  roadDrawn('C');
  terrainMap()
    .should('have.attr', 'data-street-cells-status', 'error')
    .and('have.attr', 'data-rendered-street-cells-level', '')
    .and('have.attr', 'data-street-cells-count', '0')
    .and('have.attr', 'data-cell-buildings-status', 'error')
    .and('have.attr', 'data-city-building-count', '0');
  recordTerrainState('street-cells-downtown-without-lattice');
  cy.screenshot('street-cells-downtown-without-lattice');
});

it('draws Alicante V3 C-owned buildings with A/B/C, keeps near buffers stable and clears cells for unsupported Cartagena', () => {
  let archives = 0;
  cy.intercept('GET', '**/street-cells/street-cells.zip*', () => {
    archives++;
  });
  cy.viewport(1000, 660);
  cy.visit('/');
  cy.get('[data-testid="open-screen"]').should('be.visible');
  cy.get('select[aria-label="City"]').select('es-alicante');
  cy.contains('label', 'Scenario')
    .find('select')
    .select('alicante-legacy-core-v1');
  cy.contains('button', 'Start new game').click();
  terrainMap().should('have.attr', 'data-terrain-status', 'ready');
  cy.get('button[aria-label="Select mini representation for swap"]').click();
  cy.contains('button', 'Swap visualizations').click();
  terrainMap().should('have.attr', 'data-representation-mode', 'normal');
  terrainDrawn();
  for (const [pixel, level, count] of [
    [0.3, 'A', 348],
    [0.1, 'B', 1411],
    [0.03, 'C', 3201],
  ] as const) {
    terrainZoomTo(pixel);
    if (level === 'C')
      terrainMap().find('canvas').trigger('wheel', { deltaY: -10000 });
    frameCellDowntown('es-alicante');
    roadDrawn(level, 'es-alicante');
    terrainMap()
      .should('have.attr', 'data-rendered-street-cells-level', level)
      .and('have.attr', 'data-street-cells-count', String(count))
      .and('have.attr', 'data-street-cells-batches', '1');
    recordTerrainState('street-cells-alicante-' + level);
    cy.screenshot('street-cells-alicante-' + level);
  }
  terrainMap()
    .should('have.attr', 'data-street-cells-displayed-count', '2759')
    .and('have.attr', 'data-street-cells-nondrawable-count', '442')
    .and('have.attr', 'data-cell-buildings-status', 'ready')
    .and('have.attr', 'data-cell-buildings-source-cells', '3201')
    .and('have.attr', 'data-cell-buildings-outside-safe-zone', '0')
    .and('have.attr', 'data-cell-buildings-ineligible', '0')
    .should(($map) =>
      expect(Number($map.attr('data-city-building-count'))).to.be.greaterThan(
        8000,
      ),
    );
  terrainMap().then(($map) => {
    const builds = $map.attr('data-street-cells-geometry-builds');
    cy.contains('button', 'Pause').click();
    cy.contains('button', 'Resume').click();
    frameCellDowntown('es-alicante');
    terrainMap().should(
      'have.attr',
      'data-street-cells-geometry-builds',
      builds,
    );
  });
  cy.get('[data-testid="scenario-menu-trigger"]').click();
  cy.get('select[aria-label="City"]').select('es-cartagena');
  cy.contains('label', 'Scenario')
    .find('select')
    .select('cartagena-legacy-core-v1');
  cy.get('[data-testid="scenario-status"]').should('contain.text', 'ready');
  cy.get('[data-testid="scenario-menu-trigger"]').click();
  cy.contains('button', 'Restart').click();
  terrainMap()
    .should('have.attr', 'data-scenario-id', 'cartagena-legacy-core-v1')
    .and('have.attr', 'data-street-cells-status', 'inactive')
    .and('have.attr', 'data-rendered-street-cells-level', '')
    .and('have.attr', 'data-street-cells-batches', '0');
  cy.get('[data-testid="game-shell"]').should('be.visible');
  cy.then(() => expect(archives).to.equal(1));
});

it('shows distinct research urban/suburban buildings only inside empty C cells at every LOD', () => {
  cy.viewport(1000, 660);
  let archives = 0;
  cy.intercept('GET', '**/street-cells/street-cells.zip*', () => {
    archives++;
  });
  cy.visit('/');
  cy.get('[data-testid="open-screen"]').should('be.visible');
  cy.contains('label', 'Scenario')
    .find('select')
    .select('torrevieja-legacy-all-v1');
  cy.contains('button', 'Start new game').click();
  terrainMap()
    .should('have.attr', 'data-cell-buildings-status', 'ready')
    .and('have.attr', 'data-cell-buildings-source-cells', '1623')
    .and('have.attr', 'data-cell-buildings-empty', '1126')
    .and('have.attr', 'data-cell-buildings-road-crossed', '311')
    .and('have.attr', 'data-cell-buildings-non-drawable', '186')
    .should(($map) => {
      expect(Number($map.attr('data-city-building-count'))).to.be.greaterThan(
        2486 * 3,
      );
      expect(
        Number($map.attr('data-cell-buildings-frontage')),
      ).to.be.greaterThan(0);
      expect(
        Number($map.attr('data-cell-buildings-interior')),
      ).to.be.greaterThan(0);
    });
  cy.get('button[aria-label="Select mini representation for swap"]').click();
  cy.contains('button', 'Swap visualizations').click();
  terrainDrawn();
  terrainMap().then(($map) => {
    const layoutBuilds = $map.attr('data-city-layout-builds'),
      buildings = $map.attr('data-city-building-count');
    expect(Number($map.attr('data-cell-buildings-urban'))).to.be.greaterThan(0);
    expect(Number($map.attr('data-cell-buildings-suburban'))).to.be.greaterThan(
      0,
    );
    terrainZoomTo(0.03);
    terrainMap().find('canvas').trigger('wheel', { deltaY: -10000 });
    terrainDrawn();
    roadDrawn('C');
    terrainMap().should('have.attr', 'data-rendered-street-cells-level', 'C');
    cy.task('streetCellBuildingSamples').then((raw) => {
      const samples = raw as {
        urban: { x: number; z: number; buildings: number };
        suburban: { x: number; z: number; buildings: number };
      };
      expect(samples.urban.buildings).to.be.greaterThan(10);
      expect(samples.suburban.buildings).to.be.greaterThan(10);
      cy.writeFile(
        'node_modules/.cache/street-cells/cell-city-browser-samples.json',
        raw,
      );
      for (const family of ['urban', 'suburban'] as const) {
        frameTerrainTarget(samples[family]);
        terrainMap()
          .should('have.attr', 'data-city-layout-builds', layoutBuilds)
          .and('have.attr', 'data-city-building-count', buildings);
        recordTerrainState('cell-city-' + family);
        cy.screenshot('cell-city-' + family);
      }
    });
    // Same world targets and viewport as the retained V2 dense-candidate samples.
    for (const [name, target] of [
      ['urban', { x: 14.19654349468673, z: 4.6500942933388325 }],
      ['suburban', { x: 27.23797137949348, z: -32.05766803384611 }],
    ] as const) {
      frameTerrainTarget(target);
      terrainMap()
        .should('have.attr', 'data-city-layout-builds', layoutBuilds)
        .and('have.attr', 'data-city-building-count', buildings);
      recordTerrainState('cell-city-matched-' + name);
      cy.screenshot('cell-city-matched-' + name);
    }
    cy.get('[aria-label="Routes"] [data-route-id="legacy-A"]').click();
    cy.contains('button', 'Add bus').click();
    cy.contains('button', 'Focus route').click();
    terrainMap()
      .should('have.attr', 'data-city-layout-builds', layoutBuilds)
      .and('have.attr', 'data-city-building-count', buildings);
    cy.contains('button', 'Show full network').click();
    terrainDrawn();
    terrainZoomTo(0.3);
    terrainDrawn();
    roadDrawn('A');
    terrainMap()
      .should('have.attr', 'data-city-layout-builds', layoutBuilds)
      .and('have.attr', 'data-city-building-count', buildings);
    terrainZoomTo(0.055);
    terrainDrawn();
    frameCellDowntown();
    terrainMap()
      .should('have.attr', 'data-city-layout-builds', layoutBuilds)
      .and('have.attr', 'data-city-building-count', buildings);
    recordTerrainState('cell-city-cityscale');
    cy.screenshot('cell-city-cityscale');
  });
  cy.then(() => expect(archives).to.equal(1));
});
