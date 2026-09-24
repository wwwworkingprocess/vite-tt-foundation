import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TransportRouteDock } from './TransportRouteDock.js';

const root = join(
  import.meta.dirname,
  '..',
  '..',
  'public',
  'scenarios',
  'torrevieja-v1',
  'torrevieja-legacy-abc-v1',
);
const json = (name: string) =>
  JSON.parse(readFileSync(join(root, name), 'utf8')) as unknown;
const scenario = parseScenarioPackage({
  manifest: json('scenario.json'),
  settlements: json('settlements.json'),
  stops: json('stops.json'),
  routes: json('routes.json'),
  presentation: json('presentation.json'),
  provenance: json('provenance.json'),
});
const routeB = scenario.routes.routes.find(
  (route) => route.routeId === 'legacy-B',
)!;
const styles = readFileSync(
  join(import.meta.dirname, '..', 'styles.css'),
  'utf8',
);

it('uses GameSelection for route choice and exposes Add bus only for that route', () => {
  const onSelectionChange = vi.fn();
  const onAddBus = vi.fn();
  const onFocusRoute = vi.fn();
  const onShowFullNetwork = vi.fn();
  const view = render(
    <TransportRouteDock
      scenario={scenario}
      selection={null}
      ready
      onSelectionChange={onSelectionChange}
      onAddBus={onAddBus}
      onFocusRoute={onFocusRoute}
      onShowFullNetwork={onShowFullNetwork}
    />,
  );
  expect(screen.queryByRole('button', { name: 'Add bus' })).toBeNull();
  const routeButton = document.querySelector<HTMLButtonElement>(
    '[data-route-id="legacy-B"]',
  )!;
  expect(routeButton).toHaveTextContent(/^B$/);
  expect(routeButton).toHaveAccessibleName(
    `Select route ${routeB.publicCode} — ${routeB.name}`,
  );
  fireEvent.click(routeButton);
  expect(onSelectionChange).toHaveBeenCalledWith({
    kind: 'route',
    routeId: 'legacy-B',
  });
  view.rerender(
    <TransportRouteDock
      scenario={scenario}
      selection={{ kind: 'route', routeId: routeB.routeId }}
      ready={false}
      onSelectionChange={onSelectionChange}
      onAddBus={onAddBus}
      onFocusRoute={onFocusRoute}
      onShowFullNetwork={onShowFullNetwork}
    />,
  );
  expect(routeButton).toHaveAttribute('aria-pressed', 'true');
  expect(
    screen.getByRole('group', {
      name: `Actions for route ${routeB.publicCode}`,
    }),
  ).toContainElement(screen.getByRole('button', { name: 'Add bus' }));
  expect(screen.getByRole('group', { name: 'Routes' })).toHaveClass(
    'transport-route-selector',
  );
  expect(styles).toMatch(
    /\.transport-route-selector\s*\{[^}]*overflow-y:\s*auto;/s,
  );
  expect(styles).toMatch(
    /\.representation-sidecar\s*\{[^}]*overflow:\s*hidden;/s,
  );
  expect(styles).toMatch(
    /\.transport-route-dock\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*max-height:\s*100%;/s,
  );
  expect(styles).toMatch(
    /\.transport-route-selector\s*\{[^}]*flex:\s*0 1 auto;/s,
  );
  expect(styles).toMatch(
    /\.selected-route-actions\s*\{[^}]*flex:\s*0 0 auto;/s,
  );
  expect(screen.getByRole('button', { name: 'Add bus' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Focus route' }));
  expect(onFocusRoute).toHaveBeenCalledWith(routeB.routeId);
  view.rerender(
    <TransportRouteDock
      scenario={scenario}
      selection={{ kind: 'route', routeId: routeB.routeId }}
      ready
      onSelectionChange={onSelectionChange}
      onAddBus={onAddBus}
      focusedRouteId={routeB.routeId}
      onFocusRoute={onFocusRoute}
      onShowFullNetwork={onShowFullNetwork}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Add bus' }));
  expect(onAddBus).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: 'Focus route' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show full network' }));
  expect(onShowFullNetwork).toHaveBeenCalledOnce();
});
