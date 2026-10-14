import { InstancedBufferAttribute } from 'three';
/** Compact per-instance physical metre dimensions, not source geometry or texture UVs. */
export function facadeParameters(
  buildings: readonly Readonly<{
    storeys: number;
    width: number;
    depth: number;
    density: number;
  }>[],
  metre: number,
) {
  const values = new Float32Array(buildings.length * 4);
  buildings.forEach((b, i) =>
    values.set(
      [b.storeys, b.width / metre, b.depth / metre, b.density >= 0.45 ? 1 : 0],
      i * 4,
    ),
  );
  return new InstancedBufferAttribute(values, 4);
}
/** Shared Lambert extension: wall-only analytic floor/window/balcony shading.
 * Derivatives fade subpixel patterns; roofs keep ordinary palette and lighting. */
export function patchCityFacadeShader(shader: {
  vertexShader: string;
  fragmentShader: string;
}) {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
 attribute vec4 cityFacade;
 varying vec4 cityWallParams;
 varying vec3 cityWallPosition;
 varying vec3 cityWallNormal;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
 cityWallParams = cityFacade;
 cityWallPosition = position;
 cityWallNormal = normal;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
 varying vec4 cityWallParams;
 varying vec3 cityWallPosition;
 varying vec3 cityWallNormal;`,
    )
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
 if (abs(cityWallNormal.y) < 0.2) {
   float floors = cityWallPosition.y * cityWallParams.x;
   float bays = abs(cityWallNormal.x) > 0.5
     ? cityWallPosition.z * cityWallParams.z / 3.2
     : cityWallPosition.x * cityWallParams.y / 3.2;
   vec2 pattern = fract(vec2(bays, floors));
   vec2 aa = max(fwidth(vec2(bays, floors)), vec2(0.002));
   float visible = 1.0 - smoothstep(0.18, 0.45, max(aa.x, aa.y));
   float windowX = smoothstep(0.20-aa.x, 0.20+aa.x,pattern.x)
     * (1.0-smoothstep(0.70-aa.x, 0.70+aa.x,pattern.x));
   float windowY = smoothstep(0.28-aa.y, 0.28+aa.y,pattern.y)
     * (1.0-smoothstep(0.78-aa.y, 0.78+aa.y,pattern.y));
   float band = 1.0-smoothstep(0.025,0.025+aa.y,min(pattern.y,1.0-pattern.y));
   float balcony = windowX * (1.0-smoothstep(0.035,0.035+aa.y,abs(pattern.y-0.22))) * cityWallParams.w;
   diffuseColor.rgb *= 1.0-visible*(0.28*windowX*windowY+0.10*band+0.13*balcony);
 }`,
    );
}
