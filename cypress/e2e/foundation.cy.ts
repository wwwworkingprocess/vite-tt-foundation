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
    cy.contains('button', 'Close foundation Worker').click();
    cy.get('[data-testid="worker-status"]').should('contain.text', 'closed');
  });
});
