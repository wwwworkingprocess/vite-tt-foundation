import { memo, type KeyboardEvent } from 'react';
import {
  selectRoute,
  selectStop,
  type GameSelection,
} from '../ui/game-selection.js';
import type { VehicleSvgProjection } from './vehicle-svg-projection.js';

const activate = (callback: () => void) => (event: KeyboardEvent) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    callback();
  }
};

const arrow = (edge: VehicleSvgProjection['edges'][number]) => {
  const dx = edge.x2 - edge.x1;
  const dy = edge.y2 - edge.y1;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return undefined;
  const x = dx / distance;
  const y = dy / distance;
  const midpointX = (edge.x1 + edge.x2) / 2;
  const midpointY = (edge.y1 + edge.y2) / 2;
  const halfLength = Math.min(1.2, distance * 0.18);
  const halfWidth = Math.min(0.8, distance * 0.12);
  const baseX = midpointX - x * halfLength;
  const baseY = midpointY - y * halfLength;
  return `${midpointX + x * halfLength},${midpointY + y * halfLength} ${baseX - y * halfWidth},${baseY + x * halfWidth} ${baseX + y * halfWidth},${baseY - x * halfWidth}`;
};

function StaticScenarioSvgLayer({
  edges,
  nodes,
  selection,
  onSelectionChange,
}: Readonly<{
  edges: VehicleSvgProjection['edges'];
  nodes: VehicleSvgProjection['nodes'];
  selection: GameSelection;
  onSelectionChange: ((selection: GameSelection) => void) | undefined;
}>) {
  return (
    <g data-testid="static-scenario-svg-layer">
      <g aria-label="Directed route edges">
        {edges.map((edge) => {
          const color = edge.color ?? 'currentColor';
          const points = arrow(edge);
          return (
            <g
              key={edge.edgeId}
              data-edge-group-id={edge.edgeId}
              data-route-id={edge.routeId}
              data-pattern-id={edge.patternId}
            >
              <line
                data-edge-id={edge.edgeId}
                data-route-id={edge.routeId}
                data-pattern-id={edge.patternId}
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                stroke={color}
                strokeWidth="0.6"
                role="button"
                tabIndex={0}
                aria-label={`Select route ${edge.routeId}`}
                data-selected={
                  selection?.kind === 'route' &&
                  selection.routeId === edge.routeId
                }
                onClick={() => onSelectionChange?.(selectRoute(edge.routeId))}
                onKeyDown={activate(() =>
                  onSelectionChange?.(selectRoute(edge.routeId)),
                )}
              />
              {points ? (
                <polygon
                  data-testid="edge-direction"
                  data-direction-edge-id={edge.edgeId}
                  data-route-id={edge.routeId}
                  data-pattern-id={edge.patternId}
                  points={points}
                  fill={color}
                  pointerEvents="none"
                  aria-hidden="true"
                />
              ) : null}
            </g>
          );
        })}
      </g>
      <g aria-label="Canonical stops">
        {nodes.map((node) => (
          <circle
            key={node.stopNodeId}
            data-stop-node-id={node.stopNodeId}
            cx={node.cx}
            cy={node.cy}
            r="0.8"
            fill="currentColor"
            role={node.stopPlaceId ? 'button' : undefined}
            tabIndex={node.stopPlaceId ? 0 : undefined}
            aria-label={
              node.stopPlaceId ? `Select stop ${node.name}` : undefined
            }
            data-stop-place-id={node.stopPlaceId}
            data-selected={
              selection?.kind === 'stop' &&
              selection.stopPlaceId === node.stopPlaceId
            }
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
        ))}
      </g>
    </g>
  );
}

export default memo(StaticScenarioSvgLayer);
