import { Canvas } from '@react-three/fiber';

export default function FoundationScene() {
  return (
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
  );
}
