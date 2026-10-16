import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, MeshLambertMaterial } from 'three';
import type { TypedLandCoverPlan } from './d3d-typed-land-covers.js';
import { resolveTypedLandCoverMaterial } from './d3d-material-presets.js';
export function createTypedLandCoverResources(plan: TypedLandCoverPlan) {
  const batches = plan.batches.map((batch) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(batch.positions, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const material = new MeshLambertMaterial({
      color: resolveTypedLandCoverMaterial(batch.type),
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -0.5,
      polygonOffsetUnits: -0.5,
    });
    return { ...batch, geometry, material };
  });
  return {
    batches,
    dispose: () => {
      for (const b of batches) {
        b.geometry.dispose();
        b.material.dispose();
      }
    },
  };
}
/** GPU buffers/materials belong to this mounted scene, never the shared CPU plan. */
export function D3dTypedLandCovers({
  plan,
  onDraw,
}: {
  plan: TypedLandCoverPlan;
  onDraw: () => void;
}) {
  const resources = useMemo(() => createTypedLandCoverResources(plan), [plan]);
  const active = useRef<typeof resources | null>(null);
  useLayoutEffect(() => {
    active.current = resources;
    return () => {
      active.current = null;
    };
  }, [resources]);
  useEffect(() => () => resources.dispose(), [resources]);
  return (
    <group name="typed-land-covers" dispose={null}>
      {resources.batches.map((b) => (
        <mesh
          key={b.type}
          name={'typed-land-cover-' + b.type}
          geometry={b.geometry}
          material={b.material}
          renderOrder={b.renderOrder}
          raycast={() => null}
          dispose={null}
          onAfterRender={() => {
            if (active.current === resources) onDraw();
          }}
        />
      ))}
    </group>
  );
}
