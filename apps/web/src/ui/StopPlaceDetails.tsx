import { memo } from 'react';
import type { StopPlaceDetailsModel } from './stop-place-details-model.js';

export interface StopPlaceDetailsProps {
  readonly model: StopPlaceDetailsModel;
  readonly live?: Readonly<{
    waitingPassengers: number;
    waitingCohorts: number;
    distinctDestinations: number;
    boardingThisTick: number;
    alightingThisTick: number;
    destinationAccess: number;
  }>;
}

function StopPlaceDetails({ model, live }: StopPlaceDetailsProps) {
  const { stopPlace } = model;
  return (
    <section className="stop-place-details">
      <section aria-label="Stop overview">
        <h3>Stop overview</h3>
        <p>
          Services:{' '}
          {model.services.map((service) => (
            <b className="route-badge" key={service.routeId}>
              {service.publicCode}
            </b>
          ))}
        </p>
      </section>
      <p>
        {stopPlace.stopPlaceId} · Settlement:{' '}
        {model.settlement?.name ?? stopPlace.settlementId} ·{' '}
        {stopPlace.position
          ? `Position: ${stopPlace.position.latitude}, ${stopPlace.position.longitude}`
          : 'No canonical position'}
      </p>
      {live ? (
        <section aria-label="Live StopPlace state" className="stop-live-state">
          <h3>Live StopPlace state</h3>
          <dl>
            {[
              ['Waiting passengers', live.waitingPassengers],
              ['Waiting cohorts', live.waitingCohorts],
              ['Distinct destinations', live.distinctDestinations],
              ['Boarding this tick', live.boardingThisTick],
              ['Alighting this tick', live.alightingThisTick],
              ['Destination access', live.destinationAccess],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      <h3>Serving routes</h3>
      {model.services.length ? (
        model.services.map((service) => (
          <section className="stop-service" key={service.routeId}>
            <h4>
              <b className="route-badge">{service.publicCode}</b> {service.name}
            </h4>
            <p>{service.dataStatus}</p>
            <div className="stop-patterns">
              {service.patterns.map((pattern) => (
                <div key={pattern.patternId}>
                  <h5>
                    {pattern.directionLabel}
                    {pattern.closesLoop ? ' · Loop' : ''}
                  </h5>
                  <ol className="stop-sequence">
                    {pattern.stops.map((stop) => (
                      <li
                        key={`${stop.stopNodeId}-${stop.occurrenceIndex}`}
                        data-selected={stop.selected}
                      >
                        <span>
                          {stop.name}
                          {stop.selected ? ' — Selected StopPlace' : ''}
                        </span>
                        {stop.services.length ? (
                          <span>
                            {stop.services.map((badge) => (
                              <b className="route-badge" key={badge.routeId}>
                                {badge.publicCode}
                              </b>
                            ))}
                          </span>
                        ) : null}
                        {!stop.stopPlaceId ? (
                          <small>No physical StopPlace</small>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </section>
        ))
      ) : (
        <p>No routes.</p>
      )}
      <details>
        <summary>Technical stop information</summary>
        <p>
          Directional nodes:{' '}
          {model.directionalNodes
            .map(({ stopNodeId }) => stopNodeId)
            .join(', ') || 'none'}
        </p>
      </details>
      <p className="stop-timetable-unavailable">
        Timetable and service-frequency data are not part of the current
        scenario.
      </p>
    </section>
  );
}

export default memo(StopPlaceDetails);
