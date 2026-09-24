import { describe, expect, it } from 'vitest';
import {
  materializeSvgTransportMapEntityScale,
  transportMapEntityVisualMetrics,
} from './transport-map-visual-metrics.js';
import { fullTransportMapViewport } from './transport-map-projection.js';

describe('transport Map entity visual metrics', () => {
  it.each(['normal', 'mini'] as const)(
    'keeps %s SVG entity presentation stable across full and focused viewports',
    (mode) => {
      const metrics = transportMapEntityVisualMetrics(mode);
      const focused = { minX: 0.2, minY: 0.3, maxX: 0.6, maxY: 0.7 };
      for (const size of [
        { width: 400, height: 300 },
        { width: 900, height: 500 },
      ]) {
        const full = materializeSvgTransportMapEntityScale(
          mode,
          fullTransportMapViewport,
          size.width,
          size.height,
        );
        const route = materializeSvgTransportMapEntityScale(
          mode,
          focused,
          size.width,
          size.height,
        );

        const fullUserUnit = Math.max(100 / size.width, 100 / size.height);
        const routeUserUnit = Math.max(
          ((focused.maxX - focused.minX) * 90) / size.width,
          ((focused.maxY - focused.minY) * 90) / size.height,
        );
        expect((3 * full) / fullUserUnit).toBeCloseTo(metrics.stopRadius);
        expect((3 * route) / routeUserUnit).toBeCloseTo(metrics.stopRadius);
        expect((5 * full) / fullUserUnit).toBeCloseTo(metrics.vehicleRadius);
        expect((6 * route) / routeUserUnit).toBeCloseTo(metrics.vehicleRadius);
        expect((11 * route) / routeUserUnit).toBeCloseTo(
          metrics.passengerLabelFontSize,
        );
        expect((7 * route) / routeUserUnit).toBeCloseTo(
          metrics.selectionRadius,
        );
      }
    },
  );

  it('shares deliberate normal and mini semantic scales without coupling hit areas', () => {
    const normal = transportMapEntityVisualMetrics('normal');
    const mini = transportMapEntityVisualMetrics('mini');

    expect(normal.vehicleRadius).toBe(6);
    expect(mini.vehicleRadius).toBeCloseTo(4.8);
    expect(normal.vehicleRadius).toBeGreaterThan(normal.stopRadius);
    expect(normal.vehicleRadius).toBeGreaterThanOrEqual(normal.stopRadius * 2);
    expect(mini.stopRadius).toBeLessThanOrEqual(normal.stopRadius);
    expect(mini.vehicleRadius).toBeLessThanOrEqual(normal.vehicleRadius);
    expect(normal.stopHitRadius).toBeGreaterThan(normal.stopRadius);
    expect(normal.vehicleHitRadius).toBeGreaterThan(normal.vehicleRadius);
  });
});
