import { Color, Mesh, ShaderMaterial, SphereGeometry } from 'three';

const VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewPos;

void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewPos;

uniform vec3 uColor;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uFogColor;
uniform float uFogDensity;

void main() {
  vec3 normal = normalize(vNormal);
  float diffuse = max(dot(normal, uLightDir), 0.0);

  vec3 viewDir = normalize(-vViewPos);
  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 4.0);
  vec3 halfDir = normalize(uLightDir + viewDir);
  float specular = pow(max(dot(normal, halfDir), 0.0), 220.0);

  vec3 color = uColor * uLightColor * (diffuse + 0.02)
    + uLightColor * (fresnel * 0.25 * diffuse + specular * diffuse);

  float fog = 1.0 - exp(-length(vViewPos) * uFogDensity);
  gl_FragColor = vec4(mix(color, uFogColor, fog), 1.0);
}
`;

/**
 * The sea surface: a smooth sphere at sea level, fresnel-brightened at
 * grazing angles with a sun glint, sharing the terrain's aerial fog.
 * Light direction arrives in view space, like the terrain material.
 */
export function createOceanSphere(
  radiusKm: number,
  oceanColor: [number, number, number],
): Mesh {
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uColor: { value: new Color(...oceanColor) },
      uLightDir: { value: [0, 0, 1] },
      uLightColor: { value: new Color(1, 1, 1) },
      uFogColor: { value: new Color(0, 0, 0) },
      uFogDensity: { value: 0 },
    },
  });
  return new Mesh(new SphereGeometry(radiusKm, 256, 128), material);
}
