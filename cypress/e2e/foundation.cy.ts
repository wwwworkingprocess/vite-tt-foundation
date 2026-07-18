describe('foundation screen', () => {
  it('renders without a fatal application error', () => {
    cy.visit('/');
    cy.contains('h1', 'Torrevieja Tycoon').should('be.visible');
    cy.get('canvas').should('be.visible');
    cy.get('[data-testid="worker-status"]').should('contain.text', 'ready');
    cy.get('[data-testid="worker-tick"]').should('contain.text', '1');
    cy.contains('button', 'Close foundation Worker').click();
    cy.get('[data-testid="worker-status"]').should('contain.text', 'closed');
  });
});
