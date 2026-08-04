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
const restoreScenario = (scenarioId: string) => {
  openSessionControls();
  cy.contains('[data-save-id]', scenarioId)
    .contains('button', 'Restore')
    .click();
  openControls();
};
const openDialog = (name: 'Simulation controls' | 'Load') => {
  cy.get('body').then(($body) => {
    const close = $body.find('[role="dialog"] button[aria-label^="Close "]');
    if (close.length) cy.wrap(close).click();
  });
  cy.contains('button', name).click();
};
const openControls = () => openDialog('Simulation controls');
const openSessionControls = () => openDialog('Load');
const workerReadyTimeoutMs = 15_000;
const expectWorkerReady = () =>
  cy
    .get('[data-testid="worker-status"]', { timeout: workerReadyTimeoutMs })
    .should('contain.text', 'ready');

describe('built foundation PWA offline lifecycle', () => {
  afterEach(() => network(false));

  it('restores a saved Worker session from the installed offline shell', () => {
    cy.then(() => clearOrigin());
    cy.visit('./');
    openControls();
    expectWorkerReady();
    cy.get('[data-testid="scenario-coordinate"]').should(
      'contain.text',
      '1.0.0:torrevieja-legacy-abc-v1@1.0.0#',
    );
    cy.window().then(async (win) => {
      await win.navigator.serviceWorker.ready;
    });
    cy.reload();
    openControls();
    cy.window().its('navigator.serviceWorker.controller').should('not.be.null');
    expectWorkerReady();
    openSessionControls();
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
    openSessionControls();
    cy.get('[data-testid="save-count"]').should('contain.text', '0');
    cy.get('[data-testid="legacy-save-count"]').should('contain.text', '0');
    cy.get('[data-save-id="legacy-slot"]').should('not.exist');
    openControls();
    expectWorkerReady();
    cy.contains('label', 'Vehicle route').find('select').select('legacy-A');
    cy.contains('button', 'Create demo vehicle').click();
    cy.get('[data-testid="vehicle-count"]').should('contain.text', '1');
    cy.contains('label', 'Vehicle route').find('select').select('legacy-B');
    cy.contains('button', 'Create demo vehicle').click();
    cy.get('[data-testid="vehicle-count"]').should('contain.text', '2');
    cy.contains('label', 'Vehicle route').find('select').select('legacy-C');
    cy.contains('button', 'Create demo vehicle').click();
    cy.get('[data-testid="vehicle-count"]').should('contain.text', '3');
    cy.get('[data-testid="vehicle-movement-svg"]').should('be.visible');
    cy.contains('button', 'Start browser-demo-vehicle-001').click();
    cy.contains('button', 'Normal 20×').click();
    cy.get('[data-testid="worker-tick"]').should(($tick) =>
      expect(Number($tick.text().split(': ')[1])).to.be.greaterThan(0),
    );
    cy.get('[role="dialog"]').contains('button', 'Pause').click();
    cy.get('[data-testid="pacing-status"]').should('contain.text', 'paused');
    let savedTick = 0;
    let savedCoordinate = '';
    let savedSvg: VehicleSvgState = [];
    let fullSaveId = '';
    cy.get('[data-testid="worker-tick"]').then(($tick) => {
      savedTick = Number($tick.text().split(': ')[1]);
    });
    cy.get('[data-testid="scenario-coordinate"]').then(($coordinate) => {
      savedCoordinate = $coordinate.text();
    });
    vehicleSvgState().then((snapshot) => {
      savedSvg = snapshot;
      cy.wait(350);
      expectVehicleSvg(snapshot);
    });
    openSessionControls();
    cy.contains('button', 'Save transport session').click();
    cy.get('[data-testid="save-count"]').should('contain.text', '1');
    cy.contains('[data-save-id]', 'torrevieja-legacy-abc-v1').then(($row) => {
      fullSaveId = $row.attr('data-save-id')!;
    });
    cy.get('[data-testid="persistence-status"]').should(
      'have.text',
      'Persistence status: idle',
    );
    openControls();
    cy.contains('label', 'Scenario')
      .find('select')
      .select('torrevieja-legacy-east-v1', { force: true });
    cy.get('[data-testid="requested-scenario"]').should(
      'contain.text',
      'torrevieja-legacy-east-v1 (loading)',
    );
    cy.contains('label', 'Scenario').find('select').should('be.disabled');
    cy.get('[data-testid="selected-scenario"]').should(
      'contain.text',
      'torrevieja-legacy-east-v1',
    );
    cy.get('[data-testid="active-scenario"]').should(
      'contain.text',
      'torrevieja-legacy-abc-v1',
    );
    openSessionControls();
    cy.contains('button', 'Close transport Worker').click();
    openControls();
    cy.get('[data-testid="worker-status"]').should('contain.text', 'closed');
    openSessionControls();
    cy.contains('button', 'Start new transport session')
      .should('be.enabled')
      .click();
    openControls();
    expectWorkerReady();
    cy.get('[data-testid="scenario-coordinate"]').should(
      'contain.text',
      'torrevieja-legacy-east-v1@1.0.0#',
    );
    cy.get('[data-testid="vehicle-movement-svg"]').should(
      'have.attr',
      'data-scenario-id',
      'torrevieja-legacy-east-v1',
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
    cy.get('[role="dialog"]').contains('button', 'Pause').click();
    let secondarySavedTick = 0;
    let secondarySavedCoordinate = '';
    let secondarySavedSvg: VehicleSvgState = [];
    cy.get('[data-testid="worker-tick"]').then(($tick) => {
      secondarySavedTick = Number($tick.text().split(': ')[1]);
    });
    cy.get('[data-testid="scenario-coordinate"]').then(($coordinate) => {
      secondarySavedCoordinate = $coordinate.text();
    });
    vehicleSvgState().then((snapshot) => {
      secondarySavedSvg = snapshot;
      cy.wait(350);
      expectVehicleSvg(snapshot);
    });
    openSessionControls();
    cy.contains('label', 'Autosave').find('input').check();
    cy.contains('button', 'Save autosave now').click();
    cy.get('[data-testid="autosave-availability"]').should(
      'contain.text',
      'available',
    );
    cy.contains('button', 'Close transport Worker').click();
    openControls();
    cy.get('[data-testid="worker-status"]').should('contain.text', 'closed');
    cy.then(() => network(true));
    cy.reload();
    openControls();
    expectWorkerReady();
    cy.get('[data-testid="scenario-coordinate"]').should(
      'contain.text',
      '1.0.0:torrevieja-legacy-abc-v1@1.0.0#',
    );
    openSessionControls();
    cy.get('[data-testid="save-count"]').should('contain.text', '2');
    openControls();
    let currentTimeline = '';
    let currentTick = '';
    cy.get('[data-testid="worker-timeline"]').then(($value) => {
      currentTimeline = $value.text();
    });
    cy.get('[data-testid="worker-tick"]').then(($value) => {
      currentTick = $value.text();
    });
    let exactSave: Record<string, unknown>;
    cy.window().then(async (win) => {
      exactSave = await readSave(win, fullSaveId);
      const missing = structuredClone(exactSave) as {
        scenario: { scenarioId: string };
        snapshot: { scenario: { scenarioId: string } };
      };
      missing.scenario.scenarioId = 'missing-scenario';
      missing.snapshot.scenario.scenarioId = 'missing-scenario';
      await writeSave(win, missing as unknown as Record<string, unknown>);
    });
    restoreScenario('torrevieja-legacy-abc-v1');
    openSessionControls();
    cy.get('[role="alert"]').should('contain.text', 'exact saved scenario');
    openControls();
    expectWorkerReady();
    cy.get('[data-testid="worker-timeline"]').should(($value) =>
      expect($value.text()).to.equal(currentTimeline),
    );
    cy.get('[data-testid="worker-tick"]').should(($value) =>
      expect($value.text()).to.equal(currentTick),
    );
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
    restoreScenario('torrevieja-legacy-abc-v1');
    openSessionControls();
    cy.get('[role="alert"]').should('contain.text', 'exact saved scenario');
    openControls();
    expectWorkerReady();
    cy.get('[data-testid="worker-timeline"]').should(($value) =>
      expect($value.text()).to.equal(currentTimeline),
    );
    cy.get('[data-testid="worker-tick"]').should(($value) =>
      expect($value.text()).to.equal(currentTick),
    );
    cy.window().then(async (win) => {
      const transportV1 = structuredClone(exactSave) as {
        schemaVersion: number;
        snapshot: {
          schemaVersion: number;
          simulationVersion: string;
          state: { tick: number; fleet?: unknown };
        };
      };
      transportV1.schemaVersion = 1;
      transportV1.snapshot.schemaVersion = 1;
      transportV1.snapshot.simulationVersion = 'transport-1';
      transportV1.snapshot.state = { tick: savedTick };
      await writeSave(win, transportV1 as unknown as Record<string, unknown>);
    });
    restoreScenario('torrevieja-legacy-abc-v1');
    openSessionControls();
    cy.get('[role="alert"]').should(
      'contain.text',
      'pre-release save is obsolete',
    );
    openControls();
    expectWorkerReady();
    cy.get('[data-testid="worker-timeline"]').should(($value) =>
      expect($value.text()).to.equal(currentTimeline),
    );
    cy.get('[data-testid="worker-tick"]').should(($value) =>
      expect($value.text()).to.equal(currentTick),
    );
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
    restoreScenario('torrevieja-legacy-abc-v1');
    cy.get('[data-testid="worker-timeline"]').should(
      'contain.text',
      'browser-foundation-restored-',
    );
    cy.get('[data-testid="worker-tick"]').should(($tick) =>
      expect(Number($tick.text().split(': ')[1])).to.equal(savedTick),
    );
    cy.get('[data-testid="scenario-coordinate"]').should(($coordinate) =>
      expect($coordinate.text()).to.equal(savedCoordinate),
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
    cy.get('[data-testid="vehicle-count"]').should('contain.text', '3');
    cy.then(() => expectVehicleSvg(savedSvg));
    restoreScenario('torrevieja-legacy-east-v1');
    cy.get('[data-testid="worker-tick"]').should(($tick) =>
      expect(Number($tick.text().split(': ')[1])).to.equal(secondarySavedTick),
    );
    cy.get('[data-testid="scenario-coordinate"]').should(($coordinate) =>
      expect($coordinate.text()).to.equal(secondarySavedCoordinate),
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
    cy.get('[data-testid="vehicle-count"]').should('contain.text', '2');
    cy.then(() => expectVehicleSvg(secondarySavedSvg));
    cy.contains('button', 'Normal 20×').click();
    cy.get('[data-testid="worker-tick"]').should(($tick) =>
      expect(Number($tick.text().split(': ')[1])).to.be.greaterThan(
        secondarySavedTick,
      ),
    );
    cy.then(() =>
      vehicleSvgState().should((current) =>
        expect(current).not.to.deep.equal(secondarySavedSvg),
      ),
    );
    cy.get('[role="dialog"]').contains('button', 'Pause').click();
    cy.get('[data-testid="pacing-status"]').should('contain.text', 'paused');
    vehicleSvgState().then((snapshot) => {
      cy.wait(350);
      expectVehicleSvg(snapshot);
    });
    openSessionControls();
    cy.contains('button', 'Close transport Worker').click();
    openControls();
    cy.get('[data-testid="worker-status"]').should('contain.text', 'closed');
    cy.then(() => network(false));
  });
});
