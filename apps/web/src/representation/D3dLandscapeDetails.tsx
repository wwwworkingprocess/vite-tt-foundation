import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  Color,
  MeshLambertMaterial,
  Object3D,
  type InstancedMesh,
} from 'three';
import {
  createLandscapePrototype,
  landscapePrototypeInfo,
} from './d3d-landscape-geometry.js';
import type { LandscapeFamily } from './d3d-landscape-policy.js';
import type { LandscapeDetailPlan } from './d3d-landscape-scene.js';
import { d3dMaterialPresets } from './d3d-material-presets.js';
export function createLandscapeResources(plan: LandscapeDetailPlan) {
  const material = new MeshLambertMaterial({ color: '#ffffff' });
  const families = (
    Object.keys(landscapePrototypeInfo) as LandscapeFamily[]
  ).filter((f) => plan.instances.some((i) => i.family === f));
  const batches = families.flatMap((family) => {
    const prototypes = createLandscapePrototype(family),
      instances = plan.instances.filter((i) => i.family === family);
    return (['trunk', 'foliage'] as const).flatMap((part) => {
      const geometry = prototypes[part];
      return geometry ? [{ family, part, geometry, material, instances }] : [];
    });
  });
  const geometryBytes = batches.reduce(
    (n, b) =>
      n +
      Object.values(b.geometry.attributes).reduce(
        (n, a) => n + a.array.byteLength,
        0,
      ) +
      (b.geometry.index?.array.byteLength ?? 0),
    0,
  );
  return {
    batches,
    gpuBytes:
      geometryBytes + batches.reduce((n, b) => n + b.instances.length * 76, 0),
    dispose() {
      for (const b of batches) b.geometry.dispose();
      material.dispose();
    },
  };
}
type Batch = ReturnType<typeof createLandscapeResources>['batches'][number];
/** Existing instancing seam, reusable by future building palettes without changing building shaders here. */
export function writeLandscapeInstances(mesh: InstancedMesh, batch: Batch) {
  const object = new Object3D(),
    color = new Color();
  batch.instances.forEach((i, index) => {
    object.position.set(i.x, i.y, i.z);
    object.rotation.set(0, i.rotation, 0);
    object.scale.set(i.width, i.height, i.depth);
    object.updateMatrix();
    mesh.setMatrixAt(index, object.matrix);
    color.set(
      d3dMaterialPresets.landscape[i.family][batch.part][i.colorVariant]!,
    );
    mesh.setColorAt(index, color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  // setColorAt creates the actual instanced attribute before this publication.
  mesh.instanceColor!.needsUpdate = true;
  mesh.computeBoundingSphere();
}
function LandscapeBatch({
  batch,
  onDraw,
}: {
  batch: Batch;
  onDraw: () => void;
}) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current!;
    writeLandscapeInstances(mesh, batch);
    return () => mesh.dispose();
  }, [batch]);
  return (
    <instancedMesh
      ref={ref}
      name={'landscape-' + batch.family + '-' + batch.part}
      args={[batch.geometry, batch.material, batch.instances.length]}
      dispose={null}
      raycast={() => null}
      onAfterRender={onDraw}
    />
  );
}
/** One scene owns prototype/material/instance resources; immutable CPU plans never own GPU objects. */
export function D3dLandscapeDetails({
  plan,
  onDraw,
}: {
  plan: LandscapeDetailPlan;
  onDraw: (gpuBytes: number, batches: number) => void;
}) {
  const resources = useMemo(() => createLandscapeResources(plan), [plan]),
    active = useRef<typeof resources | null>(null);
  useLayoutEffect(() => {
    active.current = resources;
    return () => {
      active.current = null;
    };
  }, [resources]);
  useEffect(() => () => resources.dispose(), [resources]);
  const drawn = () => {
    if (active.current === resources)
      onDraw(resources.gpuBytes, resources.batches.length);
  };
  return (
    <group name="landscape-details" dispose={null}>
      {resources.batches.map((b) => (
        <LandscapeBatch
          key={b.family + ':' + b.part}
          batch={b}
          onDraw={drawn}
        />
      ))}
    </group>
  );
}
