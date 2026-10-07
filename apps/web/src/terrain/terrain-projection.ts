/** EPSG 9820 oblique ellipsoidal LAEA, GRS80 and EPSG:3035 parameters.
 * Equations: USGS PP1395 / EPSG Guidance Note 7-2.
 * https://gdal.org/en/stable/proj_list/guid7.html#id1
 * Geographic inputs use EPSG:1149's published ETRS89/WGS84 null operation (1m
 * accuracy, Europe, no coordinate epoch). No local affine/ spherical approximation.
 * Projected assets explicitly use easting X/northing Y, not EPSG axis order.
 */
const radians = Math.PI / 180;
const a = 6378137;
const f = 1 / 298.257222101;
const e2 = f * (2 - f);
const e = Math.sqrt(e2);
const phi0 = 52 * radians;
function q(phi: number) {
  const s = Math.sin(phi);
  return (
    (1 - e2) *
    (s / (1 - e2 * s * s) - Math.log((1 - e * s) / (1 + e * s)) / (2 * e))
  );
}
const qp = q(Math.PI / 2);
const beta0 = Math.asin(q(phi0) / qp);
const sb = Math.sin(beta0),
  cb = Math.cos(beta0);
const rq = a * Math.sqrt(qp / 2);
const d =
  (a * Math.cos(phi0)) / (Math.sqrt(1 - e2 * Math.sin(phi0) ** 2) * rq * cb);
export function geographicToTerrain(
  point: Readonly<{ longitude: number; latitude: number }>,
) {
  const beta = Math.asin(q(point.latitude * radians) / qp);
  const lambda = (point.longitude - 10) * radians;
  const b =
    rq *
    Math.sqrt(
      2 / (1 + sb * Math.sin(beta) + cb * Math.cos(beta) * Math.cos(lambda)),
    );
  return Object.freeze({
    x: 4321000 + b * d * Math.cos(beta) * Math.sin(lambda),
    y:
      3210000 +
      (b / d) * (cb * Math.sin(beta) - sb * Math.cos(beta) * Math.cos(lambda)),
  });
}
export function terrainToGeographic(point: Readonly<{ x: number; y: number }>) {
  const x = (point.x - 4321000) / d,
    y = (point.y - 3210000) * d;
  const rho = Math.hypot(x, y);
  if (rho < 1e-9) return Object.freeze({ longitude: 10, latitude: 52 });
  const c = 2 * Math.asin(rho / (2 * rq));
  const sinBeta = Math.cos(c) * sb + (y * Math.sin(c) * cb) / rho;
  const targetQ = qp * sinBeta;
  // Solve authalic latitude back to geodetic latitude instead of truncating a series.
  let phi = Math.asin(sinBeta);
  for (let i = 0; i < 6; i++) {
    const s = Math.sin(phi);
    phi -=
      (q(phi) - targetQ) /
      ((2 * (1 - e2) * Math.cos(phi)) / (1 - e2 * s * s) ** 2);
  }
  return Object.freeze({
    longitude:
      10 +
      Math.atan2(
        x * Math.sin(c),
        rho * cb * Math.cos(c) - y * sb * Math.sin(c),
      ) /
        radians,
    latitude: phi / radians,
  });
}
