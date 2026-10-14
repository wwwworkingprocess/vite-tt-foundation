import { expect, it } from 'vitest';
import { facadeParameters, patchCityFacadeShader } from './d3d-city-facade.js';
it('uses one compact instanced parameter per building and local positions without requiring UVs', () => {
  const values = facadeParameters(
    [{ storeys: 5, width: 12, depth: 18, density: 0.8 }],
    1,
  );
  expect([...values.array]).toEqual([5, 12, 18, 1]);
  expect(values.itemSize).toBe(4);
  const shader = {
    vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <color_fragment>',
  };
  patchCityFacadeShader(shader);
  expect(shader.vertexShader).toContain('attribute vec4 cityFacade');
  expect(shader.vertexShader).toContain('cityWallNormal = normal');
  expect(shader.fragmentShader).toContain('abs(cityWallNormal.y) < 0.2');
  expect(shader.fragmentShader).toContain('fwidth');
  expect(shader.fragmentShader).not.toContain('texture2D');
  expect([
    ...facadeParameters(
      [{ storeys: 2, width: 8, depth: 12, density: 0.2 }],
      0.5,
    ).array,
  ]).toEqual([2, 16, 24, 0]);
});
