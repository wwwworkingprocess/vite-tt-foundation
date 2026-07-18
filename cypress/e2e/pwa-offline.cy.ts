const network = (offline: boolean) =>
  Cypress.automation('remote:debugger:protocol', {
    command: 'Network.emulateNetworkConditions',
    params: {
      offline,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    },
  });
const clearOrigin = () =>
  Cypress.automation('remote:debugger:protocol', {
    command: 'Storage.clearDataForOrigin',
    params: { origin: 'http://127.0.0.1:4174', storageTypes: 'all' },
  });

describe('built foundation PWA offline lifecycle', () => {
  afterEach(() => network(false));

  it('restores a saved Worker session from the installed offline shell', () => {
    cy.then(() => clearOrigin());
    cy.visit('./');
    cy.get('[data-testid="worker-status"]').should('contain.text', 'ready');
    cy.window().then(async (win) => {
      await win.navigator.serviceWorker.ready;
    });
    cy.reload();
    cy.window().its('navigator.serviceWorker.controller').should('not.be.null');
    cy.get('[data-testid="worker-status"]').should('contain.text', 'ready');
    cy.get('[data-testid="save-count"]').should('contain.text', '0');
    cy.contains('button', 'Normal 20×').click();
    cy.get('[data-testid="worker-tick"]').should(($tick) =>
      expect(Number($tick.text().split(': ')[1])).to.be.greaterThan(0),
    );
    cy.contains('button', 'Pause').click();
    cy.get('[data-testid="pacing-status"]').should('contain.text', 'paused');
    let savedTick = 0;
    cy.get('[data-testid="worker-tick"]').then(($tick) => {
      savedTick = Number($tick.text().split(': ')[1]);
    });
    cy.contains('button', 'Save foundation session').click();
    cy.get('[data-testid="save-count"]').should('contain.text', '1');
    cy.get('[data-testid="persistence-status"]').should(
      'have.text',
      'Persistence status: idle',
    );
    cy.then(() => network(true));
    cy.reload();
    cy.get('[data-testid="worker-status"]').should('contain.text', 'ready');
    cy.get('[data-testid="save-count"]').should('contain.text', '1');
    cy.window().then(async (win) => {
      for (const path of [
        'icons/foundation-192.png',
        'icons/foundation-512.png',
      ]) {
        const response = await win.fetch(new URL(path, win.document.baseURI));
        expect(response.ok).to.equal(true);
        expect((await response.blob()).size).to.be.greaterThan(0);
      }
    });
    cy.contains('button', 'Restore foundation session').click();
    cy.get('[data-testid="worker-timeline"]').should(
      'have.text',
      'Timeline: browser-foundation-restored',
    );
    cy.get('[data-testid="worker-tick"]').should(($tick) =>
      expect(Number($tick.text().split(': ')[1])).to.equal(savedTick),
    );
    cy.get('[data-testid="command-revision"]').should(
      'have.text',
      'Command revision: 0',
    );
    cy.get('[data-testid="stream-offset"]').should(
      'have.text',
      'Stream offset: 0',
    );
    cy.get('[data-testid="pacing-status"]').should('contain.text', 'paused');
    cy.get('[data-testid="pacing-credit"]').should(
      'have.text',
      'Pacing credit: 0',
    );
    cy.get('[data-testid="bonus-ticks"]').should(
      'have.text',
      'Bonus ticks remaining: 0',
    );
    cy.contains('button', 'Normal 20×').click();
    cy.get('[data-testid="worker-tick"]').should(($tick) =>
      expect(Number($tick.text().split(': ')[1])).to.be.greaterThan(savedTick),
    );
    cy.contains('button', 'Close foundation Worker').click();
    cy.get('[data-testid="worker-status"]').should('contain.text', 'closed');
    cy.then(() => network(false));
  });
});
