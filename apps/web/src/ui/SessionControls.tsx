import type {
  FoundationSaveMode,
  FoundationSessionCompositionState,
} from '../foundation-session-composition.js';

export interface SessionControlsProps {
  readonly state?: FoundationSessionCompositionState | undefined;
  readonly ready: boolean;
  readonly selectedSaveAvailable: boolean;
  readonly persistenceMessage?: string | undefined;
  readonly browserActionMessage?: string | undefined;
  readonly scenarioTitle: (scenarioId: string) => string | undefined;
  readonly onSave?: (() => Promise<void>) | undefined;
  readonly onRestore?: (() => Promise<void>) | undefined;
  readonly onRestoreSave?: ((saveId: string) => Promise<void>) | undefined;
  readonly onSaveMode?:
    ((mode: FoundationSaveMode) => Promise<void>) | undefined;
  readonly onStart?: (() => Promise<void>) | undefined;
  readonly onClose?: (() => Promise<void>) | undefined;
  readonly startDisabled: boolean;
}

const run = (operation: (() => Promise<void>) | undefined) => () => {
  void operation?.();
};

export default function SessionControls({
  state,
  ready,
  selectedSaveAvailable,
  persistenceMessage,
  browserActionMessage,
  scenarioTitle,
  onSave,
  onRestore,
  onRestoreSave,
  onSaveMode,
  onStart,
  onClose,
  startDisabled,
}: SessionControlsProps) {
  const application = state?.application;
  return (
    <div
      className="session-control-groups"
      data-testid="session-controls-content"
    >
      <section aria-labelledby="save-mode-heading">
        <h3 id="save-mode-heading">Save mode</h3>
        <fieldset>
          <legend>Save mode</legend>
          {(['manual', 'autosave'] as const).map((mode) => (
            <label key={mode}>
              <input
                type="radio"
                name="save-mode"
                checked={(state?.saveMode ?? 'manual') === mode}
                disabled={!onSaveMode || state?.operation !== 'idle'}
                onChange={run(() => onSaveMode?.(mode) ?? Promise.resolve())}
              />
              {mode === 'manual' ? 'Manual' : 'Autosave'}
            </label>
          ))}
        </fieldset>
      </section>
      <section aria-labelledby="quick-actions-heading">
        <h3 id="quick-actions-heading">Quick actions</h3>
        <button disabled={!ready} onClick={run(onSave)}>
          {state?.saveMode === 'autosave'
            ? 'Save autosave now'
            : 'Save transport session'}
        </button>
        <button
          disabled={!ready || !selectedSaveAvailable}
          onClick={run(onRestore)}
        >
          {state?.saveMode === 'autosave'
            ? 'Restore autosave'
            : 'Restore manual save'}
        </button>
        <p data-testid="manual-save-availability">
          Manual save:{' '}
          {state?.manualSaveAvailable ? 'available' : 'not available'}
        </p>
        <p data-testid="autosave-availability">
          Autosave:{' '}
          {state?.autosaveSaveAvailable ? 'available' : 'not available'}
        </p>
      </section>
      <section aria-labelledby="save-library-heading">
        <h3 id="save-library-heading">Save library</h3>
        <p data-testid="save-count">
          Saved sessions: {application?.persistence.saves.length ?? 0}
        </p>
        <p data-testid="legacy-save-count">
          Legacy incompatible saves:{' '}
          {application?.persistence.saves.filter(
            (save) => save.compatibility === 'legacy-incompatible',
          ).length ?? 0}
        </p>
        <div data-testid="save-library" aria-label="Save library">
          {application?.persistence.saves.map((save) => {
            const title = save.scenarioId
              ? (scenarioTitle(save.scenarioId) ?? save.scenarioId)
              : 'Legacy Foundation save';
            const restorable =
              save.compatibility === 'current' ||
              save.compatibility === 'migratable';
            return (
              <div key={save.saveId} data-save-id={save.saveId}>
                <span>{title}</span>{' '}
                <span>{save.scenarioId ?? 'foundation'}</span>{' '}
                <span>{save.scenarioSchemaVersion ?? 'legacy'}</span>{' '}
                <span>{save.scenarioVersion ?? 'legacy'}</span>{' '}
                <span>{save.contentHash?.slice(0, 8) ?? 'no-hash'}</span>{' '}
                <span>{save.label ?? 'Saved session'}</span>{' '}
                <span>tick {save.sourceSimulationTick}</span>{' '}
                <span>vehicles {save.authoritativeEntityCount ?? 0}</span>{' '}
                <span>snapshot {save.snapshotVersion ?? 'legacy'}</span>{' '}
                <span>{save.compatibility ?? 'legacy-incompatible'}</span>{' '}
                {restorable ? (
                  <button
                    disabled={!ready}
                    onClick={run(
                      () => onRestoreSave?.(save.saveId) ?? Promise.resolve(),
                    )}
                  >
                    Restore {title} at tick {save.sourceSimulationTick}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
      <section aria-labelledby="persistence-status-heading">
        <h3 id="persistence-status-heading">Persistence status</h3>
        <p data-testid="persistence-status">
          Persistence status: {application?.persistence.status ?? 'idle'}
          {persistenceMessage ? `: ${persistenceMessage}` : ''}
        </p>
        {state?.message ? (
          <p role="alert">Session action failed: {state.message}</p>
        ) : null}
        {browserActionMessage ? (
          <p role="alert" data-testid="browser-action-message">
            {browserActionMessage}
          </p>
        ) : null}
      </section>
      <section aria-labelledby="session-lifecycle-heading">
        <h3 id="session-lifecycle-heading">Session lifecycle</h3>
        {state?.canStartNewSession ? (
          <button type="button" disabled={startDisabled} onClick={run(onStart)}>
            Start new transport session
          </button>
        ) : (
          <button
            type="button"
            disabled={!onClose || state?.operation === 'closing'}
            onClick={run(onClose)}
          >
            Close transport Worker
          </button>
        )}
      </section>
    </div>
  );
}
