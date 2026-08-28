import { Color, DoubleSide, Mesh, RingGeometry, ShaderMaterial, Vector2, Vector4 } from 'three';
import { secondSunUniforms } from '../lighting/secondSun';
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
uniform vec3 uLight2Dir;
uniform vec3 uLight2Color;
uniform float uOpticalDepth;
uniform float uForwardScatter;

${SIMPLEX_NOISE_GLSL}
${SHADOW_GLSL}

// One light's contribution to the slab. The unlit face keeps only
// what leaks through — dense ringlets go dark while gaps and dusty
// wisps stay luminous — with a floor for interparticle scatter.
float slabShade(vec3 nView, vec3 lightDir, float density) {
  float sunMu = max(abs(dot(nView, lightDir)), 0.05);
  float shade = pow(sunMu, 0.6) * 0.7 + 0.22;
  float through = exp(-uOpticalDepth * density / sunMu);
  float unlit = smoothstep(0.0, 0.12, -dot(nView, lightDir));
  return shade * mix(1.0, 0.25 + 0.75 * through, unlit);
}

void main() {
  float r = length(vObjPos.xy);
  float rNorm = (r - uRingShadow.x) / (uRingShadow.y - uRingShadow.x);
  float density = ringDensity(r, fwidth(r));

  // Sub-ringlet streaks carry the structure down to close approach,
  // Nyquist-gated like the shared octaves.
  float wNorm = fwidth(rNorm);
  float streakGate = 1.0 - smoothstep(0.25, 0.5, wNorm * 240.0);
  if (streakGate > 0.01) {
    float streak = snoise(vec3(rNorm * 240.0, uRingSeed + 4.0, 0.0))
      + 0.6 * snoise(vec3(rNorm * 610.0, uRingSeed + 7.0, 0.0));
    density = max(density * (1.0 + 0.3 * streakGate * streak), 0.0);
  }

  vec3 normal = normalize(vWorldNormal);
  vec3 viewToFrag = normalize(vWorldPos - cameraPosition);
  vec3 nView = dot(normal, viewToFrag) < 0.0 ? normal : -normal;

  // The slab is metres thin but not empty: a grazing sightline runs a
  // long path through it, so toward edge-on the band solidifies into
  // the bright hairline instead of fading away. The face-on floor is
  // the legibility lift (belt-glint marker-floor convention) so thin
  // dusty rings still read as a faint band.
  float muView = max(abs(dot(viewToFrag, normal)), 0.02);
  float alpha = max(
    clamp(density * min(1.0, pow(uOpticalDepth, 0.45) * 1.7), 0.0, 1.0),
    1.0 - exp(-uOpticalDepth * density / muView)
  );

  // Fine-particle forward scattering when backlit.
  float forward = pow(max(dot(viewToFrag, uLightDir), 0.0), 8.0) * uForwardScatter;
  float forward2 = pow(max(dot(viewToFrag, uLight2Dir), 0.0), 8.0) * uForwardScatter;

  float shadow = shadowFactor(vWorldPos, uLightDir);
  float shadow2 = shadowFactor(vWorldPos, uLight2Dir);
  vec3 color = uHue
    * (uLightColor * (slabShade(nView, uLightDir, density) * shadow
        + forward * (0.3 + 0.7 * shadow))
      + uLight2Color * (slabShade(nView, uLight2Dir, density) * shadow2
        + forward2 * (0.3 + 0.7 * shadow2)));
  gl_FragColor = vec4(color, alpha);
}
`;

/** The seeded radial pattern is shared with the shadow band the rings
 *  cast on the planet, so gaps line up with their bright lanes. */
export function ringPatternSeed(rings: RingSystem): number {
  return (rings.innerPlanetRadii * 137.3) % 100;
}

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
      ...secondSunUniforms(),
      // Gate at 0 — the ring plane never bands itself; the xy bounds
      // and gaps still feed ringDensity, in object-local units.
      uRingShadow: { value: new Vector4(inner, outer, rings.opticalDepth, 0) },
      uOpticalDepth: { value: rings.opticalDepth },
      uForwardScatter: { value: rings.forwardScatter },
      uRingSeed: { value: ringPatternSeed(rings) },
      uRingGapCount: { value: gaps.length },
      uRingGaps: { value: gapsData },
    },
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
  });

  return new Mesh(new RingGeometry(inner, outer, 256, 8), material);
}
