import { StrictMode, useEffect } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  CityPreparationProvider,
  useCityPreparation,
  usePreparationAttempt,
} from './CityPreparationProvider.js';
import { usePreparedValue } from './use-prepared-value.js';
import { runPreparation } from './browser-preparation.js';
vi.mock('./browser-preparation.js', () => ({
  runPreparation: vi.fn(),
  preparationExecution: () => 'visual-worker',
}));
afterEach(cleanup);
it('keeps the real workspace mounted, requires actual draw and replaces the generation on retry', () => {
  let owner: ReturnType<typeof useCityPreparation>;
  function Harness() {
    owner = useCityPreparation();
    return <div data-testid="real-workspace" />;
  }
  const view = render(
    <CityPreparationProvider identity="A#hash" cityName="Torrevieja">
      <Harness />
    </CityPreparationProvider>,
  );
  const workspace = screen.getByTestId('real-workspace');
  const first = owner!;
  act(() => first.coordinator.prepared(first.generation, ['city']));
  expect(screen.getByRole('status')).toHaveTextContent(
    'Presenting the first frame',
  );
  act(() => first.coordinator.fail(first.generation, 'ZIP CRC mismatch'));
  expect(screen.getByRole('status')).toHaveTextContent('ZIP CRC mismatch');
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry city preparation' }),
  );
  expect(owner!.coordinator).not.toBe(first.coordinator);
  expect(screen.getByTestId('real-workspace')).toBe(workspace);
  act(() => first.coordinator.draw(first.generation, 'city'));
  expect(screen.getByRole('status')).toBeInTheDocument();
  act(() => {
    owner!.coordinator.prepared(owner!.generation, ['city']);
    owner!.coordinator.draw(owner!.generation, 'city');
  });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByTestId('city-preparation')).toHaveAttribute(
    'data-first-useful-frame',
    'presented',
  );
  view.unmount();
});
it('does not leave an overlay when D3D is deliberately removed and starts fresh when reinstalled', () => {
  let owner: ReturnType<typeof useCityPreparation>;
  function Harness() {
    owner = useCityPreparation();
    return null;
  }
  render(
    <CityPreparationProvider identity="B" cityName="Alicante">
      <Harness />
    </CityPreparationProvider>,
  );
  act(() => owner!.setD3dActive(false));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByTestId('city-preparation')).toHaveAttribute(
    'data-city-preparation-status',
    'cancelled',
  );
  act(() => owner!.setD3dActive(true));
  expect(screen.getByRole('status')).toBeInTheDocument();
});
it('rejects stale city/LOD/unmount results and retries after a decoding failure', async () => {
  const pending: {
    resolve: (v: unknown) => void;
    reject: (e: unknown) => void;
  }[] = [];
  vi.mocked(runPreparation).mockImplementation(
    () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
  );
  const decoder = (value: unknown) => {
    if (typeof value !== 'number') throw Error('bad DTO');
    return value;
  };
  const a = { kind: 'asset' as const, url: '/a' },
    b = { kind: 'asset' as const, url: '/b' };
  const h = renderHook(({ job }) => usePreparedValue(job.url, job, decoder), {
    initialProps: { job: a },
  });
  h.rerender({ job: b });
  await act(async () => pending[0]!.resolve(1));
  expect(h.result.current?.status).toBe('loading');
  await act(async () => pending[1]!.resolve('bad'));
  expect(h.result.current).toMatchObject({
    status: 'error',
    message: 'Error: bad DTO',
  });
  h.rerender({ job: a });
  await act(async () => pending[2]!.reject(new Error('archive')));
  expect(h.result.current).toMatchObject({
    status: 'error',
    message: 'Error: archive',
  });
  h.rerender({ job: b });
  await act(async () => pending[3]!.resolve(2));
  await waitFor(() =>
    expect(h.result.current).toMatchObject({ status: 'ready', value: 2 }),
  );
  h.rerender({ job: a });
  h.unmount();
  await act(async () => pending[4]!.resolve(3));
});
it('changes preparation generation without remounting the real workspace on scenario/timeline replacement', () => {
  const v = render(
    <CityPreparationProvider identity="A#hash:timeline-1" cityName="A">
      <div data-testid="mounted-workspace" />
    </CityPreparationProvider>,
  );
  const node = screen.getByTestId('mounted-workspace');
  const token = screen
    .getByTestId('city-preparation')
    .getAttribute('data-city-preparation-generation');
  v.rerender(
    <CityPreparationProvider identity="A#hash:timeline-2" cityName="A">
      <div data-testid="mounted-workspace" />
    </CityPreparationProvider>,
  );
  expect(screen.getByTestId('mounted-workspace')).toBe(node);
  expect(
    screen
      .getByTestId('city-preparation')
      .getAttribute('data-city-preparation-generation'),
  ).not.toBe(token);
});

it('exposes the actual provider attempt to loader effects and ignores rejection after unmount', async () => {
  const h = renderHook(() => usePreparationAttempt(), {
    wrapper: ({ children }) => (
      <CityPreparationProvider identity="attempt-source" cityName="A">
        {children}
      </CityPreparationProvider>
    ),
  });
  expect(h.result.current).toContain('attempt-source');
  h.unmount();
  let reject!: (e: unknown) => void;
  vi.mocked(runPreparation).mockImplementationOnce(
    () =>
      new Promise((_, r) => {
        reject = r;
      }),
  );
  const value = renderHook(() =>
    usePreparedValue('stale', { kind: 'asset', url: '/x' }, String),
  );
  value.unmount();
  await act(async () => reject(Error('late failure')));
});

it.each([false, true])(
  'preserves the mounted preparation scope across Strict Mode replay (error=%s)',
  (error) => {
    let owner: ReturnType<typeof useCityPreparation>;
    function Harness() {
      owner = useCityPreparation();
      useEffect(() => {
        if (error)
          owner!.coordinator.fail(owner!.generation, 'required source failure');
      }, []);
      return <div data-testid="strict-workspace" />;
    }
    const v = render(
      <StrictMode>
        <CityPreparationProvider identity="strict" cityName="A">
          <Harness />
        </CityPreparationProvider>
      </StrictMode>,
    );
    expect(
      screen.getByTestId('city-preparation').dataset.cityPreparationStatus,
    ).toBe(error ? 'error' : 'loading');
    if (!error) {
      act(() => {
        owner!.coordinator.prepared(owner!.generation, ['city']);
        owner!.coordinator.draw(owner!.generation, 'city');
      });
      expect(
        screen.getByTestId('city-preparation').dataset.firstUsefulFrame,
      ).toBe('presented');
    }
    v.unmount();
    expect(owner!.coordinator.snapshot().status).toBe('cancelled');
  },
);
