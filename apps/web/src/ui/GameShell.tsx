import {
  lazy,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  Suspense,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { FoundationSaveOutcome } from '../foundation-session-composition.js';

type DialogName = 'project' | 'simulation' | 'session';

export interface GameShellProps {
  readonly status: string;
  readonly pacingStatus: string;
  readonly persistenceStatus: string;
  readonly projectInfo: ReactNode;
  readonly simulationControls: ReactNode;
  readonly sessionControls: ReactNode;
  readonly scenarioControl: ReactNode;
  readonly primaryVisualization: ReactNode;
  readonly secondaryVisualization: ReactNode;
  readonly saveDisabled?: boolean;
  readonly restartDisabled?: boolean;
  readonly onPauseResume: () => void;
  readonly onSave: () => Promise<FoundationSaveOutcome>;
  readonly onRestart: () => void;
}

export function GameShell({
  status,
  pacingStatus,
  persistenceStatus,
  projectInfo,
  simulationControls,
  sessionControls,
  scenarioControl,
  primaryVisualization,
  secondaryVisualization,
  saveDisabled,
  restartDisabled,
  onPauseResume,
  onSave,
  onRestart,
}: GameShellProps) {
  const [openDialog, setOpenDialog] = useState<DialogName>();
  const [threePrimary, setThreePrimary] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string>();
  const trigger = useRef<HTMLElement | undefined>(undefined);
  const open =
    (dialog: DialogName) => (event: ReactMouseEvent<HTMLElement>) => {
      trigger.current = event.currentTarget;
      setOpenDialog(dialog);
    };
  const close = () => {
    setOpenDialog(undefined);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!openDialog) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [openDialog]);
  const save = async () => {
    setSaveFeedback(undefined);
    try {
      const outcome = await onSave();
      if (outcome.status === 'saved') setSaveFeedback('Save completed.');
      else if (outcome.status === 'cancelled')
        setSaveFeedback('Save cancelled.');
      else if (outcome.status === 'failed')
        setSaveFeedback(outcome.message || 'Save failed.');
    } catch (error) {
      setSaveFeedback(
        error instanceof Error && error.message
          ? error.message
          : 'Save failed.',
      );
    }
  };
  return (
    <main className="game-shell" data-testid="game-shell">
      <nav className="top-navigation" data-testid="top-navigation">
        <h1 className="brand">Torrevieja Tycoon</h1>
        <div className="navigation-scenario">{scenarioControl}</div>
        <div className="navigation-actions">
          <button onClick={open('project')}>Project info</button>
          <button onClick={open('simulation')}>Simulation controls</button>
          <button onClick={open('session')}>Load</button>
          <button disabled={saveDisabled} onClick={() => void save()}>
            Save
          </button>
          <button disabled={restartDisabled} onClick={onRestart}>
            Restart
          </button>
          <button onClick={onPauseResume}>
            {pacingStatus === 'paused' ? 'Resume' : 'Pause'}
          </button>
        </div>
        <div className="navigation-status" aria-live="polite">
          Session: {status} · Pacing: {pacingStatus} · Persistence:{' '}
          {persistenceStatus}
          {saveFeedback ? ` · ${saveFeedback}` : ''}
        </div>
      </nav>
      <section
        className="visualization-workspace"
        data-testid="visualization-workspace"
      >
        <div
          className={`visualization-surface ${
            threePrimary ? 'minimap' : 'primary'
          }`}
          data-testid={
            threePrimary ? 'secondary-minimap' : 'primary-visualization'
          }
          data-view="transport"
        >
          {primaryVisualization}
        </div>
        <div
          className={`visualization-surface ${
            threePrimary ? 'primary' : 'minimap'
          }`}
          data-testid={
            threePrimary ? 'primary-visualization' : 'secondary-minimap'
          }
          data-view="three"
        >
          {secondaryVisualization}
        </div>
        <button
          type="button"
          className="swap-visualizations"
          onClick={() => setThreePrimary((current) => !current)}
        >
          Swap visualizations
        </button>
      </section>
      {openDialog === 'project' ? (
        <Suspense fallback={null}>
          <AccessibleDialog title="Project information" onClose={close}>
            {projectInfo}
          </AccessibleDialog>
        </Suspense>
      ) : null}
      {openDialog === 'simulation' ? (
        <Suspense fallback={null}>
          <AccessibleDialog title="Simulation controls" onClose={close}>
            {simulationControls}
          </AccessibleDialog>
        </Suspense>
      ) : null}
      {openDialog === 'session' ? (
        <Suspense fallback={null}>
          <AccessibleDialog title="Saved sessions" onClose={close}>
            {sessionControls}
          </AccessibleDialog>
        </Suspense>
      ) : null}
    </main>
  );
}

const AccessibleDialog = lazy(() => import('./AccessibleDialog.js'));
