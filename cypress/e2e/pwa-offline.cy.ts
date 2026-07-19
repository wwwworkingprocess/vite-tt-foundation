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
const writeSave = (win: Window, value: Record<string, unknown>) =>
  new Promise<void>((resolve, reject) => {
    const request = win.indexedDB.open('foundation-template');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction(
        'foundationSaves',
        'readwrite',
      );
      transaction.objectStore('foundationSaves').put(value);
      transaction.oncomplete = () => {
        request.result.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
  });
const readSave = (win: Window, saveId: string) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    const request = win.indexedDB.open('foundation-template');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction(
        'foundationSaves',
        'readonly',
      );
      const get = transaction.objectStore('foundationSaves').get(saveId);
      get.onsuccess = () => resolve(get.result as Record<string, unknown>);
      get.onerror = () => reject(get.error);
      transaction.oncomplete = () => request.result.close();
    };
  });

describe('built foundation PWA offline lifecycle', () => {
  afterEach(() => network(false));

  it('restores a saved Worker session from the installed offline shell', () => {
    cy.then(() => clearOrigin());
    cy.visit('./');
    cy.get('[data-testid="worker-status"]').should('contain.text', 'ready');
    cy.get('[data-testid="scenario-coordinate"]').should(
      'contain.text',
      'torrevieja-v1@1.0.0#',
    );
    cy.window().then(async (win) => {
      await win.navigator.serviceWorker.ready;
    });
    cy.reload();
    cy.window().its('navigator.serviceWorker.controller').should('not.be.null');
    cy.get('[data-testid="worker-status"]').should('contain.text', 'ready');
    cy.get('[data-testid="save-count"]').should('contain.text', '0');
    cy.window().then((win) =>
      writeSave(win, {
        kind: 'foundation-save-record',
        schemaVersion: 1,
        saveId: 'legacy-slot',
        gameId: 'legacy-game',
        sourceTimelineId: 'legacy-timeline',
        sourceCommandRevision: 0,
        sourceSimulationTick: 0,
        sourceStreamOffset: 0,
        createdAtUtcMs: 1,
        updatedAtUtcMs: 1,
        snapshot: {
          kind: 'foundation-simulation-snapshot',
          schemaVersion: 1,
          simulationVersion: 'foundation-1',
          state: { tick: 0 },
        },
      }),
    );
    cy.reload();
    cy.get('[data-testid="worker-status"]').should('contain.text', 'ready');
    cy.get('[data-testid="legacy-save-count"]').should('contain.text', '1');
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
    cy.contains('button', 'Save transport session').click();
    cy.get('[data-testid="save-count"]').should('contain.text', '2');
    cy.get('[data-testid="persistence-status"]').should(
      'have.text',
      'Persistence status: idle',
    );
    cy.contains('button', 'Close transport Worker').click();
    cy.get('[data-testid="worker-status"]').should('contain.text', 'closed');
    cy.then(() => network(true));
    cy.reload();
    cy.get('[data-testid="worker-status"]').should('contain.text', 'ready');
    cy.get('[data-testid="scenario-coordinate"]').should(
      'contain.text',
      'torrevieja-v1@1.0.0#',
    );
    cy.get('[data-testid="save-count"]').should('contain.text', '2');
    let exactSave: Record<string, unknown>;
    cy.window().then(async (win) => {
      exactSave = await readSave(win, 'foundation-slot');
      const missing = structuredClone(exactSave) as {
        scenario: { scenarioId: string };
        snapshot: { scenario: { scenarioId: string } };
      };
      missing.scenario.scenarioId = 'missing-scenario';
      missing.snapshot.scenario.scenarioId = 'missing-scenario';
      await writeSave(win, missing as unknown as Record<string, unknown>);
    });
    cy.contains('button', 'Restore manual save').click();
    cy.get('[data-testid="worker-status"]').should('contain.text', 'ready');
    cy.get('[role="alert"]').should('contain.text', 'exact saved scenario');
    cy.window().then(async (win) => {
      await writeSave(win, exactSave);
      const mismatch = structuredClone(exactSave) as {
        scenario: { contentHash: string };
        snapshot: { scenario: { contentHash: string } };
      };
      mismatch.scenario.contentHash = 'b'.repeat(64);
      mismatch.snapshot.scenario.contentHash = 'b'.repeat(64);
      await writeSave(win, mismatch as unknown as Record<string, unknown>);
    });
    cy.contains('button', 'Restore manual save').click();
    cy.get('[data-testid="worker-status"]').should('contain.text', 'ready');
    cy.get('[role="alert"]').should('contain.text', 'exact saved scenario');
    cy.window().then((win) => writeSave(win, exactSave));
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
    cy.contains('button', 'Restore manual save').click();
    cy.get('[data-testid="worker-timeline"]').should(
      'contain.text',
      'browser-foundation-restored-',
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
    cy.contains('button', 'Close transport Worker').click();
    cy.get('[data-testid="worker-status"]').should('contain.text', 'closed');
    cy.then(() => network(false));
  });
});
