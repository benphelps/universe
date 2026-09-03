import { AdditiveBlending, BackSide, Color, Mesh, ShaderMaterial, SphereGeometry } from 'three';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';
import { secondSunUniforms } from '../lighting/secondSun';
import { SURFACE_LIGHT_GLSL, surfaceLightUniforms } from '../lighting/surfaceLight';
import { createShadowUniforms, SHADOW_GLSL } from '../planet/shadows';

const VERTEX = /* glsl */ `
varying vec3 vDir;

void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vDir;

uniform vec3 uLightColor;
uniform vec3 uSunDir;
uniform vec3 uLight2Dir;
uniform vec3 uLight2Color;
uniform vec3 uUp;
uniform float uColumnFraction;          // of the surface column, above the eye
uniform vec2 uColumn;                   // scale height km, √(H/2R)

${SIMPLEX_NOISE_GLSL}
${SHADOW_GLSL}
${SURFACE_LIGHT_GLSL}

// One light's share of the sky along this sightline: sunlight singly
// scattered by the column, in the same units as the ground it lights
// (a white Lambertian ground under the beam is one). The beam is
// extinguished on its way down to each parcel and the scattered light
// on its way out to the eye, which the closed form of the integral
// carries exactly: ∫ e^{-(τv-t)·Xs/Xv} e^{-t} dt over the view depth.
// Rayleigh's phase puts twice the light forward and back as sideways;
// after sunset the lit column's fraction is the same twilight the
// ground sees. τ = 0 is a vacuum: the sky is black.
vec3 scattered(vec3 dir, vec3 tau, float xv, vec3 lightDir, vec3 lightColor) {
  float mus = dot(lightDir, uUp);
  float xs = airmass(mus);
  vec3 tv = tau * xv;
  vec3 ts = tau * xs;
  float den = xs - xv;
  vec3 integral = abs(den) > 1e-3
    ? xv * (exp(-tv) - exp(-ts)) / den
    : tv * exp(-tv);
  return lightColor * phaseWeight(dot(dir, lightDir)) * max(integral, vec3(0.0)) * twilight(mus);
}

void main() {
  // The dome is coarse and the aureole is sharp: an interpolated
  // direction shortens toward each triangle's middle and the peak
  // facets into a diamond unless the direction is renormalized here.
  vec3 dir = normalize(vDir);
  float elevation = dot(dir, uUp);
  vec3 tau = uOpticalDepth * uColumnFraction;
  float xv = airmass(elevation);
  // The air that scatters along this sightline sits about a scale
  // height up overhead and out at the horizon column near the limb;
  // an eclipse shadows the sky where that air stands, so the umbra
  // darkens the zenith while the horizon keeps the light from beyond
  // the shadow — the twilight ring of totality.
  float reach = uColumn.x / (max(elevation, 0.0) + uColumn.y);
  vec3 air = cameraPosition + dir * reach;
  // Scattering adds light; it never occludes, so the sun's disc (and
  // anything else bright enough) blazes through the daytime sky.
  vec3 sky = scattered(dir, tau, xv, uSunDir, uLightColor)
      * shadowFactor(air, uSunDir, uStarAngularRadius, 1e30)
    + scattered(dir, tau, xv, uLight2Dir, uLight2Color)
      * shadowFactor(air, uLight2Dir, uStar2AngularRadius, uLight2Reach);
  gl_FragColor = vec4(sky, 1.0);
}
`;

/**
 * Ground-level sky: a camera-centered dome whose light is the same
 * column the ground stands under, singly scattering each sun — blue
 * from a clear Rayleigh column, red toward a setting sun, black in a
 * vacuum — thinning with the eye's altitude into space, and shadowed
 * where the air it stands for is eclipsed. The column itself is seated
 * by the viewer with the rest of the ground materials.
 */
export function createSkyDome(radiusKm: number, scaleHeightKm: number): Mesh {
  const h = Math.max(scaleHeightKm, 0.1);
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...createShadowUniforms(),
      ...surfaceLightUniforms(),
      uColumn: { value: [h, Math.sqrt(h / (2 * Math.max(radiusKm, 1)))] },
      uColumnFraction: { value: 1 },
      uLightColor: { value: new Color(1, 1, 1) },
      ...secondSunUniforms(),
      uSunDir: { value: [0, 0, 1] },
      uUp: { value: [0, 1, 0] },
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
