import { RepresentationViewActions } from './RepresentationViewActions.js';

export function TransportMapViewActions({
  populationVisible,
  passengersVisible,
  onPopulationVisibleChange,
  onPassengersVisibleChange,
}: Readonly<{
  populationVisible: boolean;
  passengersVisible: boolean;
  onPopulationVisibleChange: (visible: boolean) => void;
  onPassengersVisibleChange: (visible: boolean) => void;
}>) {
  return (
    <RepresentationViewActions>
      <button
        type="button"
        onClick={() => onPopulationVisibleChange(!populationVisible)}
      >
        {populationVisible ? 'Hide population' : 'Show population'}
      </button>
      <button
        type="button"
        onClick={() => onPassengersVisibleChange(!passengersVisible)}
      >
        {passengersVisible ? 'Hide passengers' : 'Show passengers'}
      </button>
    </RepresentationViewActions>
  );
}
