import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import FoundationScene from './foundation-scene.js';

const r3fDomDiagnostic =
  /(?:ambientLight|boxGeometry|meshStandardMaterial).*(?:incorrect casing|unrecognized in this browser)|(?:incorrect casing|unrecognized in this browser).*(?:ambientLight|boxGeometry|meshStandardMaterial)/i;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('keeps R3F intrinsic scene elements out of the React DOM test boundary', () => {
  const consoleError = vi.spyOn(console, 'error');

  render(<FoundationScene />);

  expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
  const diagnostics = consoleError.mock.calls.filter((arguments_) =>
    r3fDomDiagnostic.test(arguments_.map(String).join(' ')),
  );
  expect(diagnostics).toEqual([]);
});
