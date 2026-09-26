import { ControlIcon } from '../ui/ControlIcon.js';
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
        aria-pressed={populationVisible}
        onClick={() => onPopulationVisibleChange(!populationVisible)}
      >
        <ControlIcon name="layers" />
        {populationVisible ? 'Hide population' : 'Show population'}
      </button>
      <button
        type="button"
        aria-pressed={passengersVisible}
        onClick={() => onPassengersVisibleChange(!passengersVisible)}
      >
        <ControlIcon name="people" />
        {passengersVisible ? 'Hide passengers' : 'Show passengers'}
      </button>
    </RepresentationViewActions>
  );
}
