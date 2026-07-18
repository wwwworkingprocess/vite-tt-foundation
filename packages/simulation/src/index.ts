/** A deliberately trivial value proving the standalone package is consumable. */
export const simulationFoundationLabel =
  'standalone simulation package' as const;

export * from './foundation-command.js';
export * from './foundation-state.js';
export * from './foundation-snapshot.js';
export * from './time.js';
