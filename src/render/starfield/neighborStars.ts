import { GLOBAL_STAR_DUST_GLSL } from '../glsl/globalStarDust';
import { starGlobalDustUniforms, installStarDustCamera } from './globalDustState';
import { LOCAL_CLOUD_RADIUS_PC } from '../../universe/galaxy/globalDust';
import { installPointRaster, pointRasterVertex, pointRasterFragment } from './pointSpread';
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
  Vector4,
} from 'three';
import { DUST_OPACITY_PER_PC } from '../../universe/galaxy/density';
import { SCATTER_OPACITY_RGB } from '../../universe/galaxy/dustScattering';
import type { Neighborhood } from '../../universe/galaxy/neighborhood';
import { fieldPointUniforms } from '../displayTransfer';
import { glslFloat as f } from '../glsl/format';
import { AIR_REFRACT_GLSL, AIR_VIEW_GLSL, airViewUniforms } from '../lighting/airView';
import {
  HORIZON_OCCLUSION_GLSL,
  horizonOcclusionUniforms,
} from '../lighting/horizonOcclusion';

/**
 * A resident nebula extinguishes the star field behind it.
 *
 * No depth buffer can do this: star points are additive and write no
 * depth, so nothing downstream knows whether a star is in front of a
 * cloud, inside it, or behind. Each star marches the volume itself,
 * over the stretch of its own sightline that falls inside the box —
 * twelve steps per intersected volume, bounded to four volumes. This
 * distinguishes foreground, embedded and background stars.
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

/** How many resident volumes a star sightline marches at most —
 *  the shader carries this many sampler slots. */
export const MAX_STAR_NEBULAE = 4;

const nebulaUniforms = {
  uNebulaVolume0: { value: NO_VOLUME },
  uNebulaVolume1: { value: NO_VOLUME },
  uNebulaVolume2: { value: NO_VOLUME },
  uNebulaVolume3: { value: NO_VOLUME },
  /** Per volume: the camera in the box's own frame (xyz, pc) and the
   *  box half-extent (w, pc); zero half means the slot is empty. */
  uNebulaBoxes: { value: [new Vector4(), new Vector4(), new Vector4(), new Vector4()] },
  uNebulaDustRefs: { value: new Float32Array(MAX_STAR_NEBULAE) },
  /** Camera space → the galaxy's own axes. */
  uCameraToGalaxy: { value: new Matrix3() },
};

export interface StarNebulaExtinction {
  volume: Data3DTexture;
  halfPc: number;
  centrePc: Vector3;
  camPc: Vector3;
  cameraToGalaxy: Matrix3;
  dustRef: number;
}

const VOLUME_SLOTS = [
  nebulaUniforms.uNebulaVolume0,
  nebulaUniforms.uNebulaVolume1,
  nebulaUniforms.uNebulaVolume2,
  nebulaUniforms.uNebulaVolume3,
];

/** Point every star material at the volumes now standing, or at none.
 *  Entries beyond the shader's slots are dropped: the caller hands the
 *  nearest volumes first, so the rifts the eye actually checks stars
 *  against are the ones that take the slots. */
export function setStarNebulaExtinction(extinctions: readonly StarNebulaExtinction[]): void {
  for (let i = 0; i < MAX_STAR_NEBULAE; i++) {
    const extinction = extinctions[i];
    const box = nebulaUniforms.uNebulaBoxes.value[i];
    if (!extinction) {
      VOLUME_SLOTS[i].value = NO_VOLUME;
      box.w = 0;
      continue;
    }
    VOLUME_SLOTS[i].value = extinction.volume;
    box.set(
      extinction.camPc.x - extinction.centrePc.x,
      extinction.camPc.y - extinction.centrePc.y,
      extinction.camPc.z - extinction.centrePc.z,
      extinction.halfPc,
    );
    nebulaUniforms.uNebulaDustRefs.value[i] = extinction.dustRef;
  }
  if (extinctions[0]) nebulaUniforms.uCameraToGalaxy.value.copy(extinctions[0].cameraToGalaxy);
}

