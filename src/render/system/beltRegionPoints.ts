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
import { AIR_VIEW_GLSL, airViewUniforms } from '../lighting/airView';
import { REFLECTED_GLINT_GLSL } from '../lighting/reflectedGlint';
import { BELT_LOD_GLSL } from './beltLod';

const VERTEX = /* glsl */ `
attribute vec4 aOrbit0; // semi-major axis km, eccentricity, inclination, ascending node
attribute vec4 aOrbit1; // periapsis argument, base mean anomaly, rad/day, pseudo-luminosity
attribute float aRadiusKm;
attribute float aMeshReady;
attribute float aVisible;
attribute vec2 aFlags;  // host-relative, reach mode: 1 local / -1 catalogue / 0 unlimited

uniform float uElapsedDays;
uniform float uKmPerPc;
uniform float uReachKm;
uniform vec3 uHostOffsetKm;
uniform vec3 uColor;
uniform float uExposure;

varying vec3 vColor;
varying float vAlpha;
${AIR_VIEW_GLSL}
${REFLECTED_GLINT_GLSL}
${BELT_LOD_GLSL}

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
  vec3 toSun = mat3(modelMatrix) * -localKm;
  localKm += uHostOffsetKm * aFlags.x;

  vec4 mvPosition = modelViewMatrix * vec4(localKm, 1.0);
  vec3 worldPos = (modelMatrix * vec4(localKm, 1.0)).xyz;
  vec3 toEye = cameraPosition - worldPos;
  float distanceKm = max(length(mvPosition.xyz), 1.0);
  float distancePc = max(distanceKm / uKmPerPc, 1e-12);
  // Stored luminosity is at the semi-major axis; use the actual
  // heliocentric distance and illuminated phase at this epoch.
  float luminosity = aOrbit1.w * (a * a / dot(reference, reference))
    * reflectedPhase(toSun, toEye);
  float flux = luminosity / (distancePc * distancePc);
  // The log floor only stabilizes footprint sizing, never adds light.
  float logEnergy = log2(max(flux, 1e-30)) + 17.0;
  float size = clamp(1.5 + 0.45 * logEnergy, 1.0, 6.5);
  float energy = reflectedGlintEnergy(flux);
  vAlpha = clamp(energy * 4.0, 0.0, 1.0);
  // Capacity-limited or notable members retain their glint until a
  // resolved mesh actually exists. Apply the handoff only once.
  if (aFlags.y < -0.5) {
    // Catalogue members yield only where their admitted local point draws.
    if (aMeshReady > 0.5 && distanceKm <= uReachKm) energy = 0.0;
  } else {
    if (aFlags.y > 0.5 && distanceKm > uReachKm) energy = 0.0;
    energy *= 1.0 - aMeshReady * beltMeshWeight(aRadiusKm / distanceKm);
  }
  energy *= aVisible;
  vec3 dir = normalize(-toEye);
  vColor = uColor * energy * uExposure * airTransmittance(dir) * skyVisibility(dir);
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
const resolvedSlots = new WeakMap<Points, readonly number[]>();
const hiddenSlots = new WeakMap<Points, readonly number[]>();

/** Local belt glints whose Kepler propagation runs in the vertex shader. */
export function createBeltRegionPoints(kmPerPc: number, reachKm: number, capacity = BELT_REGION_POINT_CAPACITY): Points {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(capacity * 3), 3),
  );
  geometry.setAttribute(
    'aOrbit0',
    new BufferAttribute(new Float32Array(capacity * 4), 4),
  );
  geometry.setAttribute(
    'aOrbit1',
    new BufferAttribute(new Float32Array(capacity * 4), 4),
  );
  geometry.setAttribute(
    'aRadiusKm',
    new BufferAttribute(new Float32Array(capacity), 1),
  );
  geometry.setAttribute(
    'aMeshReady',
    new BufferAttribute(new Float32Array(capacity), 1),
  );
  geometry.setAttribute(
    'aFlags',
    new BufferAttribute(new Float32Array(capacity * 2), 2),
  );
  geometry.setAttribute('aVisible', new BufferAttribute(new Float32Array(capacity).fill(1), 1));
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
      uExposure: { value: 1 },
      ...airViewUniforms(),
    },
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const points = new Points(geometry, material);
  points.renderOrder = -2;
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
  if (slot >= points.geometry.getAttribute('aOrbit0').count) return slot;
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
  (points.geometry.getAttribute('aMeshReady').array as Float32Array).fill(0);
  resolvedSlots.delete(points);
  (points.geometry.getAttribute('aVisible').array as Float32Array).fill(1);
  hiddenSlots.delete(points);
  for (const name of ['aOrbit0', 'aOrbit1', 'aRadiusKm', 'aFlags', 'aMeshReady', 'aVisible']) {
    (points.geometry.getAttribute(name) as BufferAttribute).needsUpdate = true;
  }
}

/** Upload the 3.6 KiB mask only when mesh admission changes. */
export function setBeltRegionResolvedSlots(points: Points, slots: readonly number[]): void {
  const previous = resolvedSlots.get(points) ?? [];
  if (slots.length === previous.length && slots.every((slot, i) => slot === previous[i])) return;
  const attribute = points.geometry.getAttribute('aMeshReady') as BufferAttribute;
  (attribute.array as Float32Array).fill(0);
  for (const slot of slots) if (slot >= 0 && slot < points.geometry.drawRange.count) attribute.setX(slot, 1);
  attribute.needsUpdate = true;
  resolvedSlots.set(points, [...slots]);
}

/** Focused terrain owns its body; do not draw a second glint. */
export function setBeltRegionHiddenSlots(points: Points, slots: readonly number[]): void {
  const previous = hiddenSlots.get(points) ?? [];
  if (slots.length === previous.length && slots.every((slot, i) => slot === previous[i])) return;
  const attribute = points.geometry.getAttribute('aVisible') as BufferAttribute;
  (attribute.array as Float32Array).fill(1);
  for (const slot of slots) if (slot >= 0 && slot < points.geometry.drawRange.count) attribute.setX(slot, 0);
  attribute.needsUpdate = true;
  hiddenSlots.set(points, [...slots]);
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
