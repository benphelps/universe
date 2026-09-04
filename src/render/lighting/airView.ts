import { Color, type ShaderMaterial, type Vector3 } from 'three';
import { ADAPTATION_EXPONENT, SKYGLOW_FLUX_RATIO } from './starlight';

/**
 * The air between the eye and everything it sees from a ground: the
 * column above the eye, thinned by its altitude, along the sightline's
 * own air mass. One chunk for every material a sky holds — bodies,
 * star points, the backdrop, the volume composite — so a moon setting
 * behind a planet's air reddens and dims the way its sun does. A
 * vacuum, an envelope, or orbit seats a zero depth and passes all.
 */
export const AIR_VIEW_GLSL = /* glsl */ `
uniform vec3 uAirTau;
uniform vec3 uAirRayleighTau;
uniform vec3 uAirAerosolTau;
uniform float uAirHorizon;
uniform float uAirAerosolHorizon;
uniform vec3 uAirSunDir;
uniform float uAirSunIntensity;
uniform float uAirEclipse;
uniform float uAirScatteringAlbedo;
uniform float uAirZenithRadiance;
#ifndef AIR_UP_DECLARED
#define AIR_UP_DECLARED
uniform vec3 uAirUp;
#endif

float airViewMassFor(float mu, float horizon) {
  mu = max(mu, 0.0);
  return 1.0 / (mu + exp(-11.0 * mu) / horizon);
}

float airViewMass(float mu) {
  return airViewMassFor(mu, uAirHorizon);
}

vec3 airTransmittance(vec3 dir) {
  float mu = dot(dir, uAirUp);
  return exp(
    -uAirRayleighTau * airViewMassFor(mu, uAirHorizon)
    -uAirAerosolTau * airViewMassFor(mu, uAirAerosolHorizon)
  );
}

vec3 airTransmittanceTo(vec3 worldPos) {
  return airTransmittance(normalize(worldPos - cameraPosition));
}

// Directional daylight contrast for stellar backgrounds. The global
// intensity is seated against the zenith; this ratio corrects each
// sightline so stars emerge first in the darker anti-solar sky and
// remain washed out around the sunset aureole. Eclipse visibility is
// the direct-disc fraction measured at the observer. The sky dome
// integrates the moon shadow parcel by parcel and supplies the actual
// directional horizon ring; inventing a second directional eclipse
// shape here leaves a hard, black cutout when those shapes disagree.
// The zenith's own value depends on nothing but uniforms, so it arrives
// as one computed once a frame.
float airSkyRadianceGreen(vec3 dir) {
  if (uAirTau.g <= 0.0 || uAirSunIntensity <= 0.0) return 0.0;
  float muView = dot(dir, uAirUp);
  float muSun = dot(uAirSunDir, uAirUp);
  // Collapse the two scale heights to extinction-weighted air masses
  // for the analytic sky integral. This preserves the exact direct
  // transmittance while retaining the inexpensive closed form.
  float xv = (uAirRayleighTau.g * airViewMassFor(muView, uAirHorizon)
      + uAirAerosolTau.g * airViewMassFor(muView, uAirAerosolHorizon))
    / max(uAirTau.g, 1e-6);
  float xs = (uAirRayleighTau.g * airViewMassFor(muSun, uAirHorizon)
      + uAirAerosolTau.g * airViewMassFor(muSun, uAirAerosolHorizon))
    / max(uAirTau.g, 1e-6);
  float tv = uAirTau.g * xv;
  float ts = uAirTau.g * xs;
  float den = xs - xv;
  float integral = abs(den) > 1e-3
    ? xv * (exp(-tv) - exp(-ts)) / den
    : tv * exp(-tv);
  float cosTheta = dot(dir, uAirSunDir);
  float phase = 0.1875 * (1.0 + cosTheta * cosTheta) * uAirScatteringAlbedo;
  // Apply the observer's eclipse state uniformly to background
  // contrast. Real directional eclipse light is already composited by
  // the atmospheric volume in front of this background.
  float eclipseLight = uAirEclipse;
  float scatterTau = uAirTau.g * uAirScatteringAlbedo;
  float interacted = 1.0 - exp(-scatterTau * xs);
  float survived = exp(-uAirTau.g * (1.0 - uAirScatteringAlbedo) * 0.5 * (xs + xv));
  float escaped = 1.0 / (1.0 + 0.35 * scatterTau * xv);
  float multiple = 0.08 * interacted * survived * escaped;
  return uAirSunIntensity * (phase * max(integral, 0.0) + multiple) * eclipseLight;
}

float skyVisibility(vec3 dir) {
  // Once the sun is below the observer's horizon, the curved sky dome
  // itself supplies the directional twilight glow. Let the physically
  // computed global exposure reveal all stellar directions together;
  // retaining the old scalar dusk estimate here could hide the stars
  // after that visible glow had already gone.
  if (dot(uAirSunDir, uAirUp) < 0.0) return 1.0;
  float localDaylight = airSkyRadianceGreen(normalize(dir));
  float zenithDaylight = uAirZenithRadiance;
  float local = pow(
    ${SKYGLOW_FLUX_RATIO.toExponential()} / max(${SKYGLOW_FLUX_RATIO.toExponential()}, localDaylight),
    ${1 - ADAPTATION_EXPONENT}
  );
  float zenith = pow(
    ${SKYGLOW_FLUX_RATIO.toExponential()} / max(${SKYGLOW_FLUX_RATIO.toExponential()}, zenithDaylight),
    ${1 - ADAPTATION_EXPONENT}
  );
  return clamp(local / max(zenith, 1e-6), 0.0, 16.0);
}
`;

