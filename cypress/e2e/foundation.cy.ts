describe('foundation screen', () => {
  it('renders without a fatal application error', () => {
    cy.visit('/');
    cy.contains('h1', 'Torrevieja Tycoon').should('be.visible');
    cy.get('canvas').should('be.visible');
    cy.get('[data-testid="worker-status"]').should('contain.text', 'ready');
    cy.get('[data-testid="worker-tick"]').should('contain.text', '0');
    cy.contains('button', 'Normal 20×').click();
    cy.get('[data-testid="worker-tick"]').should(($tick) => {
      expect(Number($tick.text().split(': ')[1])).to.be.greaterThan(0);
    });
    cy.contains('button', 'Grant demo 2× bonus').click();
    cy.get('[data-testid="pacing-rate"]').should('contain.text', '40×');
    cy.get('[data-testid="bonus-ticks"]').should('not.contain.text', '24');
    cy.contains('button', 'Pause').click();
    cy.get('[data-testid="worker-tick"]')
      .invoke('text')
      .then((pausedTick) => {
        cy.wait(350);
        cy.get('[data-testid="worker-tick"]').should('have.text', pausedTick);
      });
    cy.contains('button', 'Close transport Worker').click();
    cy.get('[data-testid="worker-status"]').should('contain.text', 'closed');
    cy.contains('button', 'Start new transport session').click();
    cy.get('[data-testid="worker-status"]').should('contain.text', 'ready');
    cy.get('[data-testid="worker-timeline"]').should(
      'contain.text',
      'browser-foundation-timeline-2',
    );
  });

  it('keeps selection separate from authority and restores both scenarios', () => {
    cy.visit('/');
    cy.get('[data-testid="worker-status"]').should('contain.text', 'ready');
    cy.get('[data-testid="active-scenario"]').should(
      'contain.text',
      'torrevieja-v1',
    );
    cy.contains('button', /^Normal /).click();
    cy.get('[data-testid="worker-tick"]').should(($tick) =>
      expect(Number($tick.text().split(': ')[1])).to.be.greaterThan(0),
    );
    cy.contains('button', 'Pause').click();
    let fullTick = 0;
    let fullTimeline = '';
    cy.get('[data-testid="worker-tick"]').then(($tick) => {
      fullTick = Number($tick.text().split(': ')[1]);
    });
    cy.get('[data-testid="worker-timeline"]').then(($timeline) => {
      fullTimeline = $timeline.text();
    });
    cy.contains('button', 'Save transport session').click();
    cy.get('[data-testid="manual-save-availability"]').should(
      'contain.text',
      'available',
    );

    cy.get('select').select('torrevieja-mini-v1');
    cy.get('[data-testid="selected-scenario"]').should(
      'contain.text',
      'torrevieja-mini-v1',
    );
    cy.get('[data-testid="active-scenario"]').should(
      'contain.text',
      'torrevieja-v1',
    );
    cy.get('[data-testid="worker-timeline"]').should(($timeline) =>
      expect($timeline.text()).to.equal(fullTimeline),
    );
    cy.get('[data-testid="worker-tick"]').should(($tick) =>
      expect(Number($tick.text().split(': ')[1])).to.equal(fullTick),
    );

    cy.contains('button', 'Close transport Worker').click();
    cy.contains('button', 'Start new transport session').click();
    cy.get('[data-testid="worker-status"]').should('contain.text', 'ready');
    cy.get('[data-testid="active-scenario"]').should(
      'contain.text',
      'torrevieja-mini-v1',
    );
    cy.contains('button', /^Normal /).click();
    cy.get('[data-testid="worker-tick"]').should(($tick) =>
      expect(Number($tick.text().split(': ')[1])).to.be.greaterThan(0),
    );
    cy.contains('button', 'Pause').click();
    let miniTick = 0;
    cy.get('[data-testid="worker-tick"]').then(($tick) => {
      miniTick = Number($tick.text().split(': ')[1]);
    });
    cy.contains('label', 'Autosave').find('input').check();
    cy.contains('button', 'Save autosave now').click();
    cy.get('[data-testid="autosave-availability"]').should(
      'contain.text',
      'available',
    );

    cy.contains('label', 'Manual').find('input').check();
    cy.contains('button', 'Restore manual save').click();
    cy.get('[data-testid="scenario-coordinate"]').should(
      'contain.text',
      'torrevieja-v1@1.0.0#',
    );
    cy.get('[data-testid="worker-tick"]').should(($tick) =>
      expect(Number($tick.text().split(': ')[1])).to.equal(fullTick),
    );
    cy.get('[data-testid="command-revision"]').should('contain.text', '0');
    cy.get('[data-testid="stream-offset"]').should('contain.text', '0');

    cy.contains('label', 'Autosave').find('input').check();
    cy.contains('button', 'Restore autosave').click();
    cy.get('[data-testid="scenario-coordinate"]').should(
      'contain.text',
      'torrevieja-mini-v1@1.0.0#',
    );
    cy.get('[data-testid="worker-tick"]').should(($tick) =>
      expect(Number($tick.text().split(': ')[1])).to.equal(miniTick),
    );
    cy.contains('button', /^Normal /).click();
    cy.get('[data-testid="worker-tick"]').should(($tick) =>
      expect(Number($tick.text().split(': ')[1])).to.be.greaterThan(miniTick),
    );
    cy.contains('button', 'Close transport Worker').click();
    cy.get('[data-testid="worker-status"]').should('contain.text', 'closed');
  });
});
