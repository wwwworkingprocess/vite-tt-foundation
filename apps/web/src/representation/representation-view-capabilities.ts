export type RepresentationFamily = 'dom2d' | 'canvas2d' | 'd3d';
export type RepresentationView = 'map' | 'main';

export const representationFamilies = Object.freeze([
  'dom2d',
  'canvas2d',
  'd3d',
] as const satisfies readonly RepresentationFamily[]);

interface RepresentationViewCapability {
  readonly supportedViews: readonly RepresentationView[];
  readonly defaultView: RepresentationView;
}

const representationViewCapabilities = Object.freeze({
  dom2d: Object.freeze({
    supportedViews: Object.freeze(['map'] as const),
    defaultView: 'map',
  }),
  canvas2d: Object.freeze({
    supportedViews: Object.freeze(['map'] as const),
    defaultView: 'map',
  }),
  d3d: Object.freeze({
    supportedViews: Object.freeze(['main'] as const),
    defaultView: 'main',
  }),
} satisfies Readonly<
  Record<RepresentationFamily, RepresentationViewCapability>
>);

export const representationViewsForFamily = (family: RepresentationFamily) =>
  representationViewCapabilities[family].supportedViews;

export const defaultRepresentationViewForFamily = (
  family: RepresentationFamily,
) => representationViewCapabilities[family].defaultView;

export const supportsRepresentationView = (family: string, view: string) =>
  representationFamilies.some(
    (candidate) =>
      candidate === family &&
      representationViewCapabilities[candidate].supportedViews.some(
        (supported) => supported === view,
      ),
  );

export function assertSupportedRepresentationView(
  family: RepresentationFamily,
  view: RepresentationView,
): void {
  if (!supportsRepresentationView(family, view))
    throw new Error(
      `Representation family ${family} does not support view ${view}.`,
    );
}
