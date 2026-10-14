import {
  resolveSiteMaterial,
  resolveKitMaterials,
} from './d3d-material-presets.js';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  SphereGeometry,
  BufferGeometry,
  BufferAttribute,
  MeshLambertMaterial,
  Object3D,
  type InstancedMesh,
} from 'three';
import type { MaterializationPlan, SiteKit } from './d3d-materialization.js';
import type { D3dLodBand } from './d3d-map-model.js';
import { materializationLevel } from './city-materialization-loader.js';
/** Shared low-poly approximations, deliberately not faithful architectural models. */
export function createMaterializationKit(kit: SiteKit) {
  const body =
    kit === 'tower-proxy-v0'
      ? new CylinderGeometry(0.48, 0.5, 0.88, 10)
      : kit === 'civic-proxy-v0' ||
          kit === 'salt-stack-v0' ||
          kit === 'small-boat-v0'
        ? new BoxGeometry(1, 0.8, 1)
        : new CylinderGeometry(0.035, 0.06, 0.8, 6);
  body.translate(0, kit === 'tower-proxy-v0' ? 0.44 : 0.4, 0);
  const roof =
    kit === 'tower-proxy-v0'
      ? new CylinderGeometry(0.5, 0.5, 0.12, 10)
      : kit === 'park-tree-v0'
        ? new SphereGeometry(0.5, 6, 4)
        : kit === 'civic-proxy-v0' || kit === 'salt-stack-v0'
          ? new BoxGeometry(1, 0.16, 1)
          : new ConeGeometry(0.5, 0.22, kit === 'beach-umbrella-v0' ? 8 : 4);
  if (kit === 'market-canopy-v0') {
    roof.rotateY(Math.PI / 4);
    roof.scale(Math.SQRT2, 1, Math.SQRT2);
  }
  roof.translate(0, kit === 'park-tree-v0' ? 0.65 : 0.9, 0);
  return { body, roof };
}
export function createMaterializationResources(plan: MaterializationPlan) {
  const surfaces = plan.surfaces.map((s) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(s.positions, 3));
    if (s.toneWeights) {
      const colors = new Float32Array(s.toneWeights.length * 3);
      for (let i = 0; i < s.toneWeights.length; i++)
        colors.fill(s.toneWeights[i]!, i * 3, i * 3 + 3);
      geometry.setAttribute('color', new BufferAttribute(colors, 3));
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const material = new MeshLambertMaterial({
      color: resolveSiteMaterial(plan.settlementId, s.materialPreset, s.siteId),
      vertexColors: s.toneWeights !== undefined,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    return { siteId: s.siteId, geometry, material };
  });
  const keys = [...new Set(plan.instances.map((i) => i.kit))];
  const kits = keys.map((kit) => ({
    kit,
    instances: plan.instances.filter((i) => i.kit === kit),
    ...createMaterializationKit(kit),
    bodyMaterial: new MeshLambertMaterial({
      color: resolveKitMaterials(kit)[0],
    }),
    roofMaterial: new MeshLambertMaterial({
      color: resolveKitMaterials(kit)[1],
    }),
  }));
  return {
    surfaces,
    kits,
    dispose() {
      for (const s of surfaces) {
        s.geometry.dispose();
        s.material.dispose();
      }
      for (const k of kits) {
        k.body.dispose();
        k.roof.dispose();
        k.bodyMaterial.dispose();
        k.roofMaterial.dispose();
      }
    },
  };
}
function SiteKitBatch({
  batch,
  part,
  onDraw,
}: Readonly<{
  batch: ReturnType<typeof createMaterializationResources>['kits'][number];
  part: 'body' | 'roof';
  onDraw: () => void;
}>) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current!;
    const object = new Object3D();
    batch.instances.forEach((i, index) => {
      object.position.set(i.x, i.y, i.z);
      object.rotation.set(0, i.rotation, 0);
      object.scale.set(i.width, i.height, i.depth);
      object.updateMatrix();
      mesh.setMatrixAt(index, object.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    // The batch owns instance attributes; shared prototypes have a separate owner.
    return () => mesh.dispose();
  }, [batch]);
  return (
    <instancedMesh
      ref={ref}
      name={'materialization-' + batch.kit + '-' + part}
      args={[
        batch[part],
        part === 'body' ? batch.bodyMaterial : batch.roofMaterial,
        batch.instances.length,
      ]}
      raycast={() => null}
      dispose={null}
      onAfterRender={onDraw}
    />
  );
}
export function D3dMaterialization({
  plan,
  lod,
  wrapper,
}: Readonly<{
  plan: MaterializationPlan;
  lod: D3dLodBand;
  wrapper: React.RefObject<HTMLElement | null>;
}>) {
  const resources = useMemo(() => createMaterializationResources(plan), [plan]);
  const token = useMemo(() => ({}), [plan, lod]);
  const active = useRef<object | null>(null),
    ack = useRef(false);
  useLayoutEffect(() => {
    active.current = token;
    ack.current = false;
    const element = wrapper.current;
    if (element) element.dataset.renderedMaterializationLevel = '';
    return () => {
      active.current = null;
      if (element) element.dataset.renderedMaterializationLevel = '';
    };
  }, [token, wrapper]);
  useEffect(() => () => resources.dispose(), [resources]);
  const drawn = () => {
    if (active.current !== token || ack.current || !wrapper.current) return;
    wrapper.current.dataset.renderedMaterializationLevel =
      materializationLevel(lod);
    ack.current = true;
  };
  return (
    <group name="city-materialization" dispose={null}>
      {resources.surfaces.map((s, i) => (
        <mesh
          key={s.siteId + ':' + i}
          name={'materialization-' + s.siteId}
          geometry={s.geometry}
          material={s.material}
          raycast={() => null}
          dispose={null}
          onAfterRender={drawn}
        />
      ))}
      {resources.kits.map((batch) => (
        <group key={batch.kit}>
          <SiteKitBatch batch={batch} part="body" onDraw={drawn} />
          <SiteKitBatch batch={batch} part="roof" onDraw={drawn} />
        </group>
      ))}
    </group>
  );
}
