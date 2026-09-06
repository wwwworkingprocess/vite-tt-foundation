import {
  type FocusEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { RepresentationModeProvider } from './RepresentationModeContext.js';
import {
  defaultRepresentationViewForFamily,
  representationFamilies,
  type RepresentationFamily,
  type RepresentationView,
} from './representation-view-capabilities.js';

export type {
  RepresentationFamily,
  RepresentationView,
} from './representation-view-capabilities.js';

export interface RepresentationModal {
  readonly title: string;
  readonly content: ReactNode;
  readonly onClose: () => void;
}

interface RepresentationWorkspaceProps {
  readonly domTwoDimensional: ReactNode;
  readonly canvasTwoDimensional: ReactNode;
  readonly threeDimensional: ReactNode;
  readonly modal?: RepresentationModal | undefined;
}

const labelForFamily = (family: RepresentationFamily) =>
  family === 'dom2d' ? 'DOM 2D' : family === 'canvas2d' ? 'Canvas 2D' : '3D';
const labelForView = (view: RepresentationView) =>
  view === 'map' ? 'Map' : 'Main';

export function RepresentationWorkspace({
  domTwoDimensional,
  canvasTwoDimensional,
  threeDimensional,
  modal,
}: RepresentationWorkspaceProps) {
  const [visibleFamilies, setVisibleFamilies] = useState<
    readonly [RepresentationFamily, RepresentationFamily]
  >(['dom2d', 'd3d']);
  const [swapArmed, setSwapArmed] = useState(false);
  const miniBoundary = useRef<HTMLDivElement>(null);
  const restoreModalFocus = useRef(true);
  const [primaryFamily, secondaryFamily] = visibleFamilies;
  const inactiveFamily = representationFamilies.find(
    (family) => !visibleFamilies.includes(family),
  )!;
  const primaryView = defaultRepresentationViewForFamily(primaryFamily);
  const secondaryView = defaultRepresentationViewForFamily(secondaryFamily);
  const inactiveView = defaultRepresentationViewForFamily(inactiveFamily);
  const renderFamily = (family: RepresentationFamily) =>
    family === 'dom2d'
      ? domTwoDimensional
      : family === 'canvas2d'
        ? canvasTwoDimensional
        : threeDimensional;
  const closeModal = () => {
    restoreModalFocus.current = true;
    setSwapArmed(false);
    modal?.onClose();
  };

  useEffect(() => {
    if (modal) setSwapArmed(false);
    else restoreModalFocus.current = true;
  }, [modal]);
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (modal) closeModal();
      else setSwapArmed(false);
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  });

  const armSwap = () => {
    if (modal) {
      restoreModalFocus.current = false;
      modal.onClose();
    }
    setSwapArmed(true);
  };
  const leaveMiniBoundary = (event: FocusEvent<HTMLDivElement>) => {
    if (
      !event.relatedTarget ||
      !miniBoundary.current?.contains(event.relatedTarget)
    )
      setSwapArmed(false);
  };
  const confirmSwap = () => {
    closeModal();
    setVisibleFamilies([secondaryFamily, primaryFamily]);
    setSwapArmed(false);
  };
  const replaceMini = () => {
    setVisibleFamilies([primaryFamily, inactiveFamily]);
    setSwapArmed(false);
  };

  return (
    <section
      className="visualization-workspace"
      data-testid="visualization-workspace"
      data-inactive-family={inactiveFamily}
      data-inactive-view={inactiveView}
    >
      <section
        className="representation-slot representation-slot-primary"
        data-testid="primary-visualization"
        data-family={primaryFamily}
        data-view={primaryView}
        data-representation-mode="normal"
      >
        <div className="representation-view-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected="true"
            data-view={primaryView}
          >
            {labelForView(primaryView)}
          </button>
        </div>
        <div className="representation-view-host">
          <RepresentationModeProvider mode="normal">
            {renderFamily(primaryFamily)}
          </RepresentationModeProvider>
        </div>
        {modal ? (
          <RepresentationModalLayer
            title={modal.title}
            onClose={closeModal}
            shouldRestoreFocus={() => restoreModalFocus.current}
          >
            {modal.content}
          </RepresentationModalLayer>
        ) : null}
      </section>
      <div
        ref={miniBoundary}
        className="mini-representation-boundary"
        data-armed={swapArmed}
        onBlurCapture={leaveMiniBoundary}
      >
        <section
          className="representation-slot representation-slot-mini"
          data-testid="secondary-minimap"
          data-family={secondaryFamily}
          data-view={secondaryView}
          data-representation-mode="mini"
        >
          <RepresentationModeProvider mode="mini">
            {renderFamily(secondaryFamily)}
          </RepresentationModeProvider>
        </section>
        <button
          type="button"
          className="mini-representation-selector"
          aria-label="Select mini representation for swap"
          aria-pressed={swapArmed}
          onClick={armSwap}
        />
        {swapArmed ? (
          <div className="mini-representation-actions">
            <button
              type="button"
              className="swap-visualizations"
              onClick={confirmSwap}
            >
              Swap visualizations
            </button>
            <button type="button" onClick={replaceMini}>
              Use {labelForFamily(inactiveFamily)} in mini
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function RepresentationModalLayer({
  title,
  children,
  onClose,
  shouldRestoreFocus,
}: Readonly<{
  title: string;
  children: ReactNode;
  onClose: () => void;
  shouldRestoreFocus: () => boolean;
}>) {
  const close = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    close.current?.focus();
    return () => {
      if (shouldRestoreFocus()) previousFocus.current?.focus();
    };
  }, []);
  const titleId = 'representation-modal-title';
  return (
    <div
      className="representation-modal-backdrop"
      data-testid="representation-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="representation-modal-card"
        role="dialog"
        aria-labelledby={titleId}
      >
        <header className="representation-modal-header">
          <h2 id={titleId}>{title}</h2>
          <button ref={close} type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="representation-modal-body">{children}</div>
      </section>
    </div>
  );
}
