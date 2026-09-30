import '@testing-library/jest-dom/vitest';
import { Children, isValidElement, type ReactNode } from 'react';
import { vi } from 'vitest';
const r3fTestControls = vi.hoisted(() => {
  const position = {
    x: 0,
    y: 0,
    z: 0,
    set(x: number, y: number, z: number) {
      this.x = x;
      this.y = y;
      this.z = z;
    },
  };
  return {
    camera: {
      position,
      zoom: 1,
      updateProjectionMatrix: vi.fn(),
      lookAt: vi.fn(),
    },
    canvas: document.createElement('canvas'),
    renderWorld: false,
    eventConnect: vi.fn(),
    eventManager: undefined as
      { connect: (element: HTMLElement) => void } | undefined,
  };
});
const r3fState = {
  advance: () => undefined,
  camera: r3fTestControls.camera,
  size: { width: 1000, height: 660 },
  gl: { domElement: r3fTestControls.canvas },
};

vi.mock('@react-three/fiber', () => ({
  __testControls: r3fTestControls,
  Canvas: ({
    frameloop,
    children,
    events,
  }: Readonly<{
    frameloop?: string;
    children?: ReactNode;
    events?: (state: typeof r3fState) => {
      connect: (element: HTMLElement) => void;
    };
  }>) => {
    if (events) r3fTestControls.eventManager = events(r3fState);
    return (
      <div data-testid="r3f-canvas" data-frameloop={frameloop}>
        {Children.toArray(children).filter(
          (child) =>
            isValidElement(child) &&
            typeof child.type === 'function' &&
            (child.type.name === 'RepresentationFrameDriver' ||
              child.type.name === 'CameraController' ||
              (r3fTestControls.renderWorld && child.type.name === 'D3dWorld')),
        )}
      </div>
    );
  },
  events: () => ({ connect: r3fTestControls.eventConnect }),
  useThree: (selector?: (state: typeof r3fState) => unknown) =>
    selector ? selector(r3fState) : r3fState,
}));
