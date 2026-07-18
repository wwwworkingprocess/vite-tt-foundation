import { Canvas } from '@react-three/fiber';
import {
  parseGameId,
  parseTimelineId,
  protocolFoundationVersion,
} from '@torrevieja-tycoon/protocol';
import { simulationFoundationLabel } from '@torrevieja-tycoon/simulation';
import { useEffect, useState } from 'react';
import { createFoundationApplicationController } from './application/foundation-controller.js';
import { createInMemoryFoundationSaveRepository } from './persistence/save-repository.js';
import { createDefaultBrowserPacingDriver } from './pacing/browser-pacing-driver.js';
import {
  createFoundationPacingController,
  type FoundationPacingState,
} from './pacing/foundation-pacing-controller.js';
import { createBrowserFoundationWorker } from './simulation-worker/browser-worker.js';
import { createWorkerFoundationClient } from './simulation-worker/worker-client.js';

export function App() {
  const [status, setStatus] = useState('starting');
  const [tick, setTick] = useState<number>();
  const [pacingState, setPacingState] = useState<FoundationPacingState>();
  const [actions, setActions] = useState<{
    mode: (mode: 'paused' | 'normal' | 'fast' | 'maximum') => void;
    bonus: () => void;
    close: () => void;
  }>();
  useEffect(() => {
    if (typeof Worker === 'undefined') {
      setStatus('unavailable in this environment');
      return;
    }
    let active = true;
    const application = createFoundationApplicationController({
      repository: createInMemoryFoundationSaveRepository(),
      clientFactory: () =>
        createWorkerFoundationClient({
          workerFactory: createBrowserFoundationWorker,
        }),
    });
    const pacing = createFoundationPacingController({ application });
    const driver = createDefaultBrowserPacingDriver();
    const removeApp = application.projection.subscribe((state) => {
      if (!active) return;
      setStatus(state.session.status);
      setTick(state.authoritative?.simulationTick);
    });
    const removePacing = pacing.projection.subscribe((state) => {
      if (active) setPacingState(state);
    });
    setPacingState(pacing.projection.getState());
    const close = () => {
      if (!active) return;
      active = false;
      driver.close();
      void pacing
        .close()
        .then(() => application.close())
        .catch(() => undefined)
        .finally(() => setStatus('closed'));
    };
    setActions({
      mode: (mode) => void pacing.setMode(mode).catch(() => undefined),
      bonus: () => void pacing.grantDoubleSpeedBonus(24).catch(() => undefined),
      close,
    });
    void application
      .startNew({
        gameId: parseGameId('browser-foundation-game'),
        timelineId: parseTimelineId('browser-foundation-timeline'),
        initialSimulationTick: 0,
      })
      .then(() => {
        if (active) {
          setStatus('ready');
          setTick(0);
          driver.start((elapsed) =>
            pacing.advanceByElapsedMicroseconds(elapsed),
          );
        }
      })
      .catch((error: unknown) => {
        if (active)
          setStatus(
            error instanceof Error ? `failed: ${error.message}` : 'failed',
          );
      });
    return () => {
      active = false;
      removeApp();
      removePacing();
      driver.close();
      void pacing
        .close()
        .then(() => application.close())
        .catch(() => undefined);
    };
  }, []);
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
            <dt>Protocol foundation</dt>
            <dd>version {protocolFoundationVersion}</dd>
          </div>
        </dl>
        <div aria-label="Foundation Worker status">
          <p data-testid="worker-status">Worker status: {status}</p>
          <p data-testid="worker-tick">Worker tick: {tick ?? 'pending'}</p>
          <div aria-label="Foundation pacing controls">
            <button
              disabled={status === 'closed'}
              onClick={() => actions?.mode('paused')}
            >
              Pause
            </button>
            <button
              disabled={status === 'closed'}
              onClick={() => actions?.mode('normal')}
            >
              Normal 20×
            </button>
            <button
              disabled={status === 'closed'}
              onClick={() => actions?.mode('fast')}
            >
              Fast 50×
            </button>
            <button
              disabled={status === 'closed'}
              onClick={() => actions?.mode('maximum')}
            >
              Maximum 60×
            </button>
            <button
              disabled={status === 'closed'}
              onClick={() => actions?.bonus()}
            >
              Grant demo 2× bonus
            </button>
            <p data-testid="pacing-rate">
              Effective rate: {pacingState?.effectiveRate ?? 0}×
            </p>
            <p data-testid="pacing-status">
              Pacing status: {pacingState?.status ?? 'idle'}
              {pacingState?.message ? `: ${pacingState.message}` : ''}
            </p>
            <p data-testid="bonus-ticks">
              Bonus ticks remaining:{' '}
              {pacingState?.remainingDoubleSpeedBonusTicks ?? 0}
            </p>
          </div>
          <button
            type="button"
            disabled={status === 'closed'}
            onClick={() => actions?.close()}
          >
            Close foundation Worker
          </button>
        </div>
      </section>
      <section
        className="scene"
        aria-label="Three-dimensional renderer smoke test"
      >
        <Canvas
          fallback={<p>3D renderer unavailable.</p>}
          camera={{ position: [0, 0, 3] }}
        >
          <ambientLight intensity={1.5} />
          <mesh rotation={[0.3, 0.5, 0]}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color="#ef6a4c" />
          </mesh>
        </Canvas>
      </section>
    </main>
  );
}
