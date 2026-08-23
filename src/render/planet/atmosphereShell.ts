import { AdditiveBlending, Color, Mesh, ShaderMaterial, SphereGeometry } from 'three';
import type { Planet } from '../../universe/system/types';

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
uniform float uStrength;

void main() {
  vec3 normal = normalize(vWorldNormal);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  // Bright at the limb where the slant path through gas is longest.
  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.2);
  // Scattering needs sunlight: fade across the terminator, tint by the star.
  float day = clamp(dot(normal, uLightDir) * 0.8 + 0.25, 0.0, 1.0);
  gl_FragColor = vec4(uColor * uLightColor * fresnel * day * uStrength, 1.0);
}
`;

/**
 * Single-pass scattering limb: a slightly inflated additive shell whose
 * thickness follows the scale height. Ground-level sky rendering arrives
 * with the surface milestone.
 */
export function createAtmosphereShell(planet: Planet, planetRadiusUnits: number): Mesh | null {
  const { atmosphere, bulk } = planet.physical;
  if (atmosphere.class === 'none') return null;

  const relativeHeight = Math.min(0.12, Math.max(0.015, (8 * atmosphere.scaleHeightKm) / (bulk.radiusEarth * 6371)));
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uColor: { value: atmosphere.scatteringColor },
      uLightDir: { value: [0, 0, 1] },
      uLightColor: { value: new Color(1, 1, 1) },
      uStrength: {
        value: 1.2 * Math.min(1, atmosphere.surfacePressureBar ** 0.4 || 0.3),
      },
    },
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new Mesh(new SphereGeometry(1, 64, 32), material);
  mesh.scale.setScalar(planetRadiusUnits * (1 + relativeHeight));
  return mesh;
}
