import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { meanAnomalyAt, meanMotion } from '../../core/math/orbit';
import { DAY } from '../../core/physics/constants';
import { seconds, type Mu } from '../../core/physics/units';
import type { Asteroid } from '../../universe/smallbody/types';

const VERTEX = /* glsl */ `
attribute vec4 aOrbit0; // semi-major axis km, eccentricity, inclination, ascending node
attribute vec4 aOrbit1; // periapsis argument, base mean anomaly, rad/day, pseudo-luminosity
attribute float aRadiusKm;
attribute vec2 aFlags;  // host-relative, local-reach-limited

uniform float uElapsedDays;
uniform float uKmPerPc;
uniform float uReachKm;
uniform vec3 uHostOffsetKm;
uniform vec3 uColor;

varying vec3 vColor;
varying float vAlpha;

void main() {
  float a = aOrbit0.x;
  float e = aOrbit0.y;
  float meanAnomaly = mod(aOrbit1.y + aOrbit1.z * uElapsedDays, 6.2831853);
  // Belt eccentricities are capped at 0.4; five Newton steps converge
  // well past the precision of the float attributes.
  float eccentricAnomaly = meanAnomaly;
  for (int i = 0; i < 5; i++) {
    eccentricAnomaly -=
      (eccentricAnomaly - e * sin(eccentricAnomaly) - meanAnomaly) /
      (1.0 - e * cos(eccentricAnomaly));
  }

  float xPerifocal = a * (cos(eccentricAnomaly) - e);
  float yPerifocal = a * sqrt(1.0 - e * e) * sin(eccentricAnomaly);
  float cosW = cos(aOrbit1.x);
  float sinW = sin(aOrbit1.x);
  float x1 = cosW * xPerifocal - sinW * yPerifocal;
  float y1 = sinW * xPerifocal + cosW * yPerifocal;
  float cosI = cos(aOrbit0.z);
  float sinI = sin(aOrbit0.z);
  float cosO = cos(aOrbit0.w);
  float sinO = sin(aOrbit0.w);
  vec3 reference = vec3(
    cosO * x1 - sinO * cosI * y1,
    sinO * x1 + cosO * cosI * y1,
    sinI * y1
  );
  // Model frame (z out of plane) into the viewer's Y-up world frame.
  vec3 localKm = vec3(reference.x, reference.z, -reference.y);
  localKm += uHostOffsetKm * aFlags.x;

  vec4 mvPosition = modelViewMatrix * vec4(localKm, 1.0);
  float distanceKm = max(length(mvPosition.xyz), 1.0);
  float distancePc = max(distanceKm / uKmPerPc, 1e-12);
  // The same marker floor the CPU path used: below true visibility a
  // nearby member remains a restrained, distance-invariant locator.
  float luminosity = max(aOrbit1.w, 2.5e-5 * distancePc * distancePc);
  float logEnergy = log2(max(luminosity / (distancePc * distancePc), 1e-12)) + 17.0;
  float size = clamp(1.5 + 0.45 * logEnergy, 1.0, 6.5);
  float energy = clamp(0.055 * exp2(0.36 * logEnergy), 0.012, 1.7);
  energy *= 1.0 - smoothstep(0.002, 0.004, aRadiusKm / distanceKm);
  if (aFlags.y > 0.5 && distanceKm > uReachKm) energy = 0.0;
  vColor = uColor * energy;
  vAlpha = clamp(energy * 4.0, 0.0, 1.0);
  gl_PointSize = energy > 0.0 ? size : 0.0;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float falloff = 1.0 - smoothstep(0.25, 1.0, length(c));
  gl_FragColor = vec4(vColor * falloff * vAlpha, 1.0);
}
`;

export const BELT_REGION_POINT_CAPACITY = 900;

/** Local belt glints whose Kepler propagation runs in the vertex shader. */
export function createBeltRegionPoints(kmPerPc: number, reachKm: number): Points {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(BELT_REGION_POINT_CAPACITY * 3), 3),
  );
  geometry.setAttribute(
    'aOrbit0',
    new BufferAttribute(new Float32Array(BELT_REGION_POINT_CAPACITY * 4), 4),
  );
  geometry.setAttribute(
    'aOrbit1',
    new BufferAttribute(new Float32Array(BELT_REGION_POINT_CAPACITY * 4), 4),
  );
  geometry.setAttribute(
    'aRadiusKm',
    new BufferAttribute(new Float32Array(BELT_REGION_POINT_CAPACITY), 1),
  );
  geometry.setAttribute(
    'aFlags',
    new BufferAttribute(new Float32Array(BELT_REGION_POINT_CAPACITY * 2), 2),
  );
  geometry.setDrawRange(0, 0);

  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uElapsedDays: { value: 0 },
      uKmPerPc: { value: kmPerPc },
      uReachKm: { value: reachKm },
      uHostOffsetKm: { value: new Vector3() },
      uColor: { value: new Color(1, 1, 1) },
    },
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

/** Write one orbit at a base epoch. Returns the next free slot. */
export function writeBeltRegionPoint(
  points: Points,
  slot: number,
  asteroid: Asteroid,
  mu: Mu,
  epochDays: number,
  pseudoLuminosity: number,
  hostRelative: boolean,
  reachLimited: boolean,
): number {
  if (slot >= BELT_REGION_POINT_CAPACITY) return slot;
  const { elements } = asteroid;
  const orbit0 = points.geometry.getAttribute('aOrbit0') as BufferAttribute;
  const orbit1 = points.geometry.getAttribute('aOrbit1') as BufferAttribute;
  const radius = points.geometry.getAttribute('aRadiusKm') as BufferAttribute;
  const flags = points.geometry.getAttribute('aFlags') as BufferAttribute;
  orbit0.setXYZW(
    slot,
    elements.semiMajorAxis / 1000,
    elements.eccentricity,
    elements.inclination,
    elements.longitudeOfAscendingNode,
  );
  orbit1.setXYZW(
    slot,
    elements.argumentOfPeriapsis,
    meanAnomalyAt(elements, mu, seconds(epochDays * DAY)),
    meanMotion(mu, elements.semiMajorAxis) * DAY,
    pseudoLuminosity,
  );
  radius.setX(slot, asteroid.diameterKm / 2);
  flags.setXY(slot, hostRelative ? 1 : 0, reachLimited ? 1 : 0);
  return slot + 1;
}

/** Mark the static orbit attributes dirty after a population rewrite. */
export function finishBeltRegionPoints(points: Points, count: number): void {
  points.geometry.setDrawRange(0, count);
  for (const name of ['aOrbit0', 'aOrbit1', 'aRadiusKm', 'aFlags']) {
    (points.geometry.getAttribute(name) as BufferAttribute).needsUpdate = true;
  }
}

/** Cheap per-frame state: clock and the shared frame transform only. */
export function updateBeltRegionPointFrame(
  points: Points,
  elapsedDays: number,
  focusPositionKm: Vector3,
  hostPositionKm: Vector3,
  frame: Quaternion,
  color: readonly [number, number, number],
): void {
  const material = points.material as ShaderMaterial;
  material.uniforms.uElapsedDays.value = elapsedDays;
  (material.uniforms.uHostOffsetKm.value as Vector3).copy(hostPositionKm);
  (material.uniforms.uColor.value as Color).setRGB(...color);
  points.quaternion.copy(frame);
  points.position.copy(focusPositionKm).negate().applyQuaternion(frame);
}
