import '@testing-library/jest-dom/vitest';
import { Children, isValidElement, type ReactNode } from 'react';
import { vi } from 'vitest';

vi.mock('@react-three/fiber', () => ({
  Canvas: ({
    frameloop,
    children,
  }: Readonly<{ frameloop?: string; children?: ReactNode }>) => (
    <div data-testid="r3f-canvas" data-frameloop={frameloop}>
      {Children.toArray(children).filter(
        (child) => isValidElement(child) && typeof child.type === 'function',
      )}
    </div>
  ),
  useThree: (
    selector: (state: Readonly<{ advance: (time: number) => void }>) => unknown,
  ) => selector({ advance: () => undefined }),
}));
