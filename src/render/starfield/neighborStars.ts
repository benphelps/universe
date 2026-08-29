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
uniform float uZeroPoint;
uniform float uSizeScale;

varying vec3 vColor;
varying float vAlpha;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float distanceKm = max(length(mvPosition.xyz), 1.0);
  float distancePc = max(distanceKm / uKmPerPc, 1e-9);
  // Same photometric mapping as the backdrop's resolved stars, but with
  // apparent brightness from the camera's true distance — the sky at the
  // home viewpoint matches, and flying toward a star brightens it.
  // The zero point is where this population sits against the size and
  // energy ceilings. A night sky seen from a planet is calibrated by
  // the default; a swarm the camera stands inside is not, and left on
  // that zero point every one of its stars pins to the largest dot the
  // material draws — which reads as a field of blurred blobs rather
  // than as stars of different brightness.
  float logE = log2(max(luminosity / (distancePc * distancePc), 1e-12)) + uZeroPoint;
  float size = clamp(1.5 + 0.45 * logE, 1.0, 6.5);
  // Sprite sizes are in pixels, so the same star drawn into a coarser
  // buffer covers a wider angle. Rendering into one — the black hole's
  // sky capture — scales them back, or every star read out of it comes
  // back fatter than the one beside it drawn straight to the screen.
  // But a sprite's light is its area times its per-pixel energy, so
  // giving up the area would give up the light with it and hand back a
  // sky dimmer than the one it stands for. The area lost is returned to
  // the energy, and the star keeps its brightness at its true size.
  float drawn = max(size * uSizeScale, 1.0);
  float restored = (size * size) / (drawn * drawn);
  float energy = clamp(0.055 * exp2(0.36 * logE), 0.012, 1.7) * uIntensity * restored;
  // Once the star's actual disc resolves, the photosphere carries it.
  energy *= 1.0 - smoothstep(0.002, 0.004, aRadiusKm / distanceKm);
  vColor = starColor * energy;
  vAlpha = clamp(energy * 4.0, 0.0, 1.0);
  gl_PointSize = drawn;
  gl_Position = projectionMatrix * mvPosition;
  // Sky points sit far beyond the camera's far plane at low altitude,
  // and the far plane cuts on view depth — a camera-rotation-dependent
  // filter that has no business editing the sky. Under the reversed-Z
  // pipeline the far plane lives at z = 0 (near at z = w): pin depth
  // just inside both, so every star draws at its honest direction.
  // The floor must undercut every real body's depth (~near/distance —
  // from a surface, near is metres and a parent planet reaches ~1e-11)
  // or the sky wins the reversed GEQUAL test and shines through it;
  // 1e-24 is beyond any body yet still beats the far-plane clear at 0.
  gl_Position.z = clamp(gl_Position.z, 1e-24 * gl_Position.w, gl_Position.w);
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

/** Photometric star-point material (positions interpreted in km). The
 *  zero point sets where the population lands against the ceilings. */
export function createStarPointsMaterial(kmPerPc: number, zeroPoint = 17): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uKmPerPc: { value: kmPerPc },
      uIntensity: { value: 1 },
      uZeroPoint: { value: zeroPoint },
      uSizeScale: { value: 1 },
    },
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
