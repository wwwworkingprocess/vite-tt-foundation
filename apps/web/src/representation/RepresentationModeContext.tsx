import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  createLatestRepresentationThrottle,
  type LatestRepresentationThrottle,
  type RepresentationMode,
} from './representation-cadence.js';

const RepresentationModeContext = createContext<RepresentationMode>('normal');

export function RepresentationModeProvider({
  mode,
  children,
}: Readonly<{ mode: RepresentationMode; children: ReactNode }>) {
  return (
    <RepresentationModeContext.Provider value={mode}>
      {children}
    </RepresentationModeContext.Provider>
  );
}

export const useRepresentationMode = () =>
  useContext(RepresentationModeContext);

export function useLatestRepresentationValue<T>(value: T): T {
  const mode = useRepresentationMode();
  const [committed, setCommitted] = useState(value);
  const throttle = useRef<LatestRepresentationThrottle<T> | undefined>(
    undefined,
  );
  const initialMode = useRef(mode);
  useEffect(() => {
    const owned = createLatestRepresentationThrottle<T>({
      mode: initialMode.current,
      now: () => performance.now(),
      setTimer: (callback, delay) => window.setTimeout(callback, delay),
      cancel: (handle) => window.clearTimeout(handle as number),
      commit: setCommitted,
    });
    throttle.current = owned;
    return () => {
      owned.close();
      throttle.current = undefined;
    };
  }, []);
  useEffect(() => {
    const current = throttle.current!;
    current.setMode(mode);
    current.publish(value);
  }, [mode, value]);
  return committed;
}
