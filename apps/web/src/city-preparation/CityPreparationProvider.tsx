import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  createCityPreparationCoordinator,
  type CityPreparationCoordinator,
} from './city-preparation-coordinator.js';
import { preparationExecution } from './browser-preparation.js';
const Context = createContext<
  | {
      coordinator: CityPreparationCoordinator;
      generation: number;
      retry: () => void;
      setD3dActive: (active: boolean) => void;
    }
  | undefined
>(undefined);
export function CityPreparationProvider({
  identity,
  cityName,
  children,
}: {
  identity: string;
  cityName: string;
  children: ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  const [d3dActive, setD3dActive] = useState(true);
  const owner = useMemo(() => {
    const coordinator = createCityPreparationCoordinator();
    const generation = coordinator.begin(identity + ':' + attempt);
    if (!d3dActive) coordinator.cancel(generation);
    return {
      coordinator,
      generation,
      setD3dActive,
      retry: () => setAttempt((n) => n + 1),
    };
  }, [identity, attempt, d3dActive]);
  const state = useSyncExternalStore(
    owner.coordinator.subscribe,
    owner.coordinator.snapshot,
  );
  useEffect(() => {
    if (d3dActive) owner.coordinator.activate(owner.generation);
    return () => owner.coordinator.cancel(owner.generation);
  }, [owner, d3dActive]);
  const labels = {
    'acquiring-inputs': 'Reading city data',
    preparing: 'Preparing terrain, roads and C-cell building layouts',
    presenting: 'Presenting the first frame',
    interactive: 'Ready',
  };
  return (
    <Context.Provider value={owner}>
      <div
        className="city-preparation-host"
        data-testid="city-preparation"
        data-city-preparation-generation={state.generation + ':' + state.key}
        data-city-preparation-stage={state.stage}
        data-city-preparation-status={state.status}
        data-first-useful-frame={state.status === 'ready' ? 'presented' : ''}
        data-city-preparation-signature={state.signature ?? ''}
        data-preparation-error={state.error ?? ''}
        data-preparation-execution={preparationExecution()}
      >
        {children}
        {state.status !== 'ready' && state.status !== 'cancelled' ? (
          <div
            className="city-preparation-overlay"
            role="status"
            aria-live="polite"
            aria-busy={state.status === 'loading'}
          >
            <strong>{cityName}</strong>
            <span>{state.error ?? labels[state.stage]}</span>
            {state.status === 'error' ? (
              <button onClick={owner.retry}>Retry city preparation</button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Context.Provider>
  );
}
export function useCityPreparation() {
  return useContext(Context);
}
export function usePreparationAttempt() {
  const owner = useContext(Context);
  return owner ? owner.generation + ':' + owner.coordinator.snapshot().key : '';
}

const noSubscribe = () => () => {};
const noPreparation = Object.freeze({
  status: 'ready' as const,
  generation: 0,
  key: '',
  stage: 'interactive' as const,
});
export function useCityPreparationInteractive() {
  const owner = useCityPreparation();
  const state = useSyncExternalStore(
    owner?.coordinator.subscribe ?? noSubscribe,
    owner?.coordinator.snapshot ?? (() => noPreparation),
  );
  return state.status === 'ready';
}