const VERTEX = /* glsl */ `
in vec3 starColor;
in float luminosity;
in float aRadiusKm;

uniform float uKmPerPc;
uniform float uIntensity;
uniform float uZeroPoint;
uniform float uZeroShift;
uniform float uGamma;
uniform float uGain;
uniform float uFloor;
uniform float uCeil;
uniform float uCutoff;
uniform float uPointColorKnee;

uniform sampler3D uNebulaVolume0;
uniform sampler3D uNebulaVolume1;
uniform sampler3D uNebulaVolume2;
uniform sampler3D uNebulaVolume3;
uniform vec4 uNebulaBoxes[${MAX_STAR_NEBULAE}];
uniform float uNebulaDustRefs[${MAX_STAR_NEBULAE}];
uniform mat3 uCameraToGalaxy;

${GLOBAL_STAR_DUST_GLSL}
uniform mat3 uStarCameraToGalaxy;
uniform vec3 uStarObserverOffsetPc;
${AIR_VIEW_GLSL}
${AIR_REFRACT_GLSL}
${HORIZON_OCCLUSION_GLSL}

out vec3 vColor;
${pointRasterVertex('out')}

/**
 * Visual optical depth of one resident cloud over the stretch of this
 * star's sightline that runs inside it. Zero for a star in front of the
 * cloud, partial for one embedded in it, the whole column for one
 * behind — which is the distinction a depth test cannot make here.
 * Separate sampler slots rather than an array: ESSL 3.00 wants
 * constant sampler indexing, and an empty slot's zero half-extent
 * returns before its texture is ever read.
 */
float nebulaOpticalDepth(sampler3D volume, vec4 box, float dustRef, vec3 relPc) {
  float halfPc = box.w;
  if (halfPc <= 0.0) return 0.0;
  vec3 origin = box.xyz + uStarObserverOffsetPc;
  float reach = length(relPc);
  if (reach < 1e-6) return 0.0;
  vec3 dir = relPc / reach;
  float near=0.0,far=min(reach,${f(LOCAL_CLOUD_RADIUS_PC)});
  // A ray parallel to a box face must not evaluate 0 * infinity when
  // the observer lies on that face. Clip each finite axis explicitly.
  for(int axis=0;axis<3;axis++) {
    if(abs(dir[axis])<1e-8) {
      if(abs(origin[axis])>halfPc)return 0.0;
    } else {
      float a=(-halfPc-origin[axis])/dir[axis],b=(halfPc-origin[axis])/dir[axis];
      near=max(near,min(a,b));far=min(far,max(a,b));
    }
  }
  if (far <= near) return 0.0;
  float ds = (far - near) / 12.0;
  float tau = 0.0;
  for (int i = 0; i < 12; i++) {
    vec3 p = origin + dir * (near + (float(i) + 0.5) * ds);
    float root = texture(volume, p / (2.0 * halfPc) + 0.5).r;
    tau += root * root;
  }
  return tau * dustRef * ${DUST_OPACITY_PER_PC.toFixed(4)} * ds;
}

uniform vec3 uSourceTransmission;

void main() {
#ifdef REJECT_OFFSCREEN
  vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 apparentWorldPos = airRefractPosition(worldPos);
  gl_Position = projectionMatrix * viewMatrix * vec4(apparentWorldPos, 1.0);
  // Point clipping uses its centre. Reject after refraction, before
  // photometry and up to 48 volume samples for a point off screen.
  // Do not test z: sky depth is deliberately clamped below.
  if (gl_Position.w <= 0.0 || any(greaterThan(abs(gl_Position.xy), vec2(gl_Position.w)))
      || horizonOccludes(apparentWorldPos)) {
    vColor = vec3(0.0);
    gl_PointSize = 1.0;
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    return;
  }

#endif
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float distanceKm = max(length(mvPosition.xyz), 1.0);
  float distancePc = max(distanceKm / uKmPerPc, 1e-9);
  // Same photometric mapping as the backdrop's resolved stars, but with
  // apparent brightness from the camera's true distance — the sky at the
  // home viewpoint matches, and flying toward a star brightens it.
  // The population zero point is a display exposure offset. The PSF
  // integrates to that response once; its raster area is not extra light.
  // All source channels carry optical power, with a unit-Y hue.
  // Dust and observer air act on that power before the detector curve,
  // its faint-source release and its instrument detection threshold.
#ifndef REJECT_OFFSCREEN
  vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
#endif
  vec3 skyDir = normalize(worldPos - cameraPosition);
  vec3 relPc = (uCameraToGalaxy * mvPosition.xyz) / uKmPerPc;
  float tauV = starGlobalOpticalDepth(uStarDustObserverPc,(uStarCameraToGalaxy * mvPosition.xyz)/uKmPerPc)
    + nebulaOpticalDepth(uNebulaVolume0, uNebulaBoxes[0], uNebulaDustRefs[0], relPc)
    + nebulaOpticalDepth(uNebulaVolume1, uNebulaBoxes[1], uNebulaDustRefs[1], relPc)
    + nebulaOpticalDepth(uNebulaVolume2, uNebulaBoxes[2], uNebulaDustRefs[2], relPc)
    + nebulaOpticalDepth(uNebulaVolume3, uNebulaBoxes[3], uNebulaDustRefs[3], relPc);
  vec3 transmission = uSourceTransmission * exp(-tauV * vec3(${f(SCATTER_OPACITY_RGB[0])}, 1.0, ${f(SCATTER_OPACITY_RGB[2])})) * airTransmittance(skyDir);
  vec3 sourceRgb = starColor * luminosity * transmission;
  float sourceLuminosity = dot(sourceRgb, vec3(.2126,.7152,.0722));
  vec3 sourceColor = sourceLuminosity > 0.0 ? sourceRgb/sourceLuminosity : vec3(0.0);
  float irradiance = max(sourceLuminosity / (distancePc * distancePc), 1e-30);
  float logE = log2(irradiance) + uZeroPoint + uZeroShift;
  float raw = uGain * exp2(uGamma * logE);
  // The floor holds a point that would otherwise flicker at the edge
  // of visibility; it is not a promise to draw every star at every
  // distance. A star a decade below the floor's own brightness starts
  // to go, two decades below it is gone — at a locale nothing the
  // sweep kept is that faint, and from kiloparsecs out the galaxy's
  // own light carries what these points were, which it would
  // otherwise carry twice.
  float held = uFloor > 0.0
    ? smoothstep(-6.64, -3.32, log2(max(raw, 1e-12) / uFloor) / uGamma)
    : 1.0;

#ifdef REJECT_OFFSCREEN
  if (held <= 0.0) {
    vColor = vec3(0.0);
    gl_PointSize = 1.0;
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    return;
  }
#endif
  float energy = max(raw, uFloor) * held;
  // An instrument with a real limit drops the points below it — the
  // same seating the backdrop's stars take, so the two star tiers
  // stay one photometric system under any mode.
  if (uCutoff > 0.0) energy *= smoothstep(uCutoff * 0.6, uCutoff * 1.6, irradiance);
  // Once the star's actual disc resolves, the photosphere carries it.
  energy *= 1.0 - smoothstep(0.002, 0.004, aRadiusKm / distanceKm);
  float sat = uPointColorKnee > 0.0 ? clamp(energy / uPointColorKnee, 0.0, 1.0) : 1.0;
  vec3 hue = mix(
    vec3(dot(sourceColor, vec3(0.2126, 0.7152, 0.0722))) * vec3(0.86, 1.02, 1.07),
    sourceColor, sat);
  vColor = hue * energy * uIntensity * skyVisibility(skyDir) * uPointScale * uPointScale;
#ifndef REJECT_OFFSCREEN
  vec3 apparentWorldPos = airRefractPosition(worldPos);
  gl_Position = projectionMatrix * viewMatrix * vec4(apparentWorldPos, 1.0);
#endif
  // Sky points sit far beyond the camera's far plane at low altitude,
  // and the far plane cuts on view depth — a camera-rotation-dependent
  // filter that has no business editing the sky. Under the reversed-Z
  // pipeline the far plane lives at z = 0 (near at z = w): pin depth
  // just inside both, so every star draws at its honest direction.
  // The floor must undercut every real body's depth (~near/distance —
  // from a surface, near is metres and a parent planet reaches ~1e-11)
  // or the sky wins the reversed GEQUAL test and shines through it;
  // 1e-24 is beyond any body yet still beats the far-plane clear at 0.
  seatPointRaster(gl_Position);
  gl_Position.z = clamp(gl_Position.z, 1e-24 * gl_Position.w, gl_Position.w);
#ifndef REJECT_OFFSCREEN
  if (held <= 0.0 || horizonOccludes(apparentWorldPos)) gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
#endif
}
`;

