import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  Data3DTexture,
  GLSL3,
  LinearFilter,
  Matrix3,
  Points,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
} from 'three';
import { DUST_OPACITY_PER_PC } from '../../universe/galaxy/density';
import type { Neighborhood } from '../../universe/galaxy/neighborhood';

/**
 * A resident nebula extinguishes the star field behind it.
 *
 * No depth buffer can do this: star points are additive and write no
 * depth, so nothing downstream knows whether a star is in front of a
 * cloud, inside it, or behind. Each star marches the volume itself,
 * over the stretch of its own sightline that falls inside the box —
 * twelve steps for a point, which is nothing, and it is the thing that
 * makes a cloud read as an object with space in front of and behind it
 * rather than a picture hung in the sky.
 *
 * The uniform objects are shared by every star material, so a volume
 * arriving or leaving is one assignment rather than a search for
 * everything that draws a star.
 */
const NO_VOLUME = new Data3DTexture(new Uint8Array(4), 1, 1, 1);
NO_VOLUME.format = RGBAFormat;
NO_VOLUME.type = UnsignedByteType;
NO_VOLUME.minFilter = LinearFilter;
NO_VOLUME.magFilter = LinearFilter;
NO_VOLUME.wrapS = ClampToEdgeWrapping;
NO_VOLUME.wrapT = ClampToEdgeWrapping;
NO_VOLUME.wrapR = ClampToEdgeWrapping;
NO_VOLUME.needsUpdate = true;

const nebulaUniforms = {
  uNebulaVolume: { value: NO_VOLUME },
  /** Box half-extent, pc; zero means no volume is standing. */
  uNebulaHalfPc: { value: 0 },
  uNebulaCentrePc: { value: new Vector3() },
  uNebulaCamPc: { value: new Vector3() },
  /** Camera space → the galaxy's own axes. */
  uCameraToGalaxy: { value: new Matrix3() },
  uNebulaDustRef: { value: 1 },
};

export interface StarNebulaExtinction {
  volume: Data3DTexture;
  halfPc: number;
  centrePc: Vector3;
  camPc: Vector3;
  cameraToGalaxy: Matrix3;
  dustRef: number;
}

/** Point every star material at the volume now standing, or at none. */
export function setStarNebulaExtinction(extinction: StarNebulaExtinction | null): void {
  if (!extinction) {
    nebulaUniforms.uNebulaVolume.value = NO_VOLUME;
    nebulaUniforms.uNebulaHalfPc.value = 0;
    return;
  }
  nebulaUniforms.uNebulaVolume.value = extinction.volume;
  nebulaUniforms.uNebulaHalfPc.value = extinction.halfPc;
  nebulaUniforms.uNebulaCentrePc.value.copy(extinction.centrePc);
  nebulaUniforms.uNebulaCamPc.value.copy(extinction.camPc);
  nebulaUniforms.uCameraToGalaxy.value.copy(extinction.cameraToGalaxy);
  nebulaUniforms.uNebulaDustRef.value = extinction.dustRef;
}

