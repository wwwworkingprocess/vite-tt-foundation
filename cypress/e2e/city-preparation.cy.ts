import { waitForCurrentCityReady } from '../support/city-preparation.js';
it('presents a real C-owned scene through the visual worker and keeps workspace mounted under preparation', () => {
  const events: { milliseconds: number; stage: string; status: string }[] = [];
  const longTasks: { start: number; duration: number }[] = [];
  cy.visit('/', {
    onBeforeLoad(win) {
      const record = () => {
        const n = win.document.querySelector<HTMLElement>(
          '[data-testid="city-preparation"]',
        );
        if (!n) return;
        const stage = n.dataset.cityPreparationStage!,
          status = n.dataset.cityPreparationStatus!;
        if (events.at(-1)?.stage !== stage || events.at(-1)?.status !== status)
          events.push({ milliseconds: win.performance.now(), stage, status });
      };
      new win.MutationObserver(record).observe(win.document, {
        subtree: true,
        attributes: true,
        childList: true,
      });
      if (win.PerformanceObserver.supportedEntryTypes.includes('longtask'))
        new win.PerformanceObserver((list) => {
          for (const e of list.getEntries())
            longTasks.push({ start: e.startTime, duration: e.duration });
        }).observe({ type: 'longtask', buffered: true });
    },
  });
  cy.get('[data-testid="open-screen"]', { timeout: 15000 }).should(
    'be.visible',
  );
  cy.contains('label', 'Scenario')
    .find('select')
    .select('torrevieja-legacy-all-v1');
  cy.contains('button', 'Start new game').should('be.enabled').click();
  cy.get('[data-testid="visualization-workspace"]').should('exist');
  cy.get('[data-testid="city-preparation"]').should(
    'have.attr',
    'data-preparation-execution',
    'visual-worker',
  );
  cy.screenshot('city-preparation-overlay');
  waitForCurrentCityReady();
  cy.get<HTMLElement>('[data-testid="d3d-map-representation"]').then((m) =>
    cy.writeFile(
      'node_modules/.cache/city-preparation-v1/browser-startup.json',
      { events, longTasks, diagnostics: { ...m[0]!.dataset } },
    ),
  );
  cy.get('[data-testid="d3d-map-representation"]')
    .should('have.attr', 'data-city-building-count', '16231')
    .and('have.attr', 'data-terrain-status', 'ready');
  cy.screenshot('city-preparation-first-useful-frame');
  cy.get('button[aria-label="Select mini representation for swap"]').click();
  cy.contains('button', 'Swap visualizations').click();
  cy.get('[data-testid="d3d-map-representation"]').should(
    'have.attr',
    'data-representation-mode',
    'normal',
  );
  waitForCurrentCityReady();
});

afterEach(function () {
  if (this.currentTest?.state === 'failed')
    cy.get('body').then((body) => {
      const map = body.find('[data-testid="d3d-map-representation"]')[0] as
        HTMLElement | undefined;
      const host = body.find('[data-testid="city-preparation"]')[0] as
        HTMLElement | undefined;
      cy.writeFile(
        'node_modules/.cache/city-preparation-v1/browser-failure-state.json',
        { map: map?.dataset, host: host?.dataset },
      );
    });
});

it('keeps a mobile workspace usable on required-source failure and presents a genuine frame after retry', () => {
  let unavailable = true,
    requests = 0,
    failedBeforeRetry = 0;
  cy.viewport(390, 844);
  cy.intercept('GET', '**/street-cells/street-cells.zip*', (request) => {
    requests++;
    if (unavailable) request.reply({ statusCode: 503, body: '' });
    else request.continue();
  });
  cy.visit('/');
  cy.get('[data-testid="open-screen"]', { timeout: 15000 }).should(
    'be.visible',
  );
  cy.contains('label', 'Scenario')
    .find('select')
    .select('torrevieja-legacy-all-v1');
  cy.contains('button', 'Start new game').should('be.enabled').click();
  cy.get('[data-testid="city-preparation"]', { timeout: 15000 })
    .should('have.attr', 'data-city-preparation-status', 'error')
    .and('have.attr', 'data-first-useful-frame', '');
  cy.get('[data-testid="game-shell"]').should('be.visible');
  cy.get('.city-preparation-overlay').should((element) => {
    const r = element[0]!.getBoundingClientRect();
    expect(r.left).to.be.at.least(0);
    expect(r.right).to.be.at.most(390);
  });
  cy.screenshot('city-preparation-mobile-error');
  cy.then(() => {
    failedBeforeRetry = requests;
    expect(failedBeforeRetry).to.be.at.least(1);
    unavailable = false;
  });
  cy.contains('button', 'Retry city preparation').should('be.visible').click();
  waitForCurrentCityReady();
  cy.get('[data-testid="d3d-map-representation"]').should(
    'have.attr',
    'data-city-building-count',
    '16231',
  );
  // Failures are retryable across consumers; the successful retry is shared.
  cy.then(() => expect(requests).to.equal(failedBeforeRetry + 1));
  cy.screenshot('city-preparation-mobile-retried-frame');
});
