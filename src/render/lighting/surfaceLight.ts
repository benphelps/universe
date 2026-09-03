import { Color, type ShaderMaterial } from 'three';

/**
 * Sunlight through an atmosphere, for every lit surface: the direct
 * beam extinguished along its slant path and the skylight the column
 * scatters down, from one vertical optical depth per channel. The
 * same functions run on the CPU for the star disc seen through the
 * air, so the sun that sets red is the sun whose light turned red.
 */
export const SURFACE_LIGHT_GLSL = /* glsl */ `
uniform vec3 uOpticalDepth;             // the whole column, gas and haze
uniform vec3 uAerosolFraction;          // the haze's share of it, per channel
uniform float uHorizonAirmass;
uniform float uNightFloor;
uniform float uPlanetRadius;            // world units
uniform float uScaleHeight;             // world units

// Relative air mass along the slant path at local sun elevation mu:
// one overhead, the horizon column at grazing, held there below the
// horizon so twilight has a path to fade along.
float airmass(float mu) {
  mu = max(mu, 0.0);
  return 1.0 / (mu + exp(-11.0 * mu) / uHorizonAirmass);
}

// The lit fraction of the column overhead once the sun is down: the
// shadow's lower edge rises as R(sec δ − 1) with the depression δ and
// the column above it thins exponentially — civil twilight ends about
// six degrees under on Earth from exactly this.
float twilight(float mu) {
  if (mu >= 0.0) return 1.0;
  float radiusOverHeight = 2.0 * uHorizonAirmass * uHorizonAirmass / 3.14159265;
  // Two unit vectors can dot to a hair past −1: the root must never
  // see a negative, or the anti-solar pixel turns to NaN and blooms.
  float secant = 1.0 / max(sqrt(max(1.0 - mu * mu, 0.0)), 1e-4);
  return exp(-radiusOverHeight * (secant - 1.0));
}

// Direct-beam transmittance along the slant path.
vec3 beamTransmittance(vec3 tau, float mu) {
  return exp(-tau * airmass(mu));
}

// Rayleigh's phase, normalized over the sphere: twice the light
// forward and back as sideways.
float rayleighPhase(float cosTheta) {
  return 0.1875 * (1.0 + cosTheta * cosTheta);
}

// Haze scatters forward, in two parts: the diffraction peak a few
// degrees wide that is the solar aureole, and the broad shoulder that
// brightens the horizon. One Henyey-Greenstein lobe cannot hold both —
// wide enough for the shoulder it floods twenty degrees of sky around
// the sun — so this is two, half each, sharp and wide.
float henyeyGreenstein(float cosTheta, float g) {
  return 0.25 * (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5);
}

float hazePhase(float cosTheta) {
  return 0.5 * henyeyGreenstein(cosTheta, 0.9) + 0.5 * henyeyGreenstein(cosTheta, 0.4);
}

// The column's phase, gas and haze in their shares — both are taken to
// follow the same scale height, so one integral serves them together.
vec3 phaseWeight(float cosTheta) {
  return mix(vec3(rayleighPhase(cosTheta)), vec3(hazePhase(cosTheta)), uAerosolFraction);
}

// The column's back-scatter fraction: half for Rayleigh, an eighth for
// the two-lobed haze.
vec3 backscatter() {
  return mix(vec3(0.5), vec3(0.12), uAerosolFraction);
}

// cosTheta throughout is the scattering angle's cosine: between the
// beam's own direction of travel (away from the sun) and the way to
// the eye — a sunlit face seen with the sun at one's back is
// back-scatter, a backlit crescent is the forward peak.
// The air between an eye above the column and what it looks at, over
// the vertical depths above each (tauEye is zero from space) along a
// view air mass xv with the sun at xs: what the point's own light keeps
// on the way out, and the sunlight the air between scatters toward the
// eye — the closed form of ∫ e^{-u·xs} e^{-(u-tauEye)·xv} xv du. The
// limb darkening, haze veil and bright rim of a disc seen from space
// are all this one integral at its slant.
vec3 airColumnThrough(vec3 tauEye, vec3 tauPoint, float xv) {
  return exp(-(tauPoint - tauEye) * xv);
}

vec3 airColumnScatter(vec3 tauEye, vec3 tauPoint, float xv, float xs, float cosTheta) {
  vec3 s = xv * (exp(-tauEye * xs) - exp(-tauPoint * xs - (tauPoint - tauEye) * xv)) / (xs + xv);
  return phaseWeight(cosTheta) * max(s, vec3(0.0));
}

// Inside the air: the straight run from the eye to a point, altitudes
// above the datum and the distance between, as the column it crosses —
// exact for a straight line through an exponential atmosphere, and
// capped at the horizon column where a flat slant would outrun the
// sphere. The aerial perspective the ground shows at every range.
vec3 airSegmentColumn(float eyeAlt, float pointAlt, float dist) {
  float h = max(uScaleHeight, 1e-4);
  vec3 tauEye = uOpticalDepth * exp(-max(eyeAlt, 0.0) / h);
  vec3 tauPoint = uOpticalDepth * exp(-max(pointAlt, 0.0) / h);
  float dh = abs(eyeAlt - pointAlt);
  return dh > 1e-3 * h
    ? abs(tauPoint - tauEye) * min(dist / dh, uHorizonAirmass)
    : (tauEye + tauPoint) * 0.5 * min(dist / h, uHorizonAirmass);
}

// Sunlight scattered toward the eye along that run: the beam at the
// run's middle, the phase, and the part of the run that scatters.
vec3 airSegmentScatter(vec3 column, float midAlt, float muSun, float cosTheta) {
  float h = max(uScaleHeight, 1e-4);
  vec3 tauMid = uOpticalDepth * exp(-max(midAlt, 0.0) / h);
  vec3 beam = exp(-tauMid * airmass(muSun));
  return phaseWeight(cosTheta) * beam * (1.0 - exp(-column)) * twilight(muSun);
}

// Sunlight arriving at a surface element: the direct beam, Lambert-
// weighted and extinguished, plus the skylight the column scatters
// down — two-stream conservative Rayleigh, backscatter fraction one
// half — hemispherical about the local vertical. Zero depth is the
// vacuum: pure Lambert. The beam is gated at the body's own horizon
// over about a solar diameter, since a slope cannot face a sun the
// ground has hidden.
vec3 surfaceLight(vec3 tau, vec3 lightDir, vec3 lightColor, vec3 normal, vec3 up, float shadow) {
  float mu = dot(up, lightDir);
  float x = airmass(mu);
  vec3 direct = exp(-tau * x);
  vec3 total = 1.0 / (1.0 + backscatter() * tau * x);
  float lambert = max(dot(normal, lightDir), 0.0) * smoothstep(-0.01, 0.01, mu);
  float hemi = 0.5 + 0.5 * dot(normal, up);
  vec3 sky = max(total - direct, vec3(0.0)) * hemi * twilight(mu);
  return lightColor * (direct * lambert + sky) * shadow;
}
`;

