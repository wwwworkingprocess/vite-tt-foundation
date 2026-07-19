import { protocolContractVersion } from '@torrevieja-tycoon/protocol';
import { simulationFoundationLabel } from '@torrevieja-tycoon/simulation';
import { lazy, Suspense, useEffect, useState } from 'react';
import { createFoundationApplicationController } from './application/foundation-controller.js';
import {
  createFoundationSessionComposition,
  type FoundationSessionCompositionState,
} from './foundation-session-composition.js';
import { createDexieFoundationSaveRepository } from './persistence/save-repository.js';
import { createDefaultBrowserPacingDriver } from './pacing/browser-pacing-driver.js';
import { createFoundationPacingController } from './pacing/foundation-pacing-controller.js';
import { createBrowserFoundationWorker } from './simulation-worker/browser-worker.js';
import { createWorkerFoundationClient } from './simulation-worker/worker-client.js';

type Actions = Readonly<{
  mode: (mode: 'paused' | 'normal' | 'fast' | 'maximum') => Promise<void>;
  bonus: () => Promise<void>;
  save: () => Promise<void>;
  restore: () => Promise<void>;
  saveMode: (mode: 'manual' | 'autosave') => Promise<void>;
  close: () => Promise<void>;
  start: () => Promise<void>;
}>;

