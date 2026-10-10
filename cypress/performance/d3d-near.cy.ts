const map = () => cy.get('[data-testid="d3d-map-representation"]');
const drawn = () =>
  map().should(($m) => {
    for (const k of ['zoom', 'target-x', 'target-z'])
      expect(Number($m.attr('data-rendered-camera-' + k))).to.be.closeTo(
        Number($m.attr('data-camera-' + k)),
        1e-10,
      );
  });
it('measures paused maximum-zoom terrain interaction separately from running pacing', () => {
  cy.visit('/?profile-performance=1');
  cy.get('[data-testid="open-screen"]').should('be.visible');
  cy.contains('label', 'Scenario')
    .find('select')
    .select('torrevieja-legacy-all-v1');
  cy.contains('button', 'Start new game').should('be.enabled').click();
  cy.get('[data-testid="game-shell"]').should('be.visible');
  // Use the existing terrain-spec acquisition allowance before timing interactions.
  // All measured camera assertions retain the default command timeout.
  cy.get('[data-testid="d3d-map-representation"]', { timeout: 15000 }).should(
    'have.attr',
    'data-terrain-status',
    'ready',
  );
  cy.contains('button', 'Pause').click();
  cy.get('button[aria-label="Select mini representation for swap"]').click();
  cy.contains('button', 'Swap visualizations').click();
  map()
    .should('have.attr', 'data-terrain-status', 'ready')
    .and('have.attr', 'data-representation-mode', 'normal');
  drawn();
  map().find('canvas').trigger('wheel', { deltaY: -10000 });
  map()
    .should('have.attr', 'data-camera-maximum-zoom', 'true')
    .and('have.attr', 'data-terrain-grid-visible', 'true');
  map()
    .should('have.attr', 'data-road-network-status', 'ready')
    .and('have.attr', 'data-road-network-level', 'C')
    .and('have.attr', 'data-rendered-road-network-level', 'C');
  drawn();
  const roadPreparations: { name: string; duration: number }[] = [];
  cy.window().then((w) => {
    for (const e of w.performance
      .getEntriesByType('measure')
      .filter((e) => e.name.endsWith('road.prepare')))
      roadPreparations.push({ name: e.name, duration: e.duration });
  });
  const samples: number[] = [];
  let started = 0;
  cy.window().then((w) => {
    w.performance.clearMeasures();
    w.performance.clearMarks();
  });
  for (let i = 0; i < 12; i++) {
    map().then(($m) => {
      const canvas = $m.find('canvas')[0]!,
        r = canvas.getBoundingClientRect();
      started = performance.now();
      cy.wrap(canvas).trigger('pointerdown', {
        eventConstructor: 'PointerEvent',
        pointerId: 1,
        clientX: r.left + 100,
        clientY: r.top + 100,
      });
      cy.wrap(canvas).trigger('pointermove', {
        eventConstructor: 'PointerEvent',
        pointerId: 1,
        clientX: r.left + 100 + (i % 2 ? -70 : 70),
        clientY: r.top + 120,
      });
      cy.wrap(canvas).trigger('pointerup', {
        eventConstructor: 'PointerEvent',
        pointerId: 1,
        clientX: r.left + 100 + (i % 2 ? -70 : 70),
        clientY: r.top + 120,
      });
    });
    drawn();
    cy.then(() => samples.push(performance.now() - started));
  }
  map().then(($m) => {
    const diagnostics = { ...$m[0]!.dataset };
    cy.window().then((w) =>
      cy.writeFile('performance-results/d3d-near-paused.json', {
        samples,
        roadPreparations,
        diagnostics,
        measures: w.performance
          .getEntriesByType('measure')
          .map((e) => ({ name: e.name, duration: e.duration })),
      }),
    );
  });
  cy.window().then((w) => {
    w.performance.clearMarks();
    w.performance.clearMeasures();
  });
  map().then(($m) => {
    const frames = $m.attr('data-renderer-frames');
    cy.wait(500);
    map().should('have.attr', 'data-renderer-frames', frames);
  });
  cy.contains('button', 'Resume').click();
  cy.wait(3000);
  cy.window().then((w) =>
    cy.writeFile('performance-results/d3d-near-running.json', {
      appRenders: w.performance
        .getEntriesByType('mark')
        .filter((e) => e.name.endsWith('app.render')).length,
      measures: w.performance
        .getEntriesByType('measure')
        .map((e) => ({ name: e.name, duration: e.duration })),
    }),
  );
});
