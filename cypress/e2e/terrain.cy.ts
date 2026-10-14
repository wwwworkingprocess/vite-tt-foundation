// Test-only dev-module response: exercise the checked-in true setting without
// adding a runtime UI/configuration channel to production.
const enableStreetCellOutlines = () =>
  cy.intercept(
    'GET',
    '**/src/representation/d3d-app-settings.ts*',
    (request) => {
      delete request.headers['if-none-match'];
      request.continue((response) => {
        response.headers['cache-control'] = 'no-store';
        delete response.headers.etag;
        expect(response.body).to.contain('showBoundaries: false');
        response.body = response.body.replace(
          'showBoundaries: false',
          'showBoundaries: true',
        );
      });
    },
  );
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
// Native browser touch input exercises gesture arbitration, pointer capture,
// and the compatibility click used by R3F, rather than synthetic mouse clicks.
const terrainTouch = (
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  points: readonly { x: number; y: number; id: number }[],
) =>
  cy
    .window()
    .should(() => {
      // Screenshots briefly expand the AUT to fill the browser. Wait for the
      // runner layout to return before converting native input coordinates.
      expect(
        window.parent.document
          .querySelector('iframe.aut-iframe')!
          .getBoundingClientRect().left,
      ).to.be.greaterThan(0);
    })
    .then((win) => {
      const frame = window.parent.document
        .querySelector('iframe.aut-iframe')!
        .getBoundingClientRect();
      const scaleX = frame.width / win.innerWidth;
      const scaleY = frame.height / win.innerHeight;
      const params = {
        type,
        touchPoints: points.map((point) => ({
          ...point,
          x: point.x * scaleX + frame.left,
          y: point.y * scaleY + frame.top,
        })),
      };
      return Cypress.automation('remote:debugger:protocol', {
        command: 'Input.dispatchTouchEvent',
        params,
      });
    });
const terrainTouchPick = (kind: 'stop' | 'vehicle') =>
  terrainMap().then(($map) => {
    const rect = $map.find('canvas')[0]!.getBoundingClientRect();
    terrainTouch('touchStart', [
      {
        id: 1,
        x: rect.left + Number($map.attr(`data-pointer-${kind}-x`)),
        y: rect.top + Number($map.attr(`data-pointer-${kind}-y`)),
      },
    ]);
    terrainTouch('touchEnd', []);
  });
