import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import PopulationGridOverlay from './PopulationGridOverlay.js';
import {
  clearRepresentationProfiles,
  configureRepresentationProfiling,
  representationProfilePrefix,
} from '../performance/representation-profiler.js';

const fixture = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'transport-domain',
  'fixtures',
  'torrevieja-mini-v1',
);
const asset = (name: string) =>
  JSON.parse(readFileSync(join(fixture, name), 'utf8')) as unknown;
const scenario = parseScenarioPackage({
  manifest: asset('scenario.json'),
  settlements: asset('settlements.json'),
  stops: asset('stops.json'),
  routes: asset('routes.json'),
  presentation: asset('presentation.json'),
  provenance: asset('provenance.json'),
});

afterEach(() => {
  cleanup();
  configureRepresentationProfiling(false);
  clearRepresentationProfiles();
});

it('distinguishes profiled renders, geometry rebuilds, and commits', () => {
  configureRepresentationProfiling(true);
  const cells = [
    {
      cellId: 'r0c0',
      center: { latitude: 1, longitude: 1 },
      populationWeight: 2,
    },
  ] as const;
  const project = ({
    latitude,
    longitude,
  }: Readonly<{ latitude: number; longitude: number }>) => ({
    cx: longitude,
    cy: latitude,
  });
  const rendered = render(
    <PopulationGridOverlay
      cells={cells}
      resolutionDegrees={0.001}
      project={project}
    />,
  );
  rendered.rerender(
    <PopulationGridOverlay
      cells={cells}
      resolutionDegrees={0.001}
      project={project}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Hide population' }));
  const names = [
    ...performance.getEntriesByType('mark'),
    ...performance.getEntriesByType('measure'),
  ].map(({ name }) => name);
  expect(
    names.filter(
      (name) => name === `${representationProfilePrefix}population.geometry`,
    ),
  ).toHaveLength(2);
  expect(names).toContain(`${representationProfilePrefix}population.render`);
  expect(names).toContain(`${representationProfilePrefix}population.commit`);
  expect(names).toContain(
    `${representationProfilePrefix}population.render-to-commit`,
  );
});

it('renders and toggles deterministic nonzero population cells', () => {
  render(
    <PopulationGridOverlay
      cells={[
        {
          cellId: 'r0c0',
          center: { latitude: 1, longitude: 1 },
          populationWeight: 2,
        },
        {
          cellId: 'r0c1',
          center: { latitude: 1, longitude: 2 },
          populationWeight: 4,
        },
      ]}
      resolutionDegrees={0.001}
      project={({ latitude, longitude }) => ({
        cx: longitude,
        cy: latitude,
      })}
    />,
  );
  expect(screen.getAllByTestId('population-band')).toHaveLength(2);
  expect(screen.getAllByTestId('population-band')[0]).toHaveAttribute(
    'data-population-band-cell-count',
    '1',
  );
  expect(screen.getAllByTestId('population-band')[0]).not.toHaveAttribute(
    'data-population-cell-ids',
  );
  expect(
    screen.getByRole('img', { name: 'Operational population grid' }),
  ).toHaveAttribute('data-population-cell-count', '2');
  fireEvent.click(screen.getByRole('button', { name: 'Hide population' }));
  expect(screen.queryByTestId('population-band')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show population' }));
  expect(screen.getAllByTestId('population-band')).toHaveLength(2);
});

it('does not rerender for unrelated parent authority updates', () => {
  let cellMapReads = 0;
  const sourceCells = [
    {
      cellId: 'r0c0',
      center: { latitude: 1, longitude: 1 },
      populationWeight: 2,
    },
  ] as const;
  const cells = new Proxy(sourceCells, {
    get(target, property, receiver) {
      if (property === 'map') cellMapReads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  const project = ({
    latitude,
    longitude,
  }: Readonly<{ latitude: number; longitude: number }>) => ({
    cx: longitude,
    cy: latitude,
  });
  const view = (tick: number) => (
    <div data-tick={tick}>
      <PopulationGridOverlay
        cells={cells}
        resolutionDegrees={0.001}
        project={project}
        demandModelContentHash={'a'.repeat(64)}
      />
    </div>
  );
  const rendered = render(view(0));
  expect(cellMapReads).toBeGreaterThan(0);
  const readsAfterGeometry = cellMapReads;
  rendered.rerender(view(1));
  expect(cellMapReads).toBe(readsAfterGeometry);
});

it('projects canonical population positions from the active scenario', () => {
  const { container } = render(
    <PopulationGridOverlay
      scenario={scenario}
      resolutionDegrees={0.001}
      cells={[
        {
          cellId: 'r0c0',
          center: scenario.stops.stopNodes[0]!.position,
          populationWeight: 1,
        },
      ]}
    />,
  );
  expect(
    container.querySelector('[data-testid="population-band"]'),
  ).toHaveAttribute('d');
});

it('projects canonical cell boundaries through the shared geographic projector', () => {
  const { container } = render(
    <PopulationGridOverlay
      cells={[
        {
          cellId: 'r0c0',
          center: { latitude: 1, longitude: 2 },
          populationWeight: 1,
        },
      ]}
      resolutionDegrees={0.001}
      project={({ latitude, longitude }) => ({
        cx: longitude * 100,
        cy: latitude * -200,
      })}
    />,
  );
  const values = container
    .querySelector('[data-testid="population-band"]')!
    .getAttribute('d')!
    .match(/-?\d+(?:\.\d+)?/g)!
    .map(Number);
  expect(values[0]).toBeCloseTo(199.95);
  expect(values[1]).toBeCloseTo(-200.1);
  expect(values[2]).toBeCloseTo(0.1);
  expect(values[3]).toBeCloseTo(0.2);
});

it('renders an empty field and rejects a missing geographic projection', () => {
  const { container, unmount } = render(
    <PopulationGridOverlay
      cells={[]}
      resolutionDegrees={0.001}
      project={() => ({ cx: 0, cy: 0 })}
    />,
  );
  expect(container.querySelector('[data-testid="population-band"]')).toBeNull();
  unmount();
  expect(() =>
    render(
      <PopulationGridOverlay
        cells={[
          {
            cellId: 'r0c0',
            center: { latitude: 0, longitude: 0 },
            populationWeight: 1,
          },
        ]}
        resolutionDegrees={0.001}
      />,
    ),
  ).toThrow(/geographic projection/i);
});
