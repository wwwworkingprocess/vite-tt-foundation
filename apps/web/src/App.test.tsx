import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./simulation-worker/browser-worker.js', async () => {
  const { createStructuredCloneLoopbackWorker } =
    await import('./simulation-worker/worker-test-double.js');
  return { createBrowserFoundationWorker: createStructuredCloneLoopbackWorker };
});

import { App } from './App.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('foundation screen', () => {
  it('identifies the app and starts the renderer boundary', async () => {
    render(<App />);
    expect(
      screen.getByRole('heading', { name: 'Torrevieja Tycoon' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('standalone simulation package'),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('r3f-canvas')).toBeInTheDocument();
  });

  it('reports Worker readiness, advancement, and cleanup', async () => {
    vi.stubGlobal('Worker', class FoundationWorker {});
    render(<App />);

    await waitFor(() =>
      expect(screen.getByTestId('worker-status')).toHaveTextContent('ready'),
    );
    await waitFor(() =>
      expect(screen.getByTestId('worker-tick')).toHaveTextContent('0'),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Close foundation Worker' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('worker-status')).toHaveTextContent('closed'),
    );
  });
});
