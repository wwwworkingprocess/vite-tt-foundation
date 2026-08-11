import type { ReactNode } from 'react';
import type { TransportSaveSummary } from '../transport-simulation/transport-save-record.js';
import { formatLastPlayed } from './open-screen-model.js';

export interface OpenScreenProps {
  readonly state:
    'booting' | 'open' | 'creating' | 'restoring' | 'recoverable-failure';
  readonly scenarioChooser: ReactNode;
  readonly selectedScenarioReady: boolean;
  readonly resolverReady: boolean;
  readonly resumableSave?: TransportSaveSummary | undefined;
  readonly unavailableSaveMessage?: string | undefined;
  readonly message?: string | undefined;
  readonly nowUtcMs?: number | undefined;
  readonly onCreate: () => void;
  readonly onContinue: (save: TransportSaveSummary) => void;
  readonly onRetryBootstrap?: (() => void) | undefined;
}

export default function OpenScreen({
  state,
  scenarioChooser,
  selectedScenarioReady,
  resolverReady,
  resumableSave,
  unavailableSaveMessage,
  message,
  nowUtcMs = Date.now(),
  onCreate,
  onContinue,
  onRetryBootstrap,
}: OpenScreenProps) {
  const busy =
    state === 'booting' || state === 'creating' || state === 'restoring';
  return (
    <main className="open-screen" data-testid="open-screen" data-state={state}>
      <h1>Torrevieja Tycoon</h1>
      <p>Choose a city and transport scenario, or continue your saved game.</p>
      {resumableSave ? (
        <section aria-labelledby="continue-heading">
          <h2 id="continue-heading">Continue</h2>
          <p>{resumableSave.label ?? resumableSave.scenarioId}</p>
          <p>Saved at simulation tick {resumableSave.sourceSimulationTick}</p>
          <p>{formatLastPlayed(resumableSave.updatedAtUtcMs, nowUtcMs)}</p>
          <button
            disabled={busy || !resolverReady}
            onClick={() => onContinue(resumableSave)}
          >
            Continue saved game
          </button>
        </section>
      ) : null}
      {unavailableSaveMessage ? (
        <p role="status">{unavailableSaveMessage}</p>
      ) : null}
      <section aria-labelledby="new-game-heading">
        <h2 id="new-game-heading">New game</h2>
        {scenarioChooser}
        <button disabled={busy || !selectedScenarioReady} onClick={onCreate}>
          Start new game
        </button>
      </section>
      {message ? <p role="alert">{message}</p> : null}
      {state === 'recoverable-failure' && onRetryBootstrap ? (
        <button onClick={onRetryBootstrap}>Retry loading</button>
      ) : null}
      {state === 'booting' ? (
        <p>Loading saved sessions and scenarios...</p>
      ) : null}
      {state === 'creating' ? <p>Creating authoritative game...</p> : null}
      {state === 'restoring' ? <p>Restoring authoritative game...</p> : null}
    </main>
  );
}