/**
 * Refraction, for vertex stages: the air bends a sightline down, so
 * everything in the sky stands a little higher than it is — most at
 * the horizon, where a disc's lower limb lifts more than its upper and
 * it flattens. Bennett's fit to the whole column at sea level, scaled
 * by this air's density at the ground. Vertices carry their own lift,
 * so the flattening emerges from the same rule that lifts the whole.
 */
export const AIR_REFRACT_GLSL = /* glsl */ `
#ifndef AIR_UP_DECLARED
#define AIR_UP_DECLARED
uniform vec3 uAirUp;
#endif
uniform float uAirRefraction;

vec3 airRefractPosition(vec3 worldPos) {
  if (uAirRefraction <= 0.0) return worldPos;
  vec3 rel = worldPos - cameraPosition;
  float dist = length(rel);
  vec3 dir = rel / max(dist, 1e-9);
  float sinH = clamp(dot(dir, uAirUp), -1.0, 1.0);
  float hDeg = degrees(asin(sinH));
  float lifted = max(hDeg, -1.0);
  float liftArcmin = uAirRefraction * 1.02 / tan(radians(lifted + 10.3 / (lifted + 5.11)));
  float h2 = asin(sinH) + radians(liftArcmin / 60.0);
  vec3 level = dir - uAirUp * sinH;
  float levelLen = length(level);
  if (levelLen < 1e-6) return worldPos;
  vec3 bent = level / levelLen * cos(h2) + uAirUp * sin(h2);
  return cameraPosition + bent * dist;
}
`;

export interface AirView {
  /** Vertical optical depth per channel above the eye. */
  tau: readonly [number, number, number];
  /** Molecular and aerosol shares of tau, kept separate because haze
   *  usually falls away over a much shorter vertical scale. */
  rayleighTau?: readonly [number, number, number];
  aerosolTau?: readonly [number, number, number];
  up: Vector3;
  horizon: number;
  aerosolHorizon?: number;
  /** Refraction at the ground against Earth's sea-level air: 1 lifts
   *  the horizon by Bennett's 34 arcminutes. */
  refraction: number;
  /** Direction and green-band strength of the local sun, when known. */
  sunDir?: Vector3;
  sunIntensity?: number;
  /** Direct solar visibility at the eye, 0 in the umbra and 1 clear. */
  eclipse?: number;
  /** Green-band scattering divided by total extinction. */
  scatteringAlbedo?: number;
}

/** Refraction lift in arcminutes at apparent elevation h (degrees):
 *  Bennett's fit, scaled — mirrored for tests. */
export function refractionArcmin(hDeg: number, strength: number): number {
  const h = Math.max(hDeg, -1);
  return (strength * 1.02) / Math.tan(((h + 10.3 / (h + 5.11)) * Math.PI) / 180);
}

function viewMass(mu: number, horizon: number): number {
  const m = Math.max(mu, 0);
  return 1 / (m + Math.exp(-11 * m) / horizon);
}

/**
 * The shader's zenith sky radiance in the green band — the seat the
 * directional star visibility corrects each sightline against —
 * mirrored here so the viewer computes it once a frame instead of
 * every fragment and vertex recomputing the same number.
 */