const VERTEX = /* glsl */ `
in vec3 starColor;
in float luminosity;
in float aRadiusKm;

uniform float uKmPerPc;
uniform float uIntensity;
uniform float uZeroPoint;
uniform float uSizeScale;
uniform sampler3D uNebulaVolume;
uniform float uNebulaHalfPc;
uniform vec3 uNebulaCentrePc;
uniform vec3 uNebulaCamPc;
uniform mat3 uCameraToGalaxy;
uniform float uNebulaDustRef;

out vec3 vColor;
out float vAlpha;

/**
 * Visual optical depth of the resident cloud over the stretch of this
 * star's sightline that runs inside it. Zero for a star in front of the
 * cloud, partial for one embedded in it, the whole column for one
 * behind — which is the distinction a depth test cannot make here.
 */
float nebulaOpticalDepth(vec3 relPc) {
  if (uNebulaHalfPc <= 0.0) return 0.0;
  vec3 origin = uNebulaCamPc - uNebulaCentrePc;
  float reach = length(relPc);
  if (reach < 1e-6) return 0.0;
  vec3 dir = relPc / reach;
  vec3 inv = 1.0 / dir;
  vec3 a = (vec3(-uNebulaHalfPc) - origin) * inv;
  vec3 b = (vec3(uNebulaHalfPc) - origin) * inv;
  vec3 lo = min(a, b);
  vec3 hi = max(a, b);
  float near = max(max(lo.x, lo.y), max(lo.z, 0.0));
  float far = min(min(hi.x, hi.y), min(hi.z, reach));
  if (far <= near) return 0.0;
  float ds = (far - near) / 12.0;
  float tau = 0.0;
  for (int i = 0; i < 12; i++) {
    vec3 p = origin + dir * (near + (float(i) + 0.5) * ds);
    tau += texture(uNebulaVolume, p / (2.0 * uNebulaHalfPc) + 0.5).r;
  }
  return tau * uNebulaDustRef * ${DUST_OPACITY_PER_PC.toFixed(4)} * ds;
}

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float distanceKm = max(length(mvPosition.xyz), 1.0);
  float distancePc = max(distanceKm / uKmPerPc, 1e-9);
  // Same photometric mapping as the backdrop's resolved stars, but with
  // apparent brightness from the camera's true distance — the sky at the
  // home viewpoint matches, and flying toward a star brightens it.
  // The zero point is where this population sits against the size and
  // energy ceilings. A night sky seen from a planet is calibrated by
  // the default; a swarm the camera stands inside is not, and left on
  // that zero point every one of its stars pins to the largest dot the
  // material draws — which reads as a field of blurred blobs rather
  // than as stars of different brightness.
  float logE = log2(max(luminosity / (distancePc * distancePc), 1e-12)) + uZeroPoint;
  float size = clamp(1.5 + 0.45 * logE, 1.0, 6.5);
  // Sprite sizes are in pixels, so the same star drawn into a coarser
  // buffer covers a wider angle. Rendering into one — the black hole's
  // sky capture — scales them back, or every star read out of it comes
  // back fatter than the one beside it drawn straight to the screen.
  // But a sprite's light is its area times its per-pixel energy, so
  // giving up the area would give up the light with it and hand back a
  // sky dimmer than the one it stands for. The area lost is returned to
  // the energy, and the star keeps its brightness at its true size.
  float drawn = max(size * uSizeScale, 1.0);
  float restored = (size * size) / (drawn * drawn);
  float energy = clamp(0.055 * exp2(0.36 * logE), 0.012, 1.7) * uIntensity * restored;
  // Once the star's actual disc resolves, the photosphere carries it.
  energy *= 1.0 - smoothstep(0.002, 0.004, aRadiusKm / distanceKm);
  // Dust reddens as it dims: the blue band loses about a third more
  // than the visual, the red band a quarter less (R_V = 3.1), which is
  // why a star behind a cloud goes red before it goes out.
  vec3 relPc = (uCameraToGalaxy * mvPosition.xyz) / uKmPerPc;
  float tauV = nebulaOpticalDepth(relPc);
  vec3 extinction = exp(-tauV * vec3(0.748, 1.0, 1.324));
  vColor = starColor * energy * extinction;
  vAlpha = clamp(energy * 4.0, 0.0, 1.0);
  gl_PointSize = drawn;
  gl_Position = projectionMatrix * mvPosition;
  // Sky points sit far beyond the camera's far plane at low altitude,
  // and the far plane cuts on view depth — a camera-rotation-dependent
  // filter that has no business editing the sky. Under the reversed-Z
  // pipeline the far plane lives at z = 0 (near at z = w): pin depth
  // just inside both, so every star draws at its honest direction.
  // The floor must undercut every real body's depth (~near/distance —
  // from a surface, near is metres and a parent planet reaches ~1e-11)
  // or the sky wins the reversed GEQUAL test and shines through it;
  // 1e-24 is beyond any body yet still beats the far-plane clear at 0.
  gl_Position.z = clamp(gl_Position.z, 1e-24 * gl_Position.w, gl_Position.w);
}
`;

const FRAGMENT = /* glsl */ `
// GLSL 3, for the sampler3D the extinction march reads: a raw shader
// declares its own varyings and its own output.
in vec3 vColor;
in float vAlpha;
out vec4 fragColor;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float falloff = 1.0 - smoothstep(0.25, 1.0, length(c));
  fragColor = vec4(vColor * falloff * vAlpha, 1.0);
}
`;

/** Photometric star-point material (positions interpreted in km). The
 *  zero point sets where the population lands against the ceilings. */
export function createStarPointsMaterial(kmPerPc: number, zeroPoint = 17): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uKmPerPc: { value: kmPerPc },
      uIntensity: { value: 1 },
      uZeroPoint: { value: zeroPoint },
      uSizeScale: { value: 1 },
      ...nebulaUniforms,
    },
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}

/**
 * The stellar neighborhood as true 3D points (positions in pc; place
 * inside a pc→km scaled group). At home they reproduce the backdrop's
 * near-field sky exactly; flying out turns the same points into the
 * flyable neighborhood with correct parallax. uIntensity carries the
 * daylight washout.
 */
export function createNeighborStars(hood: Neighborhood, kmPerPc: number): Points {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(hood.positionsPc, 3));
  geometry.setAttribute('starColor', new BufferAttribute(hood.colors, 3));
  geometry.setAttribute('luminosity', new BufferAttribute(hood.luminosities, 1));
  // Inside a pc-scaled group the km-unit material sees km positions.
  const points = new Points(geometry, createStarPointsMaterial(kmPerPc));
  points.frustumCulled = false;
  points.renderOrder = -2;
  return points;
}