export function App() {
  const [state, setState] = useState<FoundationSessionCompositionState>();
  const [actions, setActions] = useState<Actions>();
  useEffect(() => {
    if (typeof Worker === 'undefined') return;
    const composition = createFoundationSessionComposition({
      createStack() {
        const application = createFoundationApplicationController({
          repository: createDexieFoundationSaveRepository(
            'foundation-template',
          ),
          clientFactory: () =>
            createWorkerFoundationClient({
              workerFactory: createBrowserFoundationWorker,
            }),
        });
        const pacing = createFoundationPacingController({ application });
        return {
          application,
          pacing,
          driver: createDefaultBrowserPacingDriver(),
        };
      },
      confirm: (message) => window.confirm(message),
      timer: {
        setInterval: (callback, milliseconds) =>
          window.setInterval(callback, milliseconds),
        clearInterval: (id) => {
          if (typeof id === 'number') window.clearInterval(id);
        },
      },
      nowUtcMs: Date.now,
    });
    const remove = composition.projection.subscribe((next) => setState(next));
    setState(composition.projection.getState());
    setActions({
      mode: composition.setMode,
      bonus: composition.grantBonus,
      save: composition.saveManual,
      restore: composition.restoreManual,
      saveMode: composition.setSaveMode,
      close: composition.closeSession,
      start: composition.startNewSession,
    });
    void composition.startNewSession();
    return () => {
      remove();
      void composition.dispose();
    };
  }, []);

  const application = state?.application;
  const pacing = state?.pacing;
  const session = application?.session;
  const status =
    typeof Worker === 'undefined'
      ? 'unavailable in this environment'
      : (session?.status ?? 'starting');
  const ready = session?.status === 'ready' && state?.operation === 'idle';
  const persistenceMessage =
    application?.persistence.status === 'failed'
      ? application.persistence.message
      : undefined;
  const action = (operation: (() => Promise<void>) | undefined) => () => {
    void operation?.();
  };

  return (
    <main>
      <section aria-labelledby="foundation-title">
        <p className="eyebrow">Project foundation</p>
        <h1 id="foundation-title">Torrevieja Tycoon</h1>
        <p>
          A strict workspace for a standalone simulation and its browser client.
        </p>
        <dl aria-label="Workspace package status">
          <div>
            <dt>Simulation</dt>
            <dd>{simulationFoundationLabel}</dd>
          </div>
          <div>
            <dt>Protocol contract</dt>
            <dd>version {protocolContractVersion}</dd>
          </div>
        </dl>
        <div aria-label="Foundation Worker status">
          <p data-testid="worker-status">Worker status: {status}</p>
          <p data-testid="worker-tick">
            Worker tick:{' '}
            {application?.authoritative?.simulationTick ?? 'pending'}
          </p>
          <p data-testid="worker-timeline">
            Timeline:{' '}
            {session?.status === 'ready' ? session.timelineId : 'pending'}
          </p>
          <p data-testid="command-revision">
            Command revision:{' '}
            {application?.authoritative?.commandRevision ?? 'pending'}
          </p>
          <p data-testid="stream-offset">
            Stream offset:{' '}
            {application?.authoritative?.streamOffset ?? 'pending'}
          </p>
          <div aria-label="Foundation pacing controls">
            <button
              disabled={!ready}
              onClick={action(
                () => actions?.mode('paused') ?? Promise.resolve(),
              )}
            >
              Pause
            </button>
            <button
              disabled={!ready}
              onClick={action(
                () => actions?.mode('normal') ?? Promise.resolve(),
              )}
            >
              Normal 20×
            </button>
            <button
              disabled={!ready}
              onClick={action(() => actions?.mode('fast') ?? Promise.resolve())}
            >
              Fast 50×
            </button>
            <button
              disabled={!ready}
              onClick={action(
                () => actions?.mode('maximum') ?? Promise.resolve(),
              )}
            >
              Maximum 60×
            </button>
            <button disabled={!ready} onClick={action(actions?.bonus)}>
              Grant demo 2× bonus
            </button>
            <p data-testid="pacing-rate">
              Effective rate: {pacing?.effectiveRate ?? 0}×
            </p>
            <p data-testid="pacing-status">
              Pacing status: {pacing?.status ?? 'idle'}
              {pacing?.message ? `: ${pacing.message}` : ''}
            </p>
            <p data-testid="bonus-ticks">
              Bonus ticks remaining:{' '}
              {pacing?.remainingDoubleSpeedBonusTicks ?? 0}
            </p>
            <p data-testid="pacing-credit">
              Pacing credit: {pacing?.creditGameMicroseconds ?? 0}
            </p>
            <fieldset>
              <legend>Save mode</legend>
              <label>
                <input
                  type="radio"
                  name="save-mode"
                  checked={(state?.saveMode ?? 'manual') === 'manual'}
                  disabled={!actions}
                  onChange={action(
                    () => actions?.saveMode('manual') ?? Promise.resolve(),
                  )}
                />
                Manual
              </label>
              <label>
                <input
                  type="radio"
                  name="save-mode"
                  checked={state?.saveMode === 'autosave'}
                  disabled={!actions}
                  onChange={action(
                    () => actions?.saveMode('autosave') ?? Promise.resolve(),
                  )}
                />
                Autosave
              </label>
            </fieldset>
            <button disabled={!ready} onClick={action(actions?.save)}>
              Save foundation session
            </button>
            <button disabled={!ready} onClick={action(actions?.restore)}>
              Restore foundation session
            </button>
            <p data-testid="save-count">
              Saved sessions: {application?.persistence.saves.length ?? 0}
            </p>
            <p data-testid="persistence-status">
              Persistence status: {application?.persistence.status ?? 'idle'}
              {persistenceMessage ? `: ${persistenceMessage}` : ''}
            </p>
            {state?.message ? (
              <p role="alert">Session action failed: {state.message}</p>
            ) : null}
          </div>
          {state?.canStartNewSession ? (
            <button type="button" onClick={action(actions?.start)}>
              Start new foundation session
            </button>
          ) : (
            <button
              type="button"
              disabled={!actions || state?.operation === 'closing'}
              onClick={action(actions?.close)}
            >
              Close foundation Worker
            </button>
          )}
        </div>
      </section>
      <Suspense fallback={<p>Loading representation…</p>}>
        <FoundationScene />
      </Suspense>
    </main>
  );
}

const FoundationScene = lazy(() => import('./foundation-scene.js'));
