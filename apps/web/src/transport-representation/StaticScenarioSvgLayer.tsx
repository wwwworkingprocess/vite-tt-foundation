import { memo, type KeyboardEvent } from 'react';
import { selectStop, type GameSelection } from '../ui/game-selection.js';
import type { VehicleSvgProjection } from './vehicle-svg-projection.js';
import { transportMapEntityVisualMetrics } from '../representation/transport-map-visual-metrics.js';
import { routePresentationDrawOrder } from '../representation/route-presentation-view.js';

const activate = (callback: () => void) => (event: KeyboardEvent) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    callback();
  }
};

function StaticScenarioSvgLayer({
  edges,
  nodes,
  selection,
  onSelectionChange,
  entityScale,
}: Readonly<{
  edges: VehicleSvgProjection['edges'];
  nodes: VehicleSvgProjection['nodes'];
  selection: GameSelection;
  onSelectionChange: ((selection: GameSelection) => void) | undefined;
  entityScale: number;
}>) {
  return (
    <g data-testid="static-scenario-svg-layer">
      <g aria-label="Directed route edges">
        {routePresentationDrawOrder(
          edges,
          selection?.kind === 'route' ? selection.routeId : undefined,
        ).map((edge) => {
          const color = edge.color ?? 'currentColor';
          const selected =
            selection?.kind === 'route' && selection.routeId === edge.routeId;
          const points = edge.arrowhead;
          const Edge = edge.enriched ? 'polyline' : 'line';
          return (
            <g
              key={edge.edgeId}
              data-edge-group-id={edge.edgeId}
              data-route-id={edge.routeId}
              data-pattern-id={edge.patternId}
              data-selected={selected}
              opacity={edge.enriched && !selected ? 0.8 : 1}
            >
              <Edge
                data-edge-id={edge.edgeId}
                data-route-id={edge.routeId}
                data-pattern-id={edge.patternId}
                points={edge.points}
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                fill="none"
                stroke={selected && !edge.enriched ? '#ffd166' : color}
                strokeWidth={
                  selected ? (edge.enriched ? '0.72' : '1.5') : '0.6'
                }
                pointerEvents="none"
                aria-hidden="true"
              />
              {points ? (
                <polygon
                  data-testid="edge-direction"
                  data-direction-edge-id={edge.edgeId}
                  data-route-id={edge.routeId}
                  data-pattern-id={edge.patternId}
                  points={points}
                  fill={selected ? '#ffd166' : color}
                  pointerEvents="none"
                  aria-hidden="true"
                />
              ) : null}
            </g>
          );
        })}
      </g>
      <g aria-label="Canonical stops">
        {nodes.map((node) => {
          const selected =
            selection?.kind === 'stop' &&
            selection.stopPlaceId === node.stopPlaceId;
          return (
            <circle
              key={node.stopNodeId}
              data-stop-node-id={node.stopNodeId}
              cx={node.cx}
              cy={node.cy}
              r={
                transportMapEntityVisualMetrics('normal').stopRadius *
                entityScale
              }
              fill="currentColor"
              stroke="transparent"
              strokeWidth="11"
              vectorEffect="non-scaling-stroke"
              role={node.stopPlaceId ? 'button' : undefined}
              tabIndex={node.stopPlaceId ? 0 : undefined}
              aria-label={
                node.stopPlaceId ? `Select stop ${node.name}` : undefined
              }
              data-stop-place-id={node.stopPlaceId}
              data-selected={selected}
              onClick={() =>
                node.stopPlaceId &&
                onSelectionChange?.(selectStop(node.stopPlaceId))
              }
              onKeyDown={
                node.stopPlaceId
                  ? activate(() =>
                      onSelectionChange?.(selectStop(node.stopPlaceId!)),
                    )
                  : undefined
              }
            />
          );
        })}
      </g>
    </g>
  );
}

export default memo(StaticScenarioSvgLayer);
