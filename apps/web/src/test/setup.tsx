import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { vi } from 'vitest';

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: ReactNode }) => (
    <div data-testid="r3f-canvas">{children}</div>
  ),
}));
