import { memo, useLayoutEffect, useMemo } from 'react';
import type { CanonicalScenario } from '@torrevieja-tycoon/transport-domain';
import { createScenarioSvgPositionProjector } from './vehicle-svg-projection.js';
import {
  beginRepresentationProfile,
  finishRepresentationProfile,
  recordRepresentationProfile,
} from '../performance/representation-profiler.js';

interface PopulationCell {
  readonly cellId: string;
  readonly center: Readonly<{ latitude: number; longitude: number }>;
  readonly populationWeight: number;
}

type SvgPoint = Readonly<{ cx: number; cy: number }>;

const intensityBandCount = 8;

function PopulationGridOverlay(props: {
  readonly cells: readonly PopulationCell[];
  readonly resolutionDegrees: number;
  readonly demandModelContentHash?: string;
  readonly scenario?: CanonicalScenario;
  readonly project?: (position: PopulationCell['center']) => SvgPoint;
  readonly visible?: boolean;
}) {
  const renderProfile = beginRepresentationProfile(
    'population.render-to-commit',
  );
  recordRepresentationProfile('population.render');
  const visible = props.visible ?? true;
  const scenarioProject = useMemo(
    () =>
      props.scenario
        ? createScenarioSvgPositionProjector(props.scenario)
        : undefined,
    [props.scenario],
  );
  const geometry = useMemo(() => {
    const profile = beginRepresentationProfile('population.geometry');
    if (!visible) {
      if (profile)
        finishRepresentationProfile(profile, {
          primitiveCount: 0,
          cellCount: 0,
        });
      return [];
    }
    const project =
      props.project ??
      ((position: PopulationCell['center']) => {
        if (!scenarioProject)
          throw new Error(
            'Population overlay requires a geographic projection.',
          );
        return scenarioProject(position);
      });
    const maximum = Math.max(
      ...props.cells.map((cell) => cell.populationWeight),
      1,
    );
    const bands = Array.from({ length: intensityBandCount }, () => ({
      paths: [] as string[],
      cellCount: 0,
    }));
    const halfResolution = props.resolutionDegrees / 2;
    for (const cell of props.cells) {
      const northWest = project({
        latitude: cell.center.latitude + halfResolution,
        longitude: cell.center.longitude - halfResolution,
      });
      const southEast = project({
        latitude: cell.center.latitude - halfResolution,
        longitude: cell.center.longitude + halfResolution,
      });
      const x = Math.min(northWest.cx, southEast.cx);
      const y = Math.min(northWest.cy, southEast.cy);
      const width = Math.abs(southEast.cx - northWest.cx);
      const height = Math.abs(southEast.cy - northWest.cy);
      const band = Math.min(
        intensityBandCount - 1,
        Math.floor((cell.populationWeight / maximum) * intensityBandCount),
      );
      bands[band]!.paths.push(`M${x} ${y}h${width}v${height}h-${width}Z`);
      bands[band]!.cellCount += 1;
    }
    const result = bands
      .map((band, index) => ({
        ...band,
        opacity: 0.15 + ((index + 1) / intensityBandCount) * 0.65,
      }))
      .filter((band) => band.paths.length > 0);
    if (profile)
      finishRepresentationProfile(profile, {
        primitiveCount: result.length,
        cellCount: props.cells.length,
      });
    return result;
  }, [
    props.cells,
    props.project,
    props.resolutionDegrees,
    scenarioProject,
    visible,
  ]);
  useLayoutEffect(() => {
    if (!renderProfile) return;
    const detail = {
      visible,
      primitiveCount: visible ? geometry.length : 0,
      cellCount: visible ? props.cells.length : 0,
    };
    finishRepresentationProfile(renderProfile, detail);
    recordRepresentationProfile('population.commit', detail);
  });

  return (
    <section className="population-grid-overlay" aria-label="Population field">
      {visible ? (
        <svg
          role="img"
          aria-label="Operational population grid"
          viewBox="0 0 100 100"
          data-population-cell-count={props.cells.length}
          data-population-primitive-count={geometry.length}
          data-authoritative-scenario-id={props.scenario?.manifest.scenarioId}
          data-population-demand-model-hash={props.demandModelContentHash}
        >
          {geometry.map((band, index) => (
            <path
              key={band.opacity}
              data-testid="population-band"
              data-population-band-index={index}
              data-population-band-cell-count={band.cellCount}
              d={band.paths.join('')}
              fill="currentColor"
              opacity={band.opacity}
            />
          ))}
        </svg>
      ) : null}
    </section>
  );
}

export default memo(PopulationGridOverlay);
