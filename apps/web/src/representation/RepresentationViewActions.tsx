import type { ReactNode } from 'react';
import { useRepresentationMode } from './RepresentationModeContext.js';

export function RepresentationViewActions({
  children,
}: Readonly<{ children: ReactNode }>) {
  return useRepresentationMode() === 'normal' ? (
    <div className="representation-view-actions">{children}</div>
  ) : null;
}
