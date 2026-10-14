import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { BufferGeometry, FrontSide, MeshLambertMaterial } from 'three';
import {
  D3dMaterialization,
  createMaterializationResources,
} from './D3dMaterialization.js';
import { materializationRenderKeys } from './city-materialization.js';
import { d3dMaterialPresets } from './d3d-material-presets.js';
import type { MaterializationPlan } from './d3d-materialization.js';
const plan: MaterializationPlan = {
  settlementId: 'es-torrevieja',
  surfaces: [
    {
      siteId: 'ua-site-es-torrevieja-playa-cura',
      materialPreset: 'beach-sand-v0',
      positions: new Float32Array([0, 0, 0, 0, 0, 1, 1, 0, 0]),
    },
  ],
  instances: materializationRenderKeys.map((kit, index) => ({
    id: 'instance-' + index,
    siteId: 'site',
    kit,
    x: index,
    y: 1,
    z: 3,
    width: 2,
    depth: 4,
    height: 6,
    rotation: 0.3,
  })),
  diagnostics: [],
  triangles: 1,
  bytes: 36,
};
afterEach(() => {
  cleanup();
  for (const key of [
    'setMatrixAt',
    'instanceMatrix',
    'computeBoundingSphere',
    'dispose',
  ])
    Reflect.deleteProperty(HTMLElement.prototype, key);
  vi.restoreAllMocks();
});
it('creates all seven bounded reusable proxies and configurable one-sided surface materials, then disposes scene GPU ownership only', () => {
  const before = Array.from(plan.surfaces[0]!.positions),
    resources = createMaterializationResources(plan);
  expect(resources.kits).toHaveLength(7);
  expect(resources.surfaces[0]!.material.color.getHexString()).toBe(
    d3dMaterialPresets.torrevieja.sandAndMineral.slice(1).toLowerCase(),
  );
  for (const s of resources.surfaces) {
    expect(s.material.side).toBe(FrontSide);
    expect(s.material.depthTest).toBe(true);
    expect(s.material.polygonOffset).toBe(true);
  }
  for (const kit of resources.kits)
    for (const geometry of [kit.body, kit.roof]) {
      geometry.computeBoundingBox();
      expect(geometry.boundingBox!.max.y).toBeLessThan(1.2);
      expect(geometry.getAttribute('position').count).toBeLessThan(200);
      expect(
        Array.from(geometry.getAttribute('normal').array).every(
          Number.isFinite,
        ),
      ).toBe(true);
    }
  const disposed = vi.spyOn(BufferGeometry.prototype, 'dispose'),
    materials = vi.spyOn(MeshLambertMaterial.prototype, 'dispose');
  resources.dispose();
  expect(disposed).toHaveBeenCalledTimes(15);
  expect(materials).toHaveBeenCalledTimes(15);
  expect(Array.from(plan.surfaces[0]!.positions)).toEqual(before);
});
function enableMeshes() {
  const dispose = vi.fn();
  Object.assign(HTMLElement.prototype, {
    setMatrixAt: vi.fn(),
    instanceMatrix: { needsUpdate: false },
    computeBoundingSphere: vi.fn(),
    dispose,
  });
  const error = console.error;
  vi.spyOn(console, 'error').mockImplementation(
    (message: unknown, ...args: unknown[]) => {
      if (
        typeof message === 'string' &&
        (message.includes('is using incorrect casing.') ||
          message.includes('unrecognized in this browser') ||
          message.includes('Unknown event handler property'))
      )
        return;
      error(message, ...args);
    },
  );
  return dispose;
}
function props(element: Element) {
  const key = Object.keys(element).find((k) => k.startsWith('__reactProps$'))!;
  return (
    element as unknown as Record<
      string,
      Readonly<{ onAfterRender: () => void; raycast: () => null }>
    >
  )[key]!;
}
it('acknowledges only active real draw callbacks once, clears on LOD/geometry transition and unmount, and rejects obsolete batches', () => {
  enableMeshes();
  const host = document.createElement('section'),
    wrapper = { current: host },
    observer = new MutationObserver(() => {});
  observer.observe(host, {
    attributes: true,
    attributeFilter: ['data-rendered-materialization-level'],
  });
  const view = render(
    <D3dMaterialization plan={plan} lod="far" wrapper={wrapper} />,
  );
  expect(host.dataset.renderedMaterializationLevel).toBe('');
  observer.takeRecords();
  const batches = [...view.container.querySelectorAll('mesh,instancedmesh')];
  expect(batches).toHaveLength(15);
  expect(batches.every((b) => props(b).raycast() === null)).toBe(true);
  const old = props(batches[0]!).onAfterRender;
  old();
  expect(host.dataset.renderedMaterializationLevel).toBe('A');
  for (const batch of batches) props(batch).onAfterRender();
  expect(observer.takeRecords()).toHaveLength(1);
  view.rerender(
    <D3dMaterialization plan={{ ...plan }} lod="near" wrapper={wrapper} />,
  );
  expect(host.dataset.renderedMaterializationLevel).toBe('');
  old();
  expect(host.dataset.renderedMaterializationLevel).toBe('');
  props(view.container.querySelector('mesh')!).onAfterRender();
  expect(host.dataset.renderedMaterializationLevel).toBe('C');
  view.unmount();
  expect(host.dataset.renderedMaterializationLevel).toBe('');
  old();
  expect(host.dataset.renderedMaterializationLevel).toBe('');
  observer.disconnect();
});
it('does not publish into a detached host even if a delayed draw occurs', () => {
  enableMeshes();
  const view = render(
    <D3dMaterialization plan={plan} lod="medium" wrapper={{ current: null }} />,
  );
  const draw = props(view.container.querySelector('mesh')!).onAfterRender;
  expect(() => draw()).not.toThrow();
  view.unmount();
  expect(() => draw()).not.toThrow();
});

