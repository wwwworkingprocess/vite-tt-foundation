import { Canvas, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { useRepresentationMode } from './representation/RepresentationModeContext.js';
import {
  createRepresentationFrameDriver,
  representationCadence,
} from './representation/representation-cadence.js';
import {
  beginRepresentationProfile,
  finishRepresentationProfile,
  recordRepresentationProfile,
} from './performance/representation-profiler.js';

function RepresentationFrameDriver() {
  const mode = useRepresentationMode();
  const advance = useThree(({ advance }) => advance);
  useEffect(() => {
    const driver = createRepresentationFrameDriver({
      mode,
      now: () => performance.now(),
      setTimer: (callback, delay) => window.setTimeout(callback, delay),
      cancel: (handle) => window.clearTimeout(handle as number),
      frame: (time) => {
        const profile = beginRepresentationProfile('r3f.advance');
        advance(time);
        if (profile) {
          const detail = {
            targetFramesPerSecond:
              representationCadence(mode).targetFramesPerSecond,
          };
          finishRepresentationProfile(profile, detail);
          recordRepresentationProfile('r3f.frame', detail);
        }
      },
    });
    return () => driver.close();
  }, [advance, mode]);
  return null;
}

export default function FoundationScene() {
  const mode = useRepresentationMode();
  const cadence = representationCadence(mode);
  return (
    <section
      className="scene"
      aria-label="Three-dimensional renderer smoke test"
      data-representation-mode={mode}
      data-target-frames-per-second={cadence.targetFramesPerSecond}
    >
      <Canvas
        frameloop="never"
        fallback={<p>3D renderer unavailable.</p>}
        camera={{ position: [0, 0, 3] }}
      >
        <RepresentationFrameDriver />
        <ambientLight intensity={1.5} />
        <mesh rotation={[0.3, 0.5, 0]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#ef6a4c" />
        </mesh>
      </Canvas>
    </section>
  );
}
