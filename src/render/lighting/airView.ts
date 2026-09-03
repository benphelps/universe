import { Color, type ShaderMaterial, type Vector3 } from 'three';

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
uniform float uAirHorizon;
#ifndef AIR_UP_DECLARED
#define AIR_UP_DECLARED
uniform vec3 uAirUp;
#endif

float airViewMass(float mu) {
  mu = max(mu, 0.0);
  return 1.0 / (mu + exp(-11.0 * mu) / uAirHorizon);
}

vec3 airTransmittance(vec3 dir) {
  return exp(-uAirTau * airViewMass(dot(dir, uAirUp)));
}

vec3 airTransmittanceTo(vec3 worldPos) {
  return airTransmittance(normalize(worldPos - cameraPosition));
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
  up: Vector3;
  horizon: number;
  /** Refraction at the ground against Earth's sea-level air: 1 lifts
   *  the horizon by Bennett's 34 arcminutes. */
  refraction: number;
}

/** Refraction lift in arcminutes at apparent elevation h (degrees):
 *  Bennett's fit, scaled — mirrored for tests. */
export function refractionArcmin(hDeg: number, strength: number): number {
  const h = Math.max(hDeg, -1);
  return (strength * 1.02) / Math.tan(((h + 10.3 / (h + 5.11)) * Math.PI) / 180);
}

export function airViewUniforms(): Record<string, { value: unknown }> {
  return {
    uAirTau: { value: new Color(0, 0, 0) },
    uAirUp: { value: [0, 1, 0] },
    uAirHorizon: { value: 1 },
    uAirRefraction: { value: 0 },
  };
}

export function applyAirView(material: ShaderMaterial, air: AirView | null): void {
  const uniforms = material.uniforms;
  if (!uniforms.uAirTau) return;
  if (air) {
    (uniforms.uAirTau.value as Color).setRGB(air.tau[0], air.tau[1], air.tau[2]);
    uniforms.uAirUp.value = [air.up.x, air.up.y, air.up.z];
    uniforms.uAirHorizon.value = air.horizon;
    uniforms.uAirRefraction.value = air.refraction;
  } else {
    (uniforms.uAirTau.value as Color).setRGB(0, 0, 0);
    uniforms.uAirRefraction.value = 0;
  }
}