it('allocates no surface/kit GPU resources and never acknowledges an empty presented plan', () => {
  const host = document.createElement('div');
  const empty = {
    ...plan,
    surfaces: [],
    instances: [],
    triangles: 0,
    bytes: 0,
  };
  const resources = createMaterializationResources(empty);
  expect(resources.surfaces).toHaveLength(0);
  expect(resources.kits).toHaveLength(0);
  const view = render(
    <D3dMaterialization plan={empty} lod="far" wrapper={{ current: host }} />,
  );
  expect(view.container.querySelector('mesh, instancedmesh')).toBeNull();
  expect(host.dataset.renderedMaterializationLevel).toBe('');
  view.unmount();
  resources.dispose();
  expect(host.dataset.renderedMaterializationLevel).toBe('');
});

it('uses opaque one-sided vertex modulation for landscape harmony without baking palette colors into source positions or adding batches', () => {
  const surface = {
    ...plan.surfaces[0]!,
    siteId: 'ua-site-es-torrevieja-laguna-rosa',
    materialPreset: 'salt-lagoon-pink-v0' as const,
    toneWeights: new Float32Array([0.96, 1, 1.04]),
  };
  const input = { ...plan, surfaces: [surface], instances: [] };
  const resources = createMaterializationResources(input);
  const rendered = resources.surfaces[0]!;
  expect(rendered.material.vertexColors).toBe(true);
  expect(rendered.material.transparent).toBe(false);
  expect(rendered.material.depthWrite).toBe(true);
  expect(rendered.geometry.getAttribute('color').count).toBe(3);
  expect(Array.from(rendered.geometry.getAttribute('color').array)).toEqual([
    surface.toneWeights[0],
    surface.toneWeights[0],
    surface.toneWeights[0],
    1,
    1,
    1,
    surface.toneWeights[2],
    surface.toneWeights[2],
    surface.toneWeights[2],
  ]);
  expect(surface.positions).toBe(plan.surfaces[0]!.positions);
  expect(resources.surfaces).toHaveLength(1);
  resources.dispose();
});

it('releases owned kit instance buffers on replacement and unmount, while unchanged plans reuse them', () => {
  const dispose = enableMeshes();
  const wrapper = { current: document.createElement('section') };
  const view = render(
    <D3dMaterialization plan={plan} lod="far" wrapper={wrapper} />,
  );
  view.rerender(
    <D3dMaterialization plan={plan} lod="medium" wrapper={wrapper} />,
  );
  expect(dispose).not.toHaveBeenCalled();
  view.rerender(
    <D3dMaterialization plan={{ ...plan }} lod="near" wrapper={wrapper} />,
  );
  expect(dispose).toHaveBeenCalledTimes(14);
  view.unmount();
  expect(dispose).toHaveBeenCalledTimes(28);
});