const FRAGMENT = /* glsl */ `
// GLSL 3, for the sampler3D the extinction march reads: a raw shader
// declares its own varyings and its own output.
in vec3 vColor;
${pointRasterFragment('in')}
out vec4 fragColor;

void main() {
  fragColor = vec4(vColor * pointPixelWeight(), 1.0);
}
`;

/** Materials are registered only in explicit audit mode for matched A/B
 * comparisons; disposal removes them from the audit registry. */
const auditMaterials = new Set<ShaderMaterial>();
let auditCulling = true;
export function setStarPointCulling(enabled: boolean): void {
  auditCulling = enabled;
  for (const material of auditMaterials) {
    if (enabled) material.defines.REJECT_OFFSCREEN = 1;
    else delete material.defines.REJECT_OFFSCREEN;
    material.needsUpdate = true;
  }
}

/** Optical star-point material (positions in km), with the existing
 * phenomenological display/PSF response. The zero point sets its pivot. */
export function createStarPointsMaterial(kmPerPc: number, zeroPoint = 17): ShaderMaterial {
  const material = new ShaderMaterial({
    defines: { REJECT_OFFSCREEN: 1 },
    glslVersion: GLSL3,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...airViewUniforms(),
      ...horizonOcclusionUniforms(),
      uKmPerPc: { value: kmPerPc },
      uIntensity: { value: 1 },
      uZeroPoint: { value: zeroPoint },
      uSourceTransmission: { value: [1, 1, 1] },
      ...fieldPointUniforms(),
      ...starGlobalDustUniforms,
      ...nebulaUniforms,
    },
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  installPointRaster(material);
  installStarDustCamera(material);
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('benchmark')) {
    if (!auditCulling) delete material.defines.REJECT_OFFSCREEN;
    auditMaterials.add(material);
    material.addEventListener('dispose', () => auditMaterials.delete(material));
  }
  return material;
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
