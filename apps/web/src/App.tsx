import { Canvas } from '@react-three/fiber';
import {
  parseCommandId,
  parseFoundationCommandEnvelope,
  parseGameId,
  parseTimelineId,
  protocolFoundationVersion,
} from '@torrevieja-tycoon/protocol';
import { simulationFoundationLabel } from '@torrevieja-tycoon/simulation';
import { useEffect, useState } from 'react';
import { createBrowserFoundationWorker } from './simulation-worker/browser-worker.js';
import { createWorkerFoundationClient } from './simulation-worker/worker-client.js';

export function App() {
  const [workerStatus, setWorkerStatus] = useState('starting');
  const [workerTick, setWorkerTick] = useState<number>();
  const [closeWorker, setCloseWorker] = useState<() => void>(() => () => {});

  useEffect(() => {
    if (typeof Worker === 'undefined') {
      setWorkerStatus('unavailable in this environment');
      return;
    }
    const gameId = parseGameId('browser-foundation-game');
    const timelineId = parseTimelineId('browser-foundation-timeline');
    const client = createWorkerFoundationClient({
      workerFactory: createBrowserFoundationWorker,
    });
    let active = true;
    const removeUpdate = client.subscribeReliableUpdates((update) => {
      if (active) setWorkerTick(update.simulationTick);
    });
    setCloseWorker(() => () => {
      active = false;
      removeUpdate();
      void client.close().then(() => setWorkerStatus('closed'));
    });
    void client
      .connect({ mode: 'new', gameId, timelineId, initialSimulationTick: 0 })
      .then(async () => {
        if (active) setWorkerStatus('ready');
        await client.sendCommand(
          parseFoundationCommandEnvelope({
            kind: 'foundation-command',
            gameId,
            timelineId,
            commandId: parseCommandId('browser-command-1'),
            correlationId: 'browser-correlation-1',
            clientId: 'browser-client',
            sessionId: 'browser-session',
            expectedCommandRevision: 0,
            command: { type: 'foundation.advance-ticks', count: 1 },
          }),
        );
      })
      .catch((error: unknown) => {
        if (active)
          setWorkerStatus(
            error instanceof Error ? `failed: ${error.message}` : 'failed',
          );
      });
    return () => {
      active = false;
      removeUpdate();
      void client.close();
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
          <p data-testid="worker-status">Worker status: {workerStatus}</p>
          <p data-testid="worker-tick">
            Worker tick: {workerTick ?? 'pending'}
          </p>
          <button type="button" onClick={closeWorker}>
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
