/** Wait on the same monotonic production stages, each with the established acquisition bound. */
export const waitForCurrentCityReady = () => {
  cy.get('[data-testid="city-preparation"]', { timeout: 15000 }).should(
    (element) => {
      expect(element.attr('data-city-preparation-stage')).to.be.oneOf([
        'preparing',
        'presenting',
        'interactive',
      ]);
      expect(element.attr('data-preparation-error')).to.equal('');
    },
  );
  return cy
    .get('[data-testid="city-preparation"]', { timeout: 15000 })
    .should((element) => {
      expect(element.attr('data-city-preparation-generation')).not.to.equal('');
      expect(element.attr('data-city-preparation-status')).to.equal('ready');
      expect(element.attr('data-first-useful-frame')).to.equal('presented');
      expect(element.attr('data-preparation-error')).to.equal('');
    });
};
