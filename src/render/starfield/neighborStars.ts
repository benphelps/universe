import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Points,
  ShaderMaterial,
} from 'three';
import type { Neighborhood } from '../../universe/galaxy/neighborhood';

const VERTEX = /* glsl */ `
attribute vec3 starColor;
attribute float luminosity;
attribute float aRadiusKm;

uniform float uKmPerPc;
uniform float uIntensity;

varying vec3 vColor;
varying float vAlpha;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float distanceKm = max(length(mvPosition.xyz), 1.0);
  float distancePc = max(distanceKm / uKmPerPc, 1e-9);
  // Same photometric mapping as the backdrop's resolved stars, but with
  // apparent brightness from the camera's true distance — the sky at the
  // home viewpoint matches, and flying toward a star brightens it.
  float logE = log2(max(luminosity / (distancePc * distancePc), 1e-12));
  float size = clamp(1.5 + 0.45 * (logE + 17.0), 1.0, 6.5);
  float energy = clamp(0.055 * exp2(0.36 * (logE + 17.0)), 0.012, 1.7) * uIntensity;
  // Once the star's actual disc resolves, the photosphere carries it.
  energy *= 1.0 - smoothstep(0.002, 0.004, aRadiusKm / distanceKm);
  vColor = starColor * energy;
  vAlpha = clamp(energy * 4.0, 0.0, 1.0);
  gl_PointSize = size;
  gl_Position = projectionMatrix * mvPosition;
  // Sky points sit far beyond the camera's far plane at low altitude;
  // clamp depth just inside the range so they draw regardless of it.
  gl_Position.z = min(gl_Position.z, gl_Position.w * 0.999999);
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

/** Photometric star-point material (positions interpreted in km). */
export function createStarPointsMaterial(kmPerPc: number): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { uKmPerPc: { value: kmPerPc }, uIntensity: { value: 1 } },
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}

/**
 * The stellar neighborhood as true 3D points (positions in pc; place
 * inside a pc→km scaled group). At home they reproduce the backdrop's
 * near-field sky exactly; flying out turns the same points into the
 * flyable neighborhood with correct parallax. uIntensity carries the
 * daylight washout.
 */
export function createNeighborStars(hood: Neighborhood, kmPerPc: number): Points {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(hood.positionsPc, 3));
  geometry.setAttribute('starColor', new BufferAttribute(hood.colors, 3));
  geometry.setAttribute('luminosity', new BufferAttribute(hood.luminosities, 1));
  // Inside a pc-scaled group the km-unit material sees km positions.
  const points = new Points(geometry, createStarPointsMaterial(kmPerPc));
  points.frustumCulled = false;
  points.renderOrder = -2;
  return points;
}
