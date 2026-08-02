import {
  createScenarioCoordinate,
  parseVehicleId,
  scenarioCoordinatesEqual,
  type TransportVehicleCommand,
  type VehicleState,
} from '@torrevieja-tycoon/simulation';
import type { CanonicalScenario } from '@torrevieja-tycoon/transport-domain';
import type { FoundationSessionCompositionState } from '../foundation-session-composition.js';
import type { ScenarioSelectionState } from '../scenarios/ScenarioPanel.js';
import { createDemoVehicleCommandForAuthority } from '../transport-representation/demo-vehicle-command.js';

export interface SimulationControlsProps {
  readonly status: string;
  readonly state?: FoundationSessionCompositionState | undefined;
  readonly selectedScenario?: CanonicalScenario | undefined;
  readonly scenarioSelection: ScenarioSelectionState;
  readonly selectedRouteId?: string | undefined;
  readonly authoritativeScenarioPackage?: CanonicalScenario | undefined;
  readonly authoritativePackageStatus?:
    'idle' | 'loading' | 'ready' | 'failed' | undefined;
  readonly authoritativePackageMessage?: string | undefined;
  readonly fleet?: readonly VehicleState[] | undefined;
  readonly ready: boolean;
  readonly onRouteChange: (routeId: string) => void;
  readonly onSendVehicleCommand?:
    ((command: TransportVehicleCommand) => Promise<void>) | undefined;
  readonly onVehicleActionMessage: (message: string | undefined) => void;
  readonly onMode?:
    | ((mode: 'paused' | 'normal' | 'fast' | 'maximum') => Promise<void>)
    | undefined;
  readonly onBonus?: (() => Promise<void>) | undefined;
}

const run = (operation: (() => Promise<void>) | undefined) => () => {
  void operation?.();
};

