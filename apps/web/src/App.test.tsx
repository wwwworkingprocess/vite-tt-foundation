import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App.js';

describe('foundation screen', () => {
  it('identifies the app and starts the renderer boundary', () => {
    render(<App />);
    expect(
      screen.getByRole('heading', { name: 'Torrevieja Tycoon' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('standalone simulation package'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
  });
});
