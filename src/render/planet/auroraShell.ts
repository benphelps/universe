import {
  AdditiveBlending,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector4,
} from 'three';
import type { Circulation } from '../../universe/planet/circulation';
import type { Characterization } from '../../universe/planet/types';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';
import { planetSeedOffset } from './solidPlanetMaterial';

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

uniform vec3 uLightDir;
uniform vec3 uSeedOffset;
uniform float uTimeDays;
uniform vec4 uAurora;                   // strength, tiltRad, azimuthRad, ovalColat
uniform float uLayerFade;

${SIMPLEX_NOISE_GLSL}

void main() {
  vec3 p = normalize(vObjPos);
  vec3 mAxis = vec3(
    sin(uAurora.y) * cos(uAurora.z),
    cos(uAurora.y),
    sin(uAurora.y) * sin(uAurora.z)
  );
  vec3 m1 = normalize(cross(mAxis, vec3(0.0, 0.0, 1.0)));
  vec3 m2 = cross(mAxis, m1);
  float mDot = dot(p, mAxis);
  float mColat = acos(clamp(abs(mDot), 0.0, 1.0));
  float mLon = atan(dot(p, m2), dot(p, m1)) * sign(mDot + 1e-6);
  float core = exp(-pow((mColat - uAurora.w) / 0.018, 2.0));
  float glow = 0.2 * exp(-pow((mColat - uAurora.w) / 0.068, 2.0));
  float rays = 0.4
    + 0.6 * pow(0.5 + 0.5 * snoise(vec3(cos(mLon), sin(mLon), mColat * 4.0) * 11.0
        + uSeedOffset + vec3(0.0, 0.0, uTimeDays * 1.7)), 2.0);
  rays *= 0.55 + 0.45 * snoise(vec3(cos(mLon), sin(mLon), 2.6) * 33.0
    - uSeedOffset.yzx + vec3(uTimeDays * 2.3, 0.0, 0.0));
  float footprint = length(fwidth(p));
  float microGate = 1.0 - smoothstep(0.00015, 0.0012, footprint);
  if (microGate > 0.01) {
    rays *= 1.0 + 0.5 * microGate
      * snoise(vec3(cos(mLon), sin(mLon), mColat * 9.0) * 90.0 + uSeedOffset.zxy
          + vec3(0.0, uTimeDays * 3.1, 0.0));
  }
  vec3 normal = normalize(vWorldNormal);
  float ndotl = dot(normal, uLightDir);
  float night = 1.0 - smoothstep(-0.05, 0.25, ndotl);
  // A curtain is a long emitting path at the limb, but a short, faint
  // path when viewed face-on. Keeping that geometry in the brightness
  // stops the oval from painting an opaque donut over the polar weather.
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float faceOn = abs(dot(normal, viewDir));
  float curtainPath = 0.008 + 0.992 * pow(1.0 - faceOn, 1.7);
  vec3 color = vec3(0.5, 0.32, 0.85) * (core * rays + glow * (0.5 + 0.5 * rays))
    * uAurora.x * uLayerFade * (0.05 + 0.75 * night) * curtainPath;
  gl_FragColor = vec4(color, 1.0);
}
`;

// Emission altitudes above the 1-bar deck (Jupiter's main oval sits a
// few hundred km up, with rays reaching beyond 1000 km); the floors
// keep that standoff resolvable at planet-view scale on the largest
// giants, the cap keeps it from ballooning on the smallest.
const LAYERS = [
  { altitudeKm: 400, floor: 0.008, fade: 1.0 },
  { altitudeKm: 1600, floor: 0.024, fade: 0.4 },
];

/**
 * Auroral curtains as concentric emission shells in the thermosphere,
 * co-rotating with the body (children of its mesh, so they inherit
 * spin and oblateness). Two layers give the curtain vertical extent:
 * the rays share noise phase, so the limb reads them as one sheet
 * standing off the deck. Eclipse shadows are skipped on purpose —
 * the emission is the planet's own.
 */
export function createAuroraShells(
  physical: Characterization,
  circulation: Circulation,
): Mesh[] {
  if (circulation.auroraStrength <= 0) return [];
  const radiusKm = physical.bulk.radiusEarth * 6371;
  return LAYERS.map((layer) => {
    const material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uLightDir: { value: [0, 0, 1] },
        uSeedOffset: { value: planetSeedOffset(physical.seedHex) },
        uTimeDays: { value: 0 },
        uAurora: {
          value: new Vector4(
            circulation.auroraStrength,
            circulation.auroraTiltRad,
            circulation.auroraAzimuthRad,
            0.3,
          ),
        },
        uLayerFade: { value: layer.fade },
      },
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    const mesh = new Mesh(new SphereGeometry(1, 96, 64), material);
    // The sliver past the limb stands against open sky: after the
    // composite and the rings (reversed-Z: lowest order last), so
    // neither a rift behind nor a ring behind shows through it.
    mesh.renderOrder = -2.15;
    mesh.scale.setScalar(1 + Math.min(0.06, Math.max(layer.floor, layer.altitudeKm / radiusKm)));
    return mesh;
  });
}