export function airZenithRadianceGreen(air: AirView): number {
  const tau = air.tau[1];
  const sunIntensity = air.sunIntensity ?? 0;
  if (tau <= 0 || sunIntensity <= 0) return 0;
  const rayleigh = (air.rayleighTau ?? air.tau)[1];
  const aerosol = (air.aerosolTau ?? [0, 0, 0])[1];
  const aerosolHorizon = air.aerosolHorizon ?? air.horizon;
  const muSun = air.sunDir ? air.sunDir.dot(air.up) : air.up.y;
  const xv =
    (rayleigh * viewMass(1, air.horizon) + aerosol * viewMass(1, aerosolHorizon)) /
    Math.max(tau, 1e-6);
  const xs =
    (rayleigh * viewMass(muSun, air.horizon) + aerosol * viewMass(muSun, aerosolHorizon)) /
    Math.max(tau, 1e-6);
  const tv = tau * xv;
  const ts = tau * xs;
  const den = xs - xv;
  const integral =
    Math.abs(den) > 1e-3 ? (xv * (Math.exp(-tv) - Math.exp(-ts))) / den : tv * Math.exp(-tv);
  const albedo = air.scatteringAlbedo ?? 1;
  const phase = 0.1875 * (1 + muSun * muSun) * albedo;
  const scatterTau = tau * albedo;
  const interacted = 1 - Math.exp(-scatterTau * xs);
  const survived = Math.exp(-tau * (1 - albedo) * 0.5 * (xs + xv));
  const escaped = 1 / (1 + 0.35 * scatterTau * xv);
  const multiple = 0.08 * interacted * survived * escaped;
  return sunIntensity * (phase * Math.max(integral, 0) + multiple) * (air.eclipse ?? 1);
}

export function airViewUniforms(): Record<string, { value: unknown }> {
  return {
    uAirTau: { value: new Color(0, 0, 0) },
    uAirRayleighTau: { value: new Color(0, 0, 0) },
    uAirAerosolTau: { value: new Color(0, 0, 0) },
    uAirUp: { value: [0, 1, 0] },
    uAirHorizon: { value: 1 },
    uAirAerosolHorizon: { value: 1 },
    uAirRefraction: { value: 0 },
    uAirSunDir: { value: [0, 1, 0] },
    uAirSunIntensity: { value: 0 },
    uAirEclipse: { value: 1 },
    uAirScatteringAlbedo: { value: 1 },
    uAirZenithRadiance: { value: 0 },
  };
}

export function applyAirView(material: ShaderMaterial, air: AirView | null): void {
  const uniforms = material.uniforms;
  if (!uniforms.uAirTau) return;
  if (air) {
    (uniforms.uAirTau.value as Color).setRGB(air.tau[0], air.tau[1], air.tau[2]);
    const rayleigh = air.rayleighTau ?? air.tau;
    const aerosol = air.aerosolTau ?? [0, 0, 0];
    (uniforms.uAirRayleighTau.value as Color).setRGB(rayleigh[0], rayleigh[1], rayleigh[2]);
    (uniforms.uAirAerosolTau.value as Color).setRGB(aerosol[0], aerosol[1], aerosol[2]);
    uniforms.uAirUp.value = [air.up.x, air.up.y, air.up.z];
    uniforms.uAirHorizon.value = air.horizon;
    uniforms.uAirAerosolHorizon.value = air.aerosolHorizon ?? air.horizon;
    uniforms.uAirRefraction.value = air.refraction;
    const sunDir = air.sunDir;
    uniforms.uAirSunDir.value = sunDir ? [sunDir.x, sunDir.y, sunDir.z] : [0, 1, 0];
    uniforms.uAirSunIntensity.value = air.sunIntensity ?? 0;
    uniforms.uAirEclipse.value = air.eclipse ?? 1;
    uniforms.uAirScatteringAlbedo.value = air.scatteringAlbedo ?? 1;
    uniforms.uAirZenithRadiance.value = airZenithRadianceGreen(air);
  } else {
    (uniforms.uAirTau.value as Color).setRGB(0, 0, 0);
    (uniforms.uAirRayleighTau.value as Color).setRGB(0, 0, 0);
    (uniforms.uAirAerosolTau.value as Color).setRGB(0, 0, 0);
    uniforms.uAirRefraction.value = 0;
    uniforms.uAirSunIntensity.value = 0;
    uniforms.uAirEclipse.value = 1;
    uniforms.uAirScatteringAlbedo.value = 1;
    uniforms.uAirZenithRadiance.value = 0;
  }
}
