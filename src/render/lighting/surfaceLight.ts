import { Color, type ShaderMaterial } from 'three';
import { ADAPTATION_EXPONENT } from './starlight';

/**
 * Sunlight through an atmosphere, for every lit surface: the direct
 * beam extinguished along its slant path and the skylight the column
 * scatters down, from one vertical optical depth per channel. The
 * same functions run on the CPU for the star disc seen through the
 * air, so the sun that sets red is the sun whose light turned red.
 */
export const SURFACE_LIGHT_GLSL = /* glsl */ `
uniform vec3 uOpticalDepth;             // the whole column, gas and haze
uniform vec3 uRayleighDepth;
uniform vec3 uAerosolScatterDepth;      // scattering only; extinction can absorb too
uniform vec3 uAerosolExtinction;
uniform vec3 uAerosolFraction;          // the haze's share of scattering, per channel
uniform vec3 uScatteringAlbedo;         // scattering / extinction, per channel
uniform float uHorizonAirmass;
uniform float uAerosolHorizonAirmass;
uniform float uPlanetRadius;            // world units
uniform float uScaleHeight;             // world units
uniform float uAerosolScaleHeight;      // world units

const float DISPLAY_ADAPTATION_EXPONENT = ${ADAPTATION_EXPONENT.toFixed(8)};

// Relative radiance factors must pass through the same response as the
// incident stellar flux: (I·t)^a = I^a·t^a. This is display perception only;
// all transport functions themselves stay in physical linear radiance.
vec3 displayTransmittance(vec3 physicalTransmission) {
  return pow(clamp(physicalTransmission, 0.0, 1.0), vec3(DISPLAY_ADAPTATION_EXPONENT));
}

float displayTransmittance(float physicalTransmission) {
  return pow(clamp(physicalTransmission, 0.0, 1.0), DISPLAY_ADAPTATION_EXPONENT);
}

// Relative air mass along the slant path at local sun elevation mu:
// one overhead, the horizon column at grazing, held there below the
// horizon so twilight has a path to fade along.
float airmassFor(float mu, float horizon) {
  mu = max(mu, 0.0);
  return 1.0 / (mu + exp(-11.0 * mu) / horizon);
}

float airmass(float mu) {
  return airmassFor(mu, uHorizonAirmass);
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
vec3 opticalSlant(vec3 tau, float mu) {
  // Most callers use the material's whole column. The scale also
  // preserves cloud-top and interpolated columns without duplicating
  // the lighting function for each surface kind.
  vec3 relative = tau / max(uOpticalDepth, vec3(1e-6));
  return relative * (
    uRayleighDepth * airmassFor(mu, uHorizonAirmass)
      + uAerosolExtinction * airmassFor(mu, uAerosolHorizonAirmass)
  );
}

vec3 beamTransmittance(vec3 tau, float mu) {
  return exp(-opticalSlant(tau, mu));
}

vec3 opticalSlantAt(float altitude, float mu) {
  float gas = exp(-max(altitude, 0.0) / max(uScaleHeight, 1e-4));
  float haze = exp(-max(altitude, 0.0) / max(uAerosolScaleHeight, 1e-4));
  return uRayleighDepth * gas * airmassFor(mu, uHorizonAirmass)
    + uAerosolExtinction * haze * airmassFor(mu, uAerosolHorizonAirmass);
}

vec3 beamTransmittanceAt(float altitude, float mu) {
  return exp(-opticalSlantAt(altitude, mu));
}

vec3 opticalDepthAt(float altitude) {
  float gas = exp(-max(altitude, 0.0) / max(uScaleHeight, 1e-4));
  float haze = exp(-max(altitude, 0.0) / max(uAerosolScaleHeight, 1e-4));
  return uRayleighDepth * gas + uAerosolExtinction * haze;
}

vec3 tangentColumnAt(float altitude) {
  float gas = exp(-max(altitude, 0.0) / max(uScaleHeight, 1e-4));
  float haze = exp(-max(altitude, 0.0) / max(uAerosolScaleHeight, 1e-4));
  return 2.0 * (uRayleighDepth * gas * uHorizonAirmass
    + uAerosolExtinction * haze * uAerosolHorizonAirmass);
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
  // A narrow diffraction core over a broad aerosol shoulder. g=0.9
  // left the nominally sharp half of the lobe several degrees wide;
  // at sunset columns that became a false solar disc many times the
  // photosphere's angular diameter.
  return 0.12 * henyeyGreenstein(cosTheta, 0.94)
    + 0.88 * henyeyGreenstein(cosTheta, 0.4);
}

// The column's phase, gas and haze in their scattering shares. Their
// extinction paths retain their separate scale heights elsewhere.
vec3 phaseWeight(float cosTheta) {
  return mix(vec3(rayleighPhase(cosTheta)), vec3(hazePhase(cosTheta)), uAerosolFraction)
    * uScatteringAlbedo;
}

// The column's back-scatter fraction: half for Rayleigh, an eighth for
// the two-lobed haze.
vec3 backscatter() {
  return mix(vec3(0.5), vec3(0.12), uAerosolFraction) * uScatteringAlbedo;
}

// Diffuse flux through a scattering slab. The transport optical depth
// discounts the haze's measured forward asymmetry; the Eddington absorption
// eigenvalue removes photons that the single-scattering albedo says are truly
// absorbed. It reduces to the conservative two-stream 1/(1+3τ/4) law when
// absorption is zero, rather than treating every scattering event as loss via
// Beer-Lambert extinction.
vec3 diffuseTransmittance(vec3 column) {
  vec3 asymmetry = 0.46 * uAerosolFraction;
  vec3 transportAlbedo = uScatteringAlbedo * (1.0 - asymmetry);
  vec3 absorptionEigenvalue = sqrt(max(
    3.0 * (1.0 - uScatteringAlbedo)
      * (1.0 - uScatteringAlbedo * asymmetry),
    vec3(0.0)
  ));
  return exp(-column * absorptionEigenvalue)
    / (1.0 + 0.75 * column * transportAlbedo);
}

// A small, energy-bounded approximation to higher scattering orders.
// The first interaction supplies the light, absorption removes it on
// the average in/out path, and diffusion limits how much escapes a
// thick view column. It is deliberately isotropic: the single-scatter
// term retains the aureole and Rayleigh phase structure.
vec3 multipleScatterFromSlants(
  vec3 sunSlant,
  vec3 viewSlant,
  float muSun
) {
  vec3 interacted = 1.0 - exp(-sunSlant * uScatteringAlbedo);
  vec3 survived = exp(
    -(sunSlant + viewSlant) * (1.0 - uScatteringAlbedo) * 0.5
  );
  vec3 escaped = 1.0 / (1.0 + 0.35 * viewSlant * uScatteringAlbedo);
  return 0.08 * interacted * survived * escaped * twilight(muSun);
}

vec3 multipleScatter(vec3 tau, float muSun, float muView) {
  return multipleScatterFromSlants(
    opticalSlant(tau, muSun), opticalSlant(tau, muView), muSun
  );
}

vec3 multipleScatterAt(float altitude, float muSun, float muView) {
  return multipleScatterFromSlants(
    opticalSlantAt(altitude, muSun), opticalSlantAt(altitude, muView), muSun
  );
}

// A total eclipse removes the direct beam but not every illuminated
// parcel in the hemisphere. The residual is the horizon ring and air
// outside the narrow umbra; penumbra transitions remain continuous.
float diffuseShadow(float directShadow) {
  return mix(0.12, 1.0, sqrt(clamp(directShadow, 0.0, 1.0)));
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
vec3 airSegmentComponent(vec3 depth, float h, float horizon, float eyeAlt, float pointAlt, float dist) {
  h = max(h, 1e-4);
  vec3 tauEye = depth * exp(-max(eyeAlt, 0.0) / h);
  vec3 tauPoint = depth * exp(-max(pointAlt, 0.0) / h);
  float dh = abs(eyeAlt - pointAlt);
  return dh > 1e-3 * h
    ? abs(tauPoint - tauEye) * min(dist / dh, horizon)
    : (tauEye + tauPoint) * 0.5 * min(dist / h, horizon);
}

vec3 airSegmentColumn(float eyeAlt, float pointAlt, float dist) {
  return airSegmentComponent(
    uRayleighDepth, uScaleHeight, uHorizonAirmass, eyeAlt, pointAlt, dist
  ) + airSegmentComponent(
    uAerosolExtinction,
    uAerosolScaleHeight,
    uAerosolHorizonAirmass,
    eyeAlt,
    pointAlt,
    dist
  );
}

// Sunlight scattered toward the eye along that run: the beam at the
// run's middle, the phase, and the part of the run that scatters.
vec3 airSegmentScatter(vec3 column, float midAlt, float muSun, float cosTheta) {
  vec3 beam = beamTransmittanceAt(midAlt, muSun);
  return phaseWeight(cosTheta) * beam * (1.0 - exp(-column)) * twilight(muSun);
}

// Sunlight arriving at a surface element: the direct beam, Lambert-
// weighted and extinguished, plus the skylight the column scatters
// down — two-stream conservative Rayleigh, backscatter fraction one
// half — hemispherical about the local vertical. Zero depth is the
// vacuum: pure Lambert. The beam is gated at the body's own horizon
// over about a solar diameter, since a slope cannot face a sun the
// ground has hidden.
vec3 surfaceLight(
  vec3 tau,
  vec3 lightDir,
  vec3 lightColor,
  vec3 normal,
  vec3 up,
  float directShadow,
  float skyShadow
) {
  float mu = dot(up, lightDir);
  vec3 slant = opticalSlant(tau, mu);
  vec3 direct = exp(-slant);
  vec3 total = exp(-slant * (1.0 - uScatteringAlbedo))
    / (1.0 + backscatter() * slant);
  float lambert = max(dot(normal, lightDir), 0.0) * smoothstep(-0.01, 0.01, mu);
  float hemi = 0.5 + 0.5 * dot(normal, up);
  vec3 sky = max(total - direct, vec3(0.0)) * hemi * twilight(mu);
  return lightColor * (direct * lambert * directShadow + sky * skyShadow);
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

/** Diffuse atmospheric illumination retained under a local occultation. */
export function diffuseShadow(directShadow: number): number {
  return 0.12 + 0.88 * Math.sqrt(Math.min(1, Math.max(0, directShadow)));
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

/** Diffuse two-stream transmission through a scattering column, mirrored
 * from the shader for physical regression tests. */
export function diffuseTransmittance(
  tau: number,
  scatteringAlbedo: number,
  aerosolFraction = 0,
): number {
  const omega = Math.min(1, Math.max(0, scatteringAlbedo));
  const asymmetry = 0.46 * Math.min(1, Math.max(0, aerosolFraction));
  const transportAlbedo = omega * (1 - asymmetry);
  const absorptionEigenvalue = Math.sqrt(
    Math.max(0, 3 * (1 - omega) * (1 - omega * asymmetry)),
  );
  return Math.exp(-Math.max(tau, 0) * absorptionEigenvalue) /
    (1 + 0.75 * Math.max(tau, 0) * transportAlbedo);
}

/** The air a material stands under: vertical depth per channel, the
 *  horizon's air mass, and the body's radius and scale height in the
 *  material's world units. */
export interface SurfaceAir {
  rayleigh: readonly [number, number, number];
  /** Aerosol scattering depth. */
  aerosol: readonly [number, number, number];
  /** Aerosol scattering plus absorption. */
  aerosolExtinction: readonly [number, number, number];
  aerosolScaleHeightRatio: number;
  horizon: number;
  radius: number;
  scaleHeight: number;
}

export const VACUUM: SurfaceAir = {
  rayleigh: [0, 0, 0],
  aerosol: [0, 0, 0],
  aerosolExtinction: [0, 0, 0],
  aerosolScaleHeightRatio: 1,
  horizon: 1,
  radius: 1,
  scaleHeight: 1,
};

/** The whole column, gas and haze together. */
export function totalDepth(air: SurfaceAir): [number, number, number] {
  return [
    air.rayleigh[0] + air.aerosolExtinction[0],
    air.rayleigh[1] + air.aerosolExtinction[1],
    air.rayleigh[2] + air.aerosolExtinction[2],
  ];
}

function aerosolFraction(air: SurfaceAir): [number, number, number] {
  const scattering = [0, 1, 2].map((i) => air.rayleigh[i] + air.aerosol[i]);
  return scattering.map((t, i) => (t > 0 ? air.aerosol[i] / t : 0)) as [number, number, number];
}

function scatteringAlbedo(air: SurfaceAir): [number, number, number] {
  const extinction = totalDepth(air);
  return extinction.map((t, i) => (t > 0 ? (air.rayleigh[i] + air.aerosol[i]) / t : 0)) as [
    number,
    number,
    number,
  ];
}

export function surfaceLightUniforms(air: SurfaceAir = VACUUM): Record<string, { value: unknown }> {
  return {
    uOpticalDepth: { value: new Color(...totalDepth(air)) },
    uRayleighDepth: { value: new Color(...air.rayleigh) },
    uAerosolScatterDepth: { value: new Color(...air.aerosol) },
    uAerosolExtinction: { value: new Color(...air.aerosolExtinction) },
    uAerosolFraction: { value: new Color(...aerosolFraction(air)) },
    uScatteringAlbedo: { value: new Color(...scatteringAlbedo(air)) },
    uHorizonAirmass: { value: air.horizon },
    uAerosolHorizonAirmass: {
      value: horizonAirmass(air.radius, air.scaleHeight * air.aerosolScaleHeightRatio),
    },
    uPlanetRadius: { value: air.radius },
    uScaleHeight: { value: air.scaleHeight },
    uAerosolScaleHeight: { value: air.scaleHeight * air.aerosolScaleHeightRatio },
  };
}

export function applySurfaceLight(material: ShaderMaterial, air: SurfaceAir): void {
  const uniforms = material.uniforms;
  if (!uniforms.uOpticalDepth) return;
  (uniforms.uOpticalDepth.value as Color).setRGB(...totalDepth(air));
  (uniforms.uRayleighDepth.value as Color).setRGB(...air.rayleigh);
  (uniforms.uAerosolScatterDepth.value as Color).setRGB(...air.aerosol);
  (uniforms.uAerosolExtinction.value as Color).setRGB(...air.aerosolExtinction);
  (uniforms.uAerosolFraction.value as Color).setRGB(...aerosolFraction(air));
  (uniforms.uScatteringAlbedo.value as Color).setRGB(...scatteringAlbedo(air));
  uniforms.uHorizonAirmass.value = air.horizon;
  uniforms.uAerosolHorizonAirmass.value = horizonAirmass(
    air.radius,
    air.scaleHeight * air.aerosolScaleHeightRatio,
  );
  uniforms.uPlanetRadius.value = air.radius;
  uniforms.uScaleHeight.value = air.scaleHeight;
  uniforms.uAerosolScaleHeight.value = air.scaleHeight * air.aerosolScaleHeightRatio;
}

/** Mirror of the ground's illumination under one light, sun at
 *  elevation cosine muSun, for one channel: the direct beam over its
 *  slant plus the two-stream skylight, in units of the beam. */
export function groundIrradiance(
  tau: number,
  muSun: number,
  horizon: number,
  aerosolFraction = 0,
  scatteringAlbedo = 1,
  directShadow = 1,
  skyShadow = 1,
): number {
  const x = airmass(muSun, horizon);
  const direct = Math.exp(-tau * x);
  const back = (0.5 + (0.12 - 0.5) * aerosolFraction) * scatteringAlbedo;
  const total = Math.exp(-tau * (1 - scatteringAlbedo) * x) / (1 + back * tau * x);
  const gate = Math.min(1, Math.max(0, (muSun + 0.01) / 0.02));
  const lit =
    muSun >= 0
      ? 1
      : Math.exp(-((2 * horizon * horizon) / Math.PI) * (1 / Math.max(Math.sqrt(Math.max(1 - muSun * muSun, 0)), 1e-4) - 1));
  return (
    direct * Math.max(muSun, 0) * gate * directShadow +
    Math.max(total - direct, 0) * lit * skyShadow
  );
}

/** CPU mirror of the bounded higher-order sky term, per channel. */
export function multipleScatterRadiance(
  tau: number,
  scatteringAlbedo: number,
  muSun: number,
  muView: number,
  horizon: number,
): number {
  const xs = airmass(muSun, horizon);
  const xv = airmass(muView, horizon);
  const scatterTau = tau * scatteringAlbedo;
  const interacted = 1 - Math.exp(-scatterTau * xs);
  const survived = Math.exp(-tau * (1 - scatteringAlbedo) * 0.5 * (xs + xv));
  const escaped = 1 / (1 + 0.35 * scatterTau * xv);
  const lit =
    muSun >= 0
      ? 1
      : Math.exp(
          -((2 * horizon * horizon) / Math.PI) *
            (1 / Math.max(Math.sqrt(Math.max(1 - muSun * muSun, 0)), 1e-4) - 1),
        );
  return 0.08 * interacted * survived * escaped * lit;
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

const SKY_ATMOSPHERE_SCALE_HEIGHTS = 24;

function rayleighPhase(cosTheta: number): number {
  return 0.1875 * (1 + cosTheta * cosTheta);
}

function henyeyGreenstein(cosTheta: number, g: number): number {
  return (0.25 * (1 - g * g)) / (1 + g * g - 2 * g * cosTheta) ** 1.5;
}

function hazePhase(cosTheta: number): number {
  return 0.12 * henyeyGreenstein(cosTheta, 0.94) + 0.88 * henyeyGreenstein(cosTheta, 0.4);
}

function smoothstep01(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/**
 * Zenith radiance from an atmosphere whose curvature is actually
 * followed. Each parcel is lit only when its own ray to the sun clears
 * the planet; there is no observer-level twilight switch. This mirrors
 * the sky-dome integration closely enough to drive the stellar sky from
 * the light that is visibly washing it out.
 */
export function curvedZenithSkyRadiance(
  air: SurfaceAir,
  altitudeKm: number,
  muSun: number,
  sunAngularRadius = 0.0047,
  steps = 16,
): [number, number, number] {
  const gasHeight = Math.max(air.scaleHeight, 0.1);
  const aerosolHeight = Math.max(gasHeight * air.aerosolScaleHeightRatio, 0.1);
  const altitude = Math.max(altitudeKm, 0);
  const topAltitude = SKY_ATMOSPHERE_SCALE_HEIGHTS * Math.max(gasHeight, aerosolHeight);
  if (altitude >= topAltitude) return [0, 0, 0];

  const count = Math.max(1, Math.floor(steps));
  const distance = topAltitude - altitude;
  const phaseCosine = Math.min(1, Math.max(-1, muSun));
  const phaseGas = rayleighPhase(phaseCosine);
  const phaseAerosol = hazePhase(phaseCosine);
  const viewDepth = [0, 0, 0];
  const radiance = [0, 0, 0];
  // Up the vertical, the planet's own shadow ends where a parcel's
  // horizon dips as far as the sun has set, less the disc's upper
  // limb. The ray is cut there, so no sample straddles the boundary
  // and the washout follows the shadow up without stepping.
  const sunDepression = Math.max(-Math.asin(phaseCosine) - Math.max(sunAngularRadius, 1e-5), 0);
  const shadowTop = air.radius / Math.cos(sunDepression) - air.radius - altitude;

  for (let sample = 0; sample < count; sample++) {
    const q0 = sample / count;
    const q1 = (sample + 1) / count;
    const start = distance * q0 * q0;
    const end = distance * q1 * q1;
    const cut = Math.min(Math.max(shadowTop, start), end);
    for (const [from, to] of [
      [start, cut],
      [cut, end],
    ]) {
      if (to <= from) continue;
      integrate(from, to);
    }
  }

  function integrate(start: number, end: number): void {
    const ds = end - start;
    const sampleAltitude = altitude + (start + end) * 0.5;
    const gasDensity = Math.exp(-sampleAltitude / gasHeight);
    const aerosolDensity = Math.exp(-sampleAltitude / aerosolHeight);
    const radiusAtSample = air.radius + sampleAltitude;
    const horizonDip = Math.acos(Math.min(1, air.radius / radiusAtSample));
    const sunElevation = Math.asin(Math.min(1, Math.max(-1, muSun)));
    const discHalfWidth = Math.max(sunAngularRadius, 1e-5);
    const discVisible = smoothstep01(
      (sunElevation + horizonDip + discHalfWidth) / (2 * discHalfWidth),
    );
    const tangentMu = -Math.sqrt(
      Math.max(1 - (air.radius * air.radius) / (radiusAtSample * radiusAtSample), 0),
    );
    const sourceMu = Math.max(muSun, tangentMu);
    const gasSunColumn = slantColumn(sampleAltitude, sourceMu, air.radius, gasHeight);
    const aerosolSunColumn = slantColumn(
      sampleAltitude,
      sourceMu,
      air.radius,
      aerosolHeight,
    );
    const sunVisible =
      end > shadowTop && Number.isFinite(gasSunColumn) && Number.isFinite(aerosolSunColumn);

    for (let channel = 0; channel < 3; channel++) {
      const extinction =
        (air.rayleigh[channel] * gasDensity) / gasHeight +
        (air.aerosolExtinction[channel] * aerosolDensity) / aerosolHeight;
      const segmentDepth = extinction * ds;
      const viewTransmittance = Math.exp(-viewDepth[channel] - segmentDepth * 0.5);
      const sunTransmittance = sunVisible
        ? Math.exp(
            -air.rayleigh[channel] * gasSunColumn -
              air.aerosolExtinction[channel] * aerosolSunColumn,
          )
        : 0;
      const scattering =
        (air.rayleigh[channel] * gasDensity * phaseGas) / gasHeight +
        (air.aerosol[channel] * aerosolDensity * phaseAerosol) / aerosolHeight;
      radiance[channel] +=
        scattering * sunTransmittance * viewTransmittance * discVisible * ds;
      viewDepth[channel] += segmentDepth;
    }
  }

  return radiance as [number, number, number];
}
