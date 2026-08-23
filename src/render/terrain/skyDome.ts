import { AdditiveBlending, BackSide, Color, Mesh, ShaderMaterial, SphereGeometry } from 'three';

const VERTEX = /* glsl */ `
varying vec3 vDir;

void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vDir;

uniform vec3 uSkyColor;
uniform vec3 uLightColor;
uniform vec3 uSunDir;
uniform vec3 uUp;
uniform float uStrength;

void main() {
  float elevation = dot(vDir, uUp);
  float sunElevation = clamp(dot(uSunDir, uUp) * 2.5 + 0.15, 0.0, 1.0);

  // Denser slant path near the horizon; warm forward glow around the sun.
  float horizon = pow(1.0 - clamp(elevation, 0.0, 1.0), 1.6);
  float sunGlow = pow(max(dot(vDir, uSunDir), 0.0), 9.0);

  vec3 sky = uSkyColor * uLightColor * sunElevation * (0.35 + 0.65 * horizon);
  sky += uLightColor * sunGlow * sunElevation * 0.55;

  // Scattering adds light; it never occludes, so the sun's disc (and
  // anything else bright enough) blazes through the daytime sky.
  float weight = uStrength * sunElevation * clamp(elevation + 0.4, 0.0, 1.0);
  gl_FragColor = vec4(sky * clamp(weight + uStrength * sunGlow * 0.4, 0.0, 1.0), 1.0);
}
`;

/**
 * Ground-level sky: a camera-centered dome tinted by the atmosphere's
 * scattering color, brightening toward the horizon and around the sun,
 * fading with altitude into black space.
 */
export function createSkyDome(scatteringColor: [number, number, number]): Mesh {
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uSkyColor: { value: new Color(...scatteringColor) },
      uLightColor: { value: new Color(1, 1, 1) },
      uSunDir: { value: [0, 0, 1] },
      uUp: { value: [0, 1, 0] },
      uStrength: { value: 1 },
    },
    side: BackSide,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const dome = new Mesh(new SphereGeometry(600, 48, 24), material);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  return dome;
}
