import { Canvas } from '@react-three/fiber';
import { protocolFoundationVersion } from '@torrevieja-tycoon/protocol';
import { simulationFoundationLabel } from '@torrevieja-tycoon/simulation';

export function App() {
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