/** The horizon's air mass in verticals for an exponential atmosphere,
 *  √(πR/2H) — about thirty-five on Earth. */
export function horizonAirmass(radiusKm: number, scaleHeightKm: number): number {
  return Math.max(1, Math.sqrt((Math.PI * radiusKm) / (2 * Math.max(scaleHeightKm, 0.1))));
}

export function airmass(mu: number, horizon: number): number {
  const m = Math.max(mu, 0);
  return 1 / (m + Math.exp(-11 * m) / horizon);
}

/**
 * Optical depth from an eye at altitude toward a direction with
 * elevation cosine mu, in verticals of the surface depth: the column
 * above the eye along the slant when looking up; when looking down,
 * out through the tangent altitude and back — twice the horizontal
 * column there, less the leg behind the eye. Infinite where the
 * body itself stands in the way.
 */
export function slantColumn(
  altitudeKm: number,
  mu: number,
  radiusKm: number,
  scaleHeightKm: number,
): number {
  const h = Math.max(scaleHeightKm, 0.1);
  const horizon = horizonAirmass(radiusKm, h);
  const above = Math.exp(-altitudeKm / h);
  if (mu >= 0) return above * airmass(mu, horizon);
  const tangentKm = (radiusKm + altitudeKm) * Math.sqrt(Math.max(1 - mu * mu, 0)) - radiusKm;
  if (tangentKm < 0) return Infinity;
  return 2 * Math.exp(-tangentKm / h) * airmass(0, horizon) - above * airmass(-mu, horizon);
}

/** Direct-beam transmittance per channel along that path. */
export function beamTransmittance(
  tau: readonly [number, number, number],
  altitudeKm: number,
  mu: number,
  radiusKm: number,
  scaleHeightKm: number,
): [number, number, number] {
  const column = slantColumn(altitudeKm, mu, radiusKm, scaleHeightKm);
  return [Math.exp(-tau[0] * column), Math.exp(-tau[1] * column), Math.exp(-tau[2] * column)];
}

/** The air a material stands under: vertical depth per channel, the
 *  horizon's air mass, and the body's radius and scale height in the
 *  material's world units. */
export interface SurfaceAir {
  rayleigh: readonly [number, number, number];
  aerosol: readonly [number, number, number];
  horizon: number;
  radius: number;
  scaleHeight: number;
}

export const VACUUM: SurfaceAir = {
  rayleigh: [0, 0, 0],
  aerosol: [0, 0, 0],
  horizon: 1,
  radius: 1,
  scaleHeight: 1,
};

