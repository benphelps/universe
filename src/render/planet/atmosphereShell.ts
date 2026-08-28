import { AdditiveBlending, Color, Mesh, ShaderMaterial, SphereGeometry } from 'three';
import { secondSunUniforms } from '../lighting/secondSun';
import type { Characterization } from '../../universe/planet/types';

const VERTEX = /* glsl */ `
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

uniform vec3 uColor;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uLight2Dir;
uniform vec3 uLight2Color;
uniform float uStrength;

void main() {
  vec3 normal = normalize(vWorldNormal);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  // Bright at the limb where the slant path through gas is longest.
  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.2);
  // Scattering needs sunlight: fade across the terminator, tint by the star.
  float day = clamp(dot(normal, uLightDir) * 0.8 + 0.25, 0.0, 1.0);
  // The second light keeps only a sliver of wrap: it is often a
  // display-lifted moon, and the sun's twilight floor would wash the
  // whole night sky with it from inside the shell.
  float day2 = clamp(dot(normal, uLight2Dir) * 0.9 + 0.05, 0.0, 1.0);
  gl_FragColor = vec4(uColor * (uLightColor * day + uLight2Color * day2) * fresnel * uStrength, 1.0);
}
`;

/**
 * Single-pass scattering limb: a slightly inflated additive shell whose
 * thickness follows the scale height. Ground-level sky rendering arrives
 * with the surface milestone.
 */
export function createAtmosphereShell(
  physical: Characterization,
  planetRadiusUnits: number,
): Mesh | null {
  const { atmosphere, bulk } = physical;
  if (atmosphere.class === 'none') return null;

  const relativeHeight = Math.min(0.12, Math.max(0.015, (8 * atmosphere.scaleHeightKm) / (bulk.radiusEarth * 6371)));
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uColor: { value: atmosphere.scatteringColor },
      uLightDir: { value: [0, 0, 1] },
      uLightColor: { value: new Color(1, 1, 1) },
      ...secondSunUniforms(),
      uStrength: {
        value: 1.2 * Math.min(1, atmosphere.surfacePressureBar ** 0.4 || 0.3),
      },
    },
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new Mesh(new SphereGeometry(1, 64, 32), material);
  // The gas follows the rotating body's figure: an oblate planet wears
  // an equally oblate limb, not a spherical halo lifted off its poles.
  const r = planetRadiusUnits * (1 + relativeHeight);
  mesh.scale.set(r, r * (1 - bulk.oblateness), r);
  return mesh;
}
