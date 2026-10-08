import { expect, it } from 'vitest';
import { d3dDrapePolicy } from './d3d-presentation-policy.js';
it('selects monotonic metre-based support and omits hidden broad layers', () => {
  const far = d3dDrapePolicy('normal', 'far');
  const medium = d3dDrapePolicy('normal', 'medium');
  const near = d3dDrapePolicy('normal', 'near');
  expect([far.surfaceMetres, medium.surfaceMetres, near.surfaceMetres]).toEqual(
    [200, 100, 50],
  );
  expect([far.routeMetres, medium.routeMetres, near.routeMetres]).toEqual([
    150, 75, 25,
  ]);
  expect([
    far.landscapeMetres,
    medium.landscapeMetres,
    near.landscapeMetres,
  ]).toEqual([200, 125, 100]);
  expect(far.landscape).toBe(false);
  expect(far.streets).toBe(false);
  expect(medium.landscape).toBe(true);
  expect(near.streets).toBe(true);
  expect(d3dDrapePolicy('mini', 'near')).toBe(far);
});