it('renders native terrain, preserves entity/focus interaction, and reuses products across scenarios', () => {
  enableStreetCellOutlines();
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
    .and('have.attr', 'data-terrain-elevation-scale', '5')
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
      // Capture the inspected viewport without full-page scroll/resize work
      // while Cypress freezes scene timers for the screenshot.
      cy.screenshot('terrain-focused-route', { capture: 'viewport' });
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
    // Native top faces remain 553,692; the cached shore adds 1,361 faces.
    expect($map.attr('data-terrain-triangles')).to.equal('555053');
    expect($map.attr('data-terrain-vertices')).to.equal('286009');
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
  terrainMap().find('canvas').should('have.css', 'touch-action', 'none');
  cy.get('body').should('have.css', 'user-select', 'none');
  terrainMap().then(($map) => {
    const rect = $map.find('canvas')[0]!.getBoundingClientRect();
    const x = rect.left + rect.width / 2,
      y = rect.top + rect.height / 2;
    const zoom = Number($map.attr('data-camera-zoom'));
    const target = $map.attr('data-camera-target-x');
    const selected = $map.attr('data-selected-kind');
    const builds = $map.attr('data-terrain-geometry-builds');
    terrainTouch('touchStart', [
      { id: 1, x: x - 50, y },
      { id: 2, x: x + 50, y },
    ]);
    terrainTouch('touchMove', [
      { id: 1, x: x - 65, y: y + 20 },
      { id: 2, x: x + 85, y: y + 20 },
    ]);
    terrainTouch('touchEnd', []);
    terrainMap()
      .should(($next) => {
        expect(Number($next.attr('data-camera-zoom'))).to.be.greaterThan(zoom);
        expect($next.attr('data-camera-target-x')).not.to.equal(target);
        expect($next.attr('data-selected-kind')).to.equal(selected);
        expect($next.attr('data-terrain-geometry-builds')).to.equal(builds);
      })
      .then(($next) => {
        const panned = $next.attr('data-camera-target-x');
        terrainTouch('touchStart', [{ id: 1, x, y }]);
        terrainTouch('touchMove', [{ id: 1, x: x + 25, y: y + 10 }]);
        terrainTouch('touchEnd', []);
        terrainMap().should(($panned) => {
          expect($panned.attr('data-camera-target-x')).not.to.equal(panned);
          expect($panned.attr('data-selected-kind')).to.equal(selected);
          expect($panned.attr('data-terrain-geometry-builds')).to.equal(builds);
        });
      });
  });
  terrainPanTo('stop');
  terrainDrawn();
  terrainMap().should('have.attr', 'data-camera-mode', 'manual');
  terrainMap().then(($map) => {
    const id = $map.attr('data-pointer-stop-id');
    terrainTouchPick('stop');
    terrainMap().should('have.attr', 'data-selected-stop-id', id);
  });
  cy.get('[role="dialog"]').should('contain.text', 'Stop overview');
  closeTerrainDetails();
  terrainDrawn();
  recordTerrainState('terrain-selected-stop');
  cy.screenshot('terrain-selected-stop');
  terrainPanTo('vehicle');
  terrainTouchPick('vehicle');
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
  // This checks city/road acquisition, independently of a running simulation.
  cy.contains('button', /^Pause$/).click();
  const changeCity = (city: string, scenario: string) => {
    cy.get('[data-testid="scenario-menu-trigger"]').click();
    cy.get('select[aria-label="City"]').select(city);
    // City selection loads its default scenario before the requested variant.
    // Acknowledge that transition, then query the current select afresh.
    cy.get('select[aria-label="City"]').should('have.value', city);
    cy.get('[data-testid="scenario-status"]').should(
      'have.text',
      'Scenario status: ready',
    );
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
  enableStreetCellOutlines();
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
  enableStreetCellOutlines();
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
  enableStreetCellOutlines();
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

it('shows Pass-1 and safe road-crossed urban/suburban buildings at every LOD', () => {
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
      const pass1 = JSON.parse($map.attr('data-cell-buildings-pass1')!),
        pass2 = JSON.parse($map.attr('data-cell-buildings-pass2')!);
      expect(pass1).to.deep.equal({
        buildings: 8878,
        occupied: 941,
        proposed: 18680,
      });
      expect(pass2.buildings).to.be.greaterThan(4000);
      expect(pass2.occupied).to.be.greaterThan(250);
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
    terrainMap()
      .should('have.attr', 'data-street-cells-status', 'hidden')
      .and('have.attr', 'data-rendered-street-cells-level', '')
      .and('have.attr', 'data-street-cells-batches', '0')
      .and('have.attr', 'data-terrain-elevation-scale', '5');
    cy.task('streetCellBuildingSamples').then((raw) => {
      const samples = raw as {
        urban: { x: number; z: number; buildings: number };
        suburban: { x: number; z: number; buildings: number };
        highGuides: {
          x: number;
          z: number;
          buildings: number;
          guideSegments: number;
        };
      };
      expect(samples.urban.buildings).to.be.greaterThan(10);
      expect(samples.suburban.buildings).to.be.greaterThan(10);
      cy.writeFile(
        'node_modules/.cache/street-cells/cell-city-browser-samples.json',
        raw,
      );
      for (const family of ['urban', 'suburban', 'highGuides'] as const) {
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

it('draws optional verified city sites across LODs without rebuilding the C-owned city', () => {
  cy.visit('/');
  cy.get('[data-testid="open-screen"]').should('be.visible');
  cy.contains('label', 'Scenario')
    .find('select')
    .select('torrevieja-legacy-all-v1');
  cy.contains('button', 'Start new game').should('be.enabled').click();
  terrainMap().should('have.attr', 'data-terrain-status', 'ready');
  cy.contains('button', /^Pause$/).click();
  cy.get('button[aria-label="Select mini representation for swap"]').click();
  cy.contains('button', 'Swap visualizations').click();
  terrainMap()
    .should('have.attr', 'data-materialization-status', 'ready')
    .and('have.attr', 'data-city-building-count', '17562');
  terrainMap().then(($map) => {
    const builds = $map.attr('data-city-layout-builds');
    for (const [pixel, level] of [
      [0.3, 'A'],
      [0.055, 'B'],
      [0.014, 'C'],
      [0.3, 'A'],
    ] as const) {
      terrainZoomTo(pixel);
      terrainDrawn();
      terrainMap()
        .should('have.attr', 'data-materialization-status', 'ready')
        .and('have.attr', 'data-rendered-materialization-level', level)
        .and('have.attr', 'data-city-layout-builds', builds)
        .and('have.attr', 'data-city-building-count', '17562')
        .then(($host) => {
          const diagnostics = JSON.parse(
            $host.attr('data-materialization-diagnostics')!,
          ) as {
            siteId: string;
            triangles: number;
            instances: number;
            suppressedSurfaces: number;
          }[];
          expect(
            diagnostics.find((s) => s.siteId.endsWith('marina-internacional')),
          ).to.include({ triangles: 0, instances: 0, suppressedSurfaces: 1 });
          expect(
            diagnostics.find((s) => s.siteId.endsWith('friday-market'))!
              .instances,
          ).to.equal({ A: 0, B: 80, C: 160 }[level]);
        });
    }
  });
});

it('renders analytic wall details with identical prototype batches and no window meshes', () => {
  cy.visit('/');
  cy.window()
    .then(async (win) => {
      const three = await win.eval(
        'import("/node_modules/.vite/deps/three.js")',
      );
      const geometry = await win.eval(
        'import("/src/representation/d3d-city-geometry.ts")',
      );
      const facade = await win.eval(
        'import("/src/representation/d3d-city-facade.ts")',
      );
      const output = [];
      for (const enabled of [false, true]) {
        const renderer = new three.WebGLRenderer({
          antialias: true,
          preserveDrawingBuffer: true,
        });
        renderer.setSize(1000, 660);
        renderer.setClearColor('#e3e9dc');
        renderer.debug.onShaderError = () => {
          throw new Error('Facade shader compilation failed');
        };
        const scene = new three.Scene(),
          camera = new three.OrthographicCamera(-25, 25, 16.5, -16.5, 0.1, 200);
        camera.position.set(26, 25, 40);
        camera.lookAt(0, 5, 0);
        scene.add(new three.AmbientLight('#ffffff', 0.85));
        const light = new three.DirectionalLight('#ffffff', 1.6);
        light.position.set(-40, 80, 30);
        scene.add(light);
        const resources = [];
        for (const [i, kind] of [
          'midrise-slab',
          'detached-villa',
          'terrace-row',
        ].entries()) {
          const storeys = i === 0 ? 5 : 2,
            b = { width: 8, depth: 10, storeys, density: i === 0 ? 0.8 : 0.2 };
          for (const layer of ['body', 'roof']) {
            const g = geometry.createCityPrototypeGeometry(kind, layer),
              m = new three.MeshLambertMaterial({
                color: layer === 'body' ? '#cec8b7' : '#949a95',
              });
            if (enabled && layer === 'body') {
              g.setAttribute('cityFacade', facade.facadeParameters([b], 1));
              m.onBeforeCompile = facade.patchCityFacadeShader;
              m.customProgramCacheKey = () => 'city-wall-facade-v0';
            }
            const mesh = new three.InstancedMesh(g, m, 1),
              object = new three.Object3D();
            object.position.set((i - 1) * 15, 0, 0);
            object.scale.set(8, storeys * 3.1, 10);
            object.updateMatrix();
            mesh.setMatrixAt(0, object.matrix);
            scene.add(mesh);
            resources.push([g, m, mesh]);
          }
        }
        renderer.render(scene, camera);
        const name = 'facade-' + (enabled ? 'after' : 'before');
        output.push({
          name,
          image: renderer.domElement.toDataURL().split(',')[1],
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
        });
        for (const [g, m, mesh] of resources) {
          g.dispose();
          m.dispose();
          mesh.dispose();
        }
        renderer.dispose();
        renderer.forceContextLoss();
      }
      return output;
    })
    .then((rows) => {
      expect(rows[0].calls).to.equal(6);
      expect(rows[1].calls).to.equal(rows[0].calls);
      expect(rows[1].triangles).to.equal(rows[0].triangles);
      for (const row of rows) {
        cy.writeFile(
          'node_modules/.cache/street-cells/urban-perimeters/' +
            row.name +
            '.png',
          row.image,
          'base64',
        );
        cy.writeFile(
          'node_modules/.cache/street-cells/urban-perimeters/' +
            row.name +
            '.json',
          { calls: row.calls, triangles: row.triangles },
        );
      }
    });
});
