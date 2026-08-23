import { AdditiveBlending, ShaderMaterial } from 'three';
import type { Star } from '../../universe/star/types';
import { SIMPLEX_NOISE_GLSL } from './glsl/simplexNoise';

const VERTEX = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
varying vec2 vUv;

uniform vec3 uColor;
uniform float uTimeDays;
uniform float uDiscRadius;
uniform float uIntensity;

${SIMPLEX_NOISE_GLSL}

void main() {
  vec2 c = vUv * 2.0 - 1.0;
  float r = length(c);
  float angle = atan(c.y, c.x);

  // Radial streamers: angular noise drifting slowly with time.
  vec3 dir = vec3(cos(angle), sin(angle), 0.0);
  float streak = fbm(dir * 2.5 + vec3(0.0, 0.0, uTimeDays * 0.08) + r * 0.8);
  float falloff = pow(uDiscRadius / max(r, uDiscRadius), 3.2);

  float glow = falloff * (0.55 + 0.45 * streak);
  // Fade inside the disc (occluded by the photosphere) and at the plane edge.
  glow *= smoothstep(uDiscRadius * 0.85, uDiscRadius * 1.02, r);
  glow *= smoothstep(0.9, 0.5, r);

  gl_FragColor = vec4(uColor * glow * uIntensity, 1.0);
}
`;

/** Corona hue: photosphere color washed toward white (scattered, hotter plasma). */
export function createCoronaMaterial(star: Star): ShaderMaterial {
  const [r, g, b] = star.linearRgb;
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uColor: { value: [r * 0.5 + 0.5, g * 0.5 + 0.5, b * 0.5 + 0.5] },
      uTimeDays: { value: 0 },
      uDiscRadius: { value: 0.25 },
      uIntensity: { value: 0.35 },
    },
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}
