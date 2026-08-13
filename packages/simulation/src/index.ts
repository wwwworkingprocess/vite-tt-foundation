/** A deliberately trivial value proving the standalone package is consumable. */
export const simulationFoundationLabel =
  'standalone simulation package' as const;

export * from './foundation-command.js';
export * from './foundation-state.js';
export * from './foundation-snapshot.js';
export {
  passengerDemandPlanSchemaVersion,
  listPassengerDestinationCandidates,
  allocatePassengerDestinations,
  parsePassengerDemandPlan,
  createPassengerDemandPlan,
  createDisabledPassengerDemandState,
  parsePassengerDemandState,
  createInitialPassengerDemandState,
  calculatePassengerAccessTicks,
  validatePassengerDemandState,
  advancePassengerDemandToTick,
  advancePassengerDemandToTickWithEvents,
  parsePassengerOriginStopArrivalEvents,
  parsePassengerDemandProjection,
  projectPassengerDemand,
  type PassengerDemandModelHash,
  type PassengerGroupId,
  type PassengerJourneyGroupId,
  type PassengerDemandPlanCell,
  type PassengerDemandPlanStop,
  type PassengerDemandPlanV1,
  type PassengerCellCreditState,
  type AccessingPassengerGroup,
  type StopPlaceArrivalState,
  type PassengerDestinationCandidate,
  type PassengerDestinationCursorState,
  type PassengerOriginStopArrivalEvent,
  type PassengerDemandAdvancementResult,
  type DestinationAssignedPassengerGroup,
  type DisabledPassengerDemandState,
  type ActivePassengerDemandState,
  type PassengerDemandState,
  type PassengerDemandProjection,
} from './passenger-demand.js';
export * from './passenger-waiting-cohort.js';
export * from './passenger-boarding.js';
export * from './passenger-transit.js';
export * from './time.js';
export * from './transport-simulation.js';
export * from './vehicle-movement.js';
export * from './vehicle-operation.js';