/** The whole column, gas and haze together. */
export function totalDepth(air: SurfaceAir): [number, number, number] {
  return [
    air.rayleigh[0] + air.aerosol[0],
    air.rayleigh[1] + air.aerosol[1],
    air.rayleigh[2] + air.aerosol[2],
  ];
}

function aerosolFraction(air: SurfaceAir): [number, number, number] {
  const total = totalDepth(air);
  return [0, 1, 2].map((i) => (total[i] > 0 ? air.aerosol[i] / total[i] : 0)) as [number, number, number];
}

export function surfaceLightUniforms(air: SurfaceAir = VACUUM): Record<string, { value: unknown }> {
  return {
    uOpticalDepth: { value: new Color(...totalDepth(air)) },
    uAerosolFraction: { value: new Color(...aerosolFraction(air)) },
    uHorizonAirmass: { value: air.horizon },
    uNightFloor: { value: 0 },
    uPlanetRadius: { value: air.radius },
    uScaleHeight: { value: air.scaleHeight },
  };
}

export function applySurfaceLight(material: ShaderMaterial, air: SurfaceAir): void {
  const uniforms = material.uniforms;
  if (!uniforms.uOpticalDepth) return;
  (uniforms.uOpticalDepth.value as Color).setRGB(...totalDepth(air));
  (uniforms.uAerosolFraction.value as Color).setRGB(...aerosolFraction(air));
  uniforms.uHorizonAirmass.value = air.horizon;
  uniforms.uPlanetRadius.value = air.radius;
  uniforms.uScaleHeight.value = air.scaleHeight;
}

/** Mirror of the ground's illumination under one light, sun at
 *  elevation cosine muSun, for one channel: the direct beam over its
 *  slant plus the two-stream skylight, in units of the beam. */
export function groundIrradiance(
  tau: number,
  muSun: number,
  horizon: number,
  aerosolFraction = 0,
): number {
  const x = airmass(muSun, horizon);
  const direct = Math.exp(-tau * x);
  const back = 0.5 + (0.12 - 0.5) * aerosolFraction;
  const total = 1 / (1 + back * tau * x);
  const gate = Math.min(1, Math.max(0, (muSun + 0.01) / 0.02));
  const lit =
    muSun >= 0
      ? 1
      : Math.exp(-((2 * horizon * horizon) / Math.PI) * (1 / Math.max(Math.sqrt(Math.max(1 - muSun * muSun, 0)), 1e-4) - 1));
  return direct * Math.max(muSun, 0) * gate + Math.max(total - direct, 0) * lit;
}

/** Mirror of the outside-eye column scatter, for tests. */
export function airColumnScatter(
  tauEye: number,
  tauPoint: number,
  xv: number,
  xs: number,
  cosTheta: number,
): number {
  const s = (xv * (Math.exp(-tauEye * xs) - Math.exp(-tauPoint * xs - (tauPoint - tauEye) * xv))) / (xs + xv);
  return 0.1875 * (1 + cosTheta * cosTheta) * Math.max(s, 0);
}

/** Mirror of the inside-air segment column, for tests. */
export function airSegmentColumn(
  tau: number,
  scaleHeight: number,
  horizon: number,
  eyeAlt: number,
  pointAlt: number,
  dist: number,
): number {
  const h = Math.max(scaleHeight, 1e-4);
  const tauEye = tau * Math.exp(-Math.max(eyeAlt, 0) / h);
  const tauPoint = tau * Math.exp(-Math.max(pointAlt, 0) / h);
  const dh = Math.abs(eyeAlt - pointAlt);
  return dh > 1e-3 * h
    ? Math.abs(tauPoint - tauEye) * Math.min(dist / dh, horizon)
    : ((tauEye + tauPoint) / 2) * Math.min(dist / h, horizon);
}

/**
 * The dome's single-scatter sky, mirrored for tests: radiance toward a
 * view direction at elevation cosine `muView`, from a sun at `muSun`,
 * separated by `cosTheta`, in units of a white Lambertian ground under
 * the beam. Per channel of the vertical optical depth.
 */
export function skyRadiance(
  tau: readonly [number, number, number],
  muView: number,
  muSun: number,
  cosTheta: number,
  horizon: number,
): [number, number, number] {
  const xv = airmass(muView, horizon);
  const xs = airmass(muSun, horizon);
  const phase = 0.1875 * (1 + cosTheta * cosTheta);
  const lit = muSun >= 0 ? 1 : Math.exp(-((2 * horizon * horizon) / Math.PI) * (1 / Math.max(Math.sqrt(Math.max(1 - muSun * muSun, 0)), 1e-4) - 1));
  return tau.map((t) => {
    const tv = t * xv;
    const den = xs - xv;
    const integral = Math.abs(den) > 1e-3 ? (xv * (Math.exp(-tv) - Math.exp(-t * xs))) / den : tv * Math.exp(-tv);
    return phase * Math.max(integral, 0) * lit;
  }) as [number, number, number];
}
