import { AdditiveBlending, BackSide, Color, Mesh, ShaderMaterial, SphereGeometry } from 'three';
import { secondSunUniforms } from '../lighting/secondSun';

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
uniform vec3 uLight2Dir;
uniform vec3 uLight2Color;
uniform vec3 uUp;
uniform float uStrength;

// One light's share of the sky: tinted scattering shaped by the slant
// path, a warm forward glow about the light itself, the whole term
// weighted by that light's own elevation. Scattering is linear in
// illumination, so each light carries its own weight — gating the
// companion's share by the primary's elevation left a moonlit or
// companion-lit night scattering nothing at all.
vec3 scattered(vec3 lightDir, vec3 lightColor, float shape, float lift) {
  float day = clamp(dot(lightDir, uUp) * 2.5 + 0.15, 0.0, 1.0);
  float glow = pow(max(dot(vDir, lightDir), 0.0), 9.0);
  return (uSkyColor * lightColor * day * shape + lightColor * glow * day * 0.55)
    * clamp(uStrength * (day * lift + glow * 0.4), 0.0, 1.0);
}

void main() {
  float elevation = dot(vDir, uUp);
  // Denser slant path near the horizon.
  float shape = 0.35 + 0.65 * pow(1.0 - clamp(elevation, 0.0, 1.0), 1.6);
  float lift = clamp(elevation + 0.4, 0.0, 1.0);
  // Scattering adds light; it never occludes, so the sun's disc (and
  // anything else bright enough) blazes through the daytime sky.
  vec3 sky = scattered(uSunDir, uLightColor, shape, lift)
    + scattered(uLight2Dir, uLight2Color, shape, lift);
  gl_FragColor = vec4(sky, 1.0);
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
      ...secondSunUniforms(),
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
  // The air shines in front of everything beyond it, so the dome draws
  // after the sky-layer composite and the star points (reversed-Z:
  // lowest order last). At -1 it tied the composite and lost: a dark
  // cloud's occlusion multiplied the twilight haze away, punching a
  // black patch into an atmosphere that stands between it and the eye.
  // Additive, so its order against the additive stars is indifferent.
  dome.renderOrder = -2.25;
  dome.frustumCulled = false;
  return dome;
}
