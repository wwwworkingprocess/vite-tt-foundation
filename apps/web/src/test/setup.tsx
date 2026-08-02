import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

vi.mock('@react-three/fiber', () => ({
  Canvas: () => <div data-testid="r3f-canvas" />,
}));
