import { Vector3, Vector4, type IUniform } from 'three';
import { MAX_BANDS, type Circulation } from '../../universe/planet/circulation';
import { giantChurnOffset, giantWeatherPhases, giantWeatherLifetime, wrapWeatherAngle } from '../../universe/planet/giantWeather';

export const GIANT_WEATHER_GLSL = /* glsl */ `
uniform int uBandCount;
uniform vec4 uBands[${MAX_BANDS}];
uniform vec4 uWeatherTime; // age A, age B, weight A, weight B
uniform vec3 uWeatherSeedA;
uniform vec3 uWeatherSeedB;
uniform vec3 uChurnOffset;
uniform vec2 uPolarPhase;
uniform float uCyclonePhase[10];
uniform float uStormPhase;
uniform float uLockedPhase;

int bandAt(float lat) {
  int band = 0;
  for (int i = 0; i < ${MAX_BANDS}; i++) {
    if (i >= uBandCount) break;
    if (lat >= uBands[i].x) band = i;
  }
  return band;
}

float bandDriftAt(float l, int band) {
  float d = uBands[band].z;
  if (band + 1 < uBandCount) {
    float t = 1.0 - smoothstep(0.0, 0.04, uBands[band + 1].x - l);
    d = mix(d, uBands[band + 1].z, 0.5 * t);
  }
  if (band > 0) {
    float t = 1.0 - smoothstep(0.0, 0.04, l - uBands[band].x);
    d = mix(d, uBands[band - 1].z, 0.5 * t);
  }
  return d;
}

// Shared advected upper-cloud/micro coordinates. No new stationary noise layer
// appears when approaching a planet: both parcels follow its actual jets.
vec3 weatherPoint(vec3 p, float age, float windScale) {
  float lat = asin(clamp(p.y, -1.0, 1.0));
  float angle = age * bandDriftAt(lat, bandAt(lat)) * windScale;
  float c = cos(angle), s = sin(angle);
  return vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
}
float weatherDetail(vec3 p, vec3 seed, float frequency, float windScale) {
  vec3 a = weatherPoint(p, uWeatherTime.x, windScale);
  vec3 b = weatherPoint(p, uWeatherTime.y, windScale);
  float norm = inversesqrt(dot(uWeatherTime.zw, uWeatherTime.zw));
  return norm * (uWeatherTime.z * snoise(a * frequency + seed + uWeatherSeedA + uChurnOffset)
    + uWeatherTime.w * snoise(b * frequency + seed + uWeatherSeedB + uChurnOffset));
}
`;

export function giantWeatherUniforms(circulation: Circulation) {
  const uniforms = {
    uBandCount: { value: Math.max(1, circulation.bands.length) },
    uBands: { value: Array.from({ length: MAX_BANDS }, (_, i) => {
      const b = circulation.bands[Math.min(i, circulation.bands.length - 1)];
      return b ? new Vector4(b.latStartRad, b.latEndRad, b.driftRadPerDay, b.edgeShear) : new Vector4();
    }) },
    uWeatherTime: { value: new Vector4() },
    uWeatherSeedA: { value: new Vector3() }, uWeatherSeedB: { value: new Vector3() },
    uChurnOffset: { value: new Vector3() },
    uPolarPhase: { value: [0, 0] },
    uCyclonePhase: { value: new Array<number>(10).fill(0) },
    uStormPhase: { value: 0 }, uLockedPhase: { value: 0 },
  };
  updateGiantWeather(uniforms, circulation, 0);
  return uniforms;
}

export function updateGiantWeather(uniforms: Record<string, IUniform>, circulation: Circulation, timeDays: number): void {
  const phase = giantWeatherPhases(timeDays, giantWeatherLifetime(circulation.bands));
  uniforms.uWeatherTime.value.set(phase.ageA, phase.ageB, phase.weightA, phase.weightB);
  uniforms.uWeatherSeedA.value.set(...phase.seedA);
  uniforms.uWeatherSeedB.value.set(...phase.seedB);
  uniforms.uChurnOffset.value.set(...giantChurnOffset(timeDays, circulation.churnPerDay));
  uniforms.uPolarPhase.value = [circulation.polar.north, circulation.polar.south]
    .map(p => wrapWeatherAngle(timeDays * p.driftRadPerDay));
  for (let i = 0; i < 10; i++) uniforms.uCyclonePhase.value[i] = wrapWeatherAngle(timeDays * (1.05 + .11 * i));
  // The secondary spiral uses half this phase, so its period is 4π.
  uniforms.uStormPhase.value = 2 * wrapWeatherAngle(timeDays * circulation.churnPerDay * .11);
  uniforms.uLockedPhase.value = wrapWeatherAngle(timeDays * circulation.atmosphere.windRadPerDay);
}