export default function SimulationControls({
  status,
  state,
  selectedScenario,
  scenarioSelection,
  selectedRouteId,
  authoritativeScenarioPackage,
  authoritativePackageStatus,
  authoritativePackageMessage,
  fleet,
  ready,
  onRouteChange,
  onSendVehicleCommand,
  onVehicleActionMessage,
  onMode,
  onBonus,
}: SimulationControlsProps) {
  const application = state?.application;
  const pacing = state?.pacing;
  const session = application?.session;
  const firstVehicle = fleet?.[0];
  const createVehicle = async () => {
    if (!application?.scenario || !authoritativeScenarioPackage) return;
    try {
      const command = createDemoVehicleCommandForAuthority(
        application.scenario,
        (coordinate) =>
          scenarioCoordinatesEqual(
            coordinate,
            createScenarioCoordinate(authoritativeScenarioPackage),
          )
            ? authoritativeScenarioPackage
            : undefined,
        fleet ?? [],
        selectedRouteId,
      );
      onVehicleActionMessage(undefined);
      await onSendVehicleCommand?.(command);
    } catch (error) {
      onVehicleActionMessage(
        error instanceof Error
          ? error.message
          : 'The demo vehicle could not be created.',
      );
    }
  };
  return (
    <div
      className="simulation-control-groups"
      aria-label="Authoritative transport Worker status"
      data-testid="simulation-controls-content"
    >
      <section aria-labelledby="authority-status-heading">
        <h3 id="authority-status-heading">Authority status</h3>
        <p data-testid="worker-status">Worker status: {status}</p>
        <p data-testid="worker-tick">
          Worker tick: {application?.authoritative?.simulationTick ?? 'pending'}
        </p>
        <p data-testid="worker-timeline">
          Timeline:{' '}
          {session?.status === 'ready' ? session.timelineId : 'pending'}
        </p>
        <p data-testid="command-revision">
          Command revision:{' '}
          {application?.authoritative?.commandRevision ?? 'pending'}
        </p>
        <p data-testid="stream-offset">
          Stream offset: {application?.authoritative?.streamOffset ?? 'pending'}
        </p>
        <p data-testid="scenario-coordinate">
          Scenario coordinate:{' '}
          {application?.scenario
            ? `${application.scenario.scenarioSchemaVersion}:${application.scenario.scenarioId}@${application.scenario.scenarioVersion}#${application.scenario.contentHash}`
            : 'pending'}
        </p>
        <p data-testid="selected-scenario">
          Selected scenario:{' '}
          {selectedScenario?.manifest.scenarioId ?? 'pending'}
        </p>
        <p data-testid="requested-scenario">
          Requested scenario:{' '}
          {scenarioSelection.requestedScenarioId ?? 'pending'} (
          {scenarioSelection.status})
        </p>
        <p data-testid="active-scenario">
          Active authoritative scenario:{' '}
          {application?.scenario?.scenarioId ?? 'pending'}
        </p>
        {selectedScenario &&
        application?.scenario &&
        selectedScenario.manifest.scenarioId !==
          application.scenario.scenarioId ? (
          <p>
            Selected scenario will become active when a new session is started.
          </p>
        ) : null}
      </section>
      <section aria-labelledby="routes-fleet-heading">
        <h3 id="routes-fleet-heading">Routes and fleet</h3>
        <label>
          Vehicle route
          <select
            value={selectedRouteId ?? ''}
            disabled={!ready || !authoritativeScenarioPackage}
            onChange={(event) => onRouteChange(event.target.value)}
          >
            {authoritativeScenarioPackage?.routes.routes.map((route) => (
              <option key={route.routeId} value={route.routeId}>
                {route.publicCode} — {route.name}
              </option>
            ))}
          </select>
        </label>
        <div
          data-testid="route-list"
          aria-label="Canonical routes"
          data-authoritative-scenario-id={
            authoritativeScenarioPackage?.manifest.scenarioId
          }
          data-authoritative-content-hash={
            authoritativeScenarioPackage?.manifest.contentHash
          }
        >
          {authoritativeScenarioPackage?.routes.routes.map((route) => (
            <div key={route.routeId} data-route-id={route.routeId}>
              <strong>
                {route.publicCode} — {route.name}
              </strong>{' '}
              <span>{route.routeId}</span>
              <ol>
                {route.patterns.map((pattern) => (
                  <li
                    key={pattern.patternId}
                    data-pattern-id={pattern.patternId}
                  >
                    {pattern.directionLabel} ({pattern.stopNodeIds.length}{' '}
                    stops)
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        <p data-testid="vehicle-count">Vehicle count: {fleet?.length ?? 0}</p>
        <p data-testid="vehicle-id">
          Vehicle: {firstVehicle?.vehicleId ?? 'none'}
        </p>
        <p data-testid="vehicle-pattern">
          Pattern: {firstVehicle?.patternId ?? 'none'}
        </p>
        <p data-testid="vehicle-movement">
          Movement: {firstVehicle?.movement.kind ?? 'none'}
        </p>
        <p data-testid="vehicle-location">
          Location:{' '}
          {firstVehicle?.movement.kind === 'running-on-edge'
            ? firstVehicle.movement.edgeId
            : (firstVehicle?.movement.stopNodeId ?? 'none')}
        </p>
        <p data-testid="vehicle-progress">
          Progress:{' '}
          {firstVehicle?.movement.kind === 'running-on-edge'
            ? `${firstVehicle.movement.progressTicks}/${firstVehicle.movement.travelTicks}`
            : 'not-on-edge'}
        </p>
        <div
          data-testid="vehicle-list"
          aria-label="Authoritative fleet"
          data-authoritative-scenario-id={
            authoritativeScenarioPackage?.manifest.scenarioId
          }
          data-authoritative-content-hash={
            authoritativeScenarioPackage?.manifest.contentHash
          }
        >
          {fleet?.map((vehicle) => {
            const movement = vehicle.movement;
            const onEdge = movement.kind === 'running-on-edge';
            return (
              <div
                key={vehicle.vehicleId}
                data-testid={`vehicle-row-${vehicle.vehicleId}`}
                data-vehicle-id={vehicle.vehicleId}
                data-pattern-id={vehicle.patternId}
                data-route-id={vehicle.routeId}
                data-route-leg-index={vehicle.routeLegIndex}
                data-completed-route-cycles={vehicle.completedRouteCycles}
                data-plan-travel-ticks={vehicle.movementPlan.edgeTravelTicks.join(
                  ',',
                )}
                data-movement-kind={movement.kind}
                data-stop-id={onEdge ? undefined : movement.stopNodeId}
                data-edge-id={onEdge ? movement.edgeId : undefined}
                data-edge-sequence={onEdge ? movement.edgeSequence : undefined}
                data-progress-numerator={
                  onEdge ? movement.progressTicks : undefined
                }
                data-progress-denominator={
                  onEdge ? movement.travelTicks : undefined
                }
              >
                <span>{vehicle.vehicleId}</span>{' '}
                <span>{vehicle.patternId}</span> <span>{movement.kind}</span>{' '}
                <span>
                  {onEdge
                    ? `${movement.edgeId} ${movement.progressTicks}/${movement.travelTicks}`
                    : movement.stopNodeId}
                </span>{' '}
                {movement.kind === 'parked-at-stop' ? (
                  <button
                    disabled={!ready}
                    onClick={run(
                      () =>
                        onSendVehicleCommand?.({
                          kind: 'transport.vehicle.start',
                          vehicleId: parseVehicleId(vehicle.vehicleId),
                        }) ?? Promise.resolve(),
                    )}
                  >
                    Start {vehicle.vehicleId}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
      <section aria-labelledby="vehicle-commands-heading">
        <h3 id="vehicle-commands-heading">Vehicle commands</h3>
        <button
          disabled={!ready || !authoritativeScenarioPackage}
          onClick={run(createVehicle)}
        >
          Create demo vehicle
        </button>
        {authoritativePackageStatus === 'loading' ? (
          <p>Authoritative scenario package loading.</p>
        ) : null}
        {authoritativePackageStatus === 'failed' ? (
          <p role="alert">{authoritativePackageMessage}</p>
        ) : null}
      </section>
      <section
        aria-labelledby="pacing-heading"
        aria-label="Foundation pacing controls"
      >
        <h3 id="pacing-heading">Pacing</h3>
        {(['paused', 'normal', 'fast', 'maximum'] as const).map((mode) => (
          <button
            key={mode}
            disabled={!ready}
            onClick={run(() => onMode?.(mode) ?? Promise.resolve())}
          >
            {mode === 'paused'
              ? 'Pause'
              : mode === 'normal'
                ? 'Normal 20×'
                : mode === 'fast'
                  ? 'Fast 50×'
                  : 'Maximum 60×'}
          </button>
        ))}
        <button disabled={!ready} onClick={run(onBonus)}>
          Grant demo 2× bonus
        </button>
        <p data-testid="pacing-rate">
          Effective rate: {pacing?.effectiveRate ?? 0}×
        </p>
        <p data-testid="pacing-status">
          Pacing status: {pacing?.status ?? 'idle'}
          {pacing?.message ? `: ${pacing.message}` : ''}
        </p>
        <p data-testid="bonus-ticks">
          Bonus ticks remaining: {pacing?.remainingDoubleSpeedBonusTicks ?? 0}
        </p>
        <p data-testid="pacing-credit">
          Pacing credit: {pacing?.creditGameMicroseconds ?? 0}
        </p>
      </section>
    </div>
  );
}
