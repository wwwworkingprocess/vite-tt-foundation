describe('foundation screen', () => {
  it('renders without a fatal application error', () => {
    cy.visit('/');
    cy.contains('h1', 'Torrevieja Tycoon').should('be.visible');
    cy.get('canvas').should('be.visible');
  });
});
