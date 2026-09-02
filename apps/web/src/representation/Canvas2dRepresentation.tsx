import { useEffect, useRef } from 'react';
import {
  beginRepresentationProfile,
  finishRepresentationProfile,
  recordRepresentationProfile,
} from '../performance/representation-profiler.js';
import { useRepresentationMode } from './RepresentationModeContext.js';
import {
  createRepresentationFrameDriver,
  representationCadence,
} from './representation-cadence.js';

const validDpr = () =>
  Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
    ? window.devicePixelRatio
    : 1;

export function Canvas2dRepresentation() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useRef({ width: 0, height: 0 });
  const mode = useRepresentationMode();
  const modeRef = useRef(mode);
  const driverRef = useRef<
    ReturnType<typeof createRepresentationFrameDriver> | undefined
  >(undefined);
  modeRef.current = mode;
  useEffect(() => driverRef.current?.setMode(mode), [mode]);

  useEffect(() => {
    const element = canvas.current!;
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        size.current = {
          width: Math.max(0, entry.contentRect.width),
          height: Math.max(0, entry.contentRect.height),
        };
    });
    observer.observe(element);
    const driver = createRepresentationFrameDriver({
      mode: modeRef.current,
      now: () => performance.now(),
      setTimer: (callback, delay) => window.setTimeout(callback, delay),
      cancel: (handle) => window.clearTimeout(handle as number),
      frame: () => {
        const context = element.getContext('2d');
        const { width, height } = size.current;
        if (!context || width <= 0 || height <= 0) return;
        const dpr = validDpr();
        const backingWidth = Math.round(width * dpr);
        const backingHeight = Math.round(height * dpr);
        if (element.width !== backingWidth) element.width = backingWidth;
        if (element.height !== backingHeight) element.height = backingHeight;
        const detail = {
          mode: modeRef.current,
          targetFramesPerSecond: representationCadence(modeRef.current)
            .targetFramesPerSecond,
          cssWidth: width,
          cssHeight: height,
          backingWidth,
          backingHeight,
          devicePixelRatio: dpr,
        } as const;
        const token = beginRepresentationProfile('canvas2d.draw');
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, width, height);
        context.fillStyle = '#0b2533';
        context.fillRect(0, 0, width, height);
        context.strokeStyle = '#67bed6';
        context.lineWidth = 2;
        context.strokeRect(
          width * 0.2,
          height * 0.2,
          width * 0.6,
          height * 0.6,
        );
        context.fillStyle = '#f3eee4';
        context.beginPath();
        context.arc(
          width / 2,
          height / 2,
          Math.max(3, Math.min(width, height) * 0.06),
          0,
          Math.PI * 2,
        );
        context.fill();
        finishRepresentationProfile(token, detail);
        recordRepresentationProfile('canvas2d.frame', detail);
      },
    });
    driverRef.current = driver;
    return () => {
      driver.close();
      observer.disconnect();
      driverRef.current = undefined;
    };
  }, []);

  return (
    <canvas
      ref={canvas}
      className="canvas2d-representation"
      data-testid="canvas2d-representation"
      role="img"
      aria-label="Canvas 2D foundation representation"
    >
      Canvas 2D representation is unavailable.
    </canvas>
  );
}
