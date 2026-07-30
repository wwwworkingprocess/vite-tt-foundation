/** A deliberately trivial value proving the standalone package is consumable. */
export const simulationFoundationLabel =
  'standalone simulation package' as const;

export * from './foundation-command.js';
export * from './foundation-state.js';
export * from './foundation-snapshot.js';
export * from './passenger-demand.js';
export * from './passenger-waiting-cohort.js';
export * from './time.js';
export * from './transport-simulation.js';
export * from './vehicle-movement.js';
