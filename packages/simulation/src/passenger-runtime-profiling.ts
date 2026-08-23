export type PassengerRuntimePhase =
  | 'passenger-emission'
  | 'passenger-access-arrival'
  | 'passenger-destination-waiting'
  | 'passenger-vehicle-transit'
  | 'passenger-destination-access-completion';
export type PassengerRuntimePhaseBoundary =
  0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;
export type PassengerRuntimePhaseObserver = (
  boundary: PassengerRuntimePhaseBoundary,
  primaryWork?: number,
  secondaryWork?: number,
) => void;
