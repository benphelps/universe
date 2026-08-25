import { Color, DoubleSide, Mesh, RingGeometry, ShaderMaterial, Vector2 } from 'three';
import type { RingSystem } from '../../universe/rings/types';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';
import { createShadowUniforms, SHADOW_GLSL } from './shadows';

const VERTEX = /* glsl */ `
varying vec3 vObjPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vObjPos = position;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vObjPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

uniform vec3 uHue;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform float uInner;
uniform float uOuter;
uniform float uOpticalDepth;
uniform float uForwardScatter;
uniform float uSeed;
uniform int uGapCount;
uniform vec2 uGapsData[6];

${SIMPLEX_NOISE_GLSL}
${SHADOW_GLSL}

void main() {
  float r = length(vObjPos.xy);
  float rNorm = (r - uInner) / (uOuter - uInner);

  // Radial ringlet structure at two scales.
  float structure = 0.6
    + 0.3 * snoise(vec3(rNorm * 22.0, uSeed, 0.0))
    + 0.2 * snoise(vec3(rNorm * 71.0, uSeed + 9.0, 0.0));
  float density = clamp(structure, 0.05, 1.2);

  // Resonance gaps carved by moons.
  for (int i = 0; i < 6; i++) {
    if (i >= uGapCount) break;
    float d = abs(r - uGapsData[i].x);
    density *= mix(0.04, 1.0, smoothstep(uGapsData[i].y * 0.5, uGapsData[i].y, d));
  }

  // Soft inner/outer edges.
  density *= smoothstep(0.0, 0.06, rNorm) * (1.0 - smoothstep(0.92, 1.0, rNorm));

  // Legibility lift above strict photometry: optical depth enters on a
  // compressive curve and the slab keeps a soft floor, so thin dusty
  // rings read as a faint band instead of vanishing (the belt-glint
  // marker-floor convention); dense icy rings are barely affected.
  float alpha = clamp(density * min(1.0, pow(uOpticalDepth, 0.45) * 1.7), 0.0, 1.0);

  // Thin-slab illumination plus fine-particle forward scattering when backlit.
  vec3 normal = normalize(vWorldNormal);
  float slab = pow(abs(dot(normal, uLightDir)), 0.6) * 0.7 + 0.22;
  vec3 viewToFrag = normalize(vWorldPos - cameraPosition);
  float forward = pow(max(dot(viewToFrag, uLightDir), 0.0), 8.0) * uForwardScatter;

  float shadow = shadowFactor(vWorldPos, uLightDir);
  vec3 color = uHue * uLightColor * (slab * shadow + forward * (0.3 + 0.7 * shadow));
  gl_FragColor = vec4(color, alpha);
}
`;

/** Ring mesh in scene units, lying in the local XY plane (rotate into place). */
export function createRingMesh(rings: RingSystem, planetRadiusUnits: number): Mesh {
  const inner = rings.innerPlanetRadii * planetRadiusUnits;
  const outer = rings.outerPlanetRadii * planetRadiusUnits;
  const gaps = rings.gaps.slice(0, 6);
  const gapsData = Array.from({ length: 6 }, (_, i) =>
    i < gaps.length
      ? new Vector2(gaps[i].radiusPlanetRadii * planetRadiusUnits, gaps[i].widthPlanetRadii * planetRadiusUnits)
      : new Vector2(0, 0),
  );

  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...createShadowUniforms(),
      uHue: { value: new Color(...rings.hue) },
      uLightDir: { value: [0, 0, 1] },
      uLightColor: { value: new Color(1, 1, 1) },
      uInner: { value: inner },
      uOuter: { value: outer },
      uOpticalDepth: { value: rings.opticalDepth },
      uForwardScatter: { value: rings.forwardScatter },
      uSeed: { value: (rings.innerPlanetRadii * 137.3) % 100 },
      uGapCount: { value: gaps.length },
      uGapsData: { value: gapsData },
    },
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
  });

  return new Mesh(new RingGeometry(inner, outer, 256, 8), material);
}
