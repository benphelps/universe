import {
  BackSide,
  ClampToEdgeWrapping,
  Data3DTexture,
  GLSL3,
  LinearFilter,
  Matrix3,
  Mesh,
  NormalBlending,
  RGBAFormat,
  ShaderMaterial,
  SphereGeometry,
  UnsignedByteType,
  Vector3,
} from 'three';
import type { GalacticPosition } from '../../universe/galaxy/density';
import { DUST_OPACITY_PER_PC } from '../../universe/galaxy/density';
import type { NebulaVolumeBake } from '../../universe/galaxy/nebulaVolume';

const VERTEX = /* glsl */ `
// The dome is a unit sphere centered on the camera and never rotated,
// so the local vertex position IS the view ray.
out vec3 vRay;
void main() {
  vRay = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // The nebula is hundreds of parsecs out and the far plane is tens:
  // it is a direction and a depth of its own, carried by a dome that
  // rides the camera, exactly as the galaxy volume is.
  gl_Position.z = 1e-24 * gl_Position.w;
}
`;

const STEPS = 96;

const FRAGMENT = /* glsl */ `
precision highp sampler3D;
// GLSL 3: a raw shader declares its own varying and its own output —
// three shims neither for a material it did not write.
in vec3 vRay;
out vec4 fragColor;
uniform sampler3D uVolume;
uniform vec3 uCentrePc;
uniform vec3 uCamPc;
uniform mat3 uWorldToGalaxy;
uniform float uHalfPc;
uniform float uDustRef;
uniform float uDensityRef;
uniform vec3 uEmissionHot;
uniform vec3 uEmissionCool;
uniform vec3 uReflection;
uniform float uEmissionScale;
uniform float uScatterScale;
uniform float uOpacity;

/** Interleaved gradient noise: one cheap dither per pixel, so the
 *  march's step boundaries never line up into shells. */
float dither(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec3 dir = normalize(uWorldToGalaxy * vRay);
  // Everything below is in parsecs, in the box's own frame.
  vec3 rel = uCamPc - uCentrePc;
  vec3 inv = 1.0 / dir;
  vec3 a = (vec3(-uHalfPc) - rel) * inv;
  vec3 b = (vec3(uHalfPc) - rel) * inv;
  vec3 lo = min(a, b);
  vec3 hi = max(a, b);
  float near = max(max(lo.x, lo.y), max(lo.z, 0.0));
  float far = min(min(hi.x, hi.y), hi.z);
  if (far <= near) discard;

  float ds = (far - near) / float(${STEPS});
  float jitter = dither(gl_FragCoord.xy);
  vec3 light = vec3(0.0);
  float transmittance = 1.0;
  for (int i = 0; i < ${STEPS}; i++) {
    vec3 p = rel + dir * (near + (float(i) + jitter) * ds);
    vec4 cell = texture(uVolume, p / (2.0 * uHalfPc) + 0.5);
    float dust = cell.r * uDustRef;
    float ionized = cell.g * uDensityRef;

    // Recombination lines: optically thin, and going as the square of
    // the density because every emission is an electron meeting a
    // proton. The hue is the line mixture at this cell's hardness.
    vec3 emission = mix(uEmissionCool, uEmissionHot, cell.b) * ionized * ionized * uEmissionScale;
    // What the dust scatters of the star's own light, dimmed by the
    // dust between it and here (cell.a) and by distance.
    float r2 = max(dot(p, p), 0.05);
    vec3 scattered = uReflection * uScatterScale * dust * cell.a / r2;

    float extinction = dust * ${DUST_OPACITY_PER_PC.toFixed(4)};
    light += transmittance * (emission + scattered) * ds;
    transmittance *= exp(-extinction * ds);
    if (transmittance < 0.004) break;
  }

  // Premultiplied: what the nebula emits, over what it lets past.
  fragColor = vec4(light * uOpacity, (1.0 - transmittance) * uOpacity);
}
`;

/**
 * One nebula as a volume, marched per pixel.
 *
 * The bake did the physics; this integrates it along the view ray —
 * emission accumulating linearly because the lines are optically thin,
 * dust taking its toll on everything behind it. The carrier is a dome
 * around the camera rather than a mesh at the nebula's place: the
 * camera's far plane is tens of parsecs and the nebula is hundreds
 * out, so a box at its true position would be clipped away. The ray
 * meets the box analytically instead, in parsecs, where the numbers
 * are small and honest.
 */
export class NebulaVolume {
  readonly mesh: Mesh;
  readonly seed: bigint;
  private readonly material: ShaderMaterial;
  private readonly texture: Data3DTexture;
  private readonly sceneToGalaxy: Matrix3;

  constructor(
    bake: NebulaVolumeBake,
    private readonly viewpointPc: GalacticPosition,
    sceneFromGalaxy: Float32Array,
  ) {
    this.seed = bake.seed;
    const m = sceneFromGalaxy;
    this.sceneToGalaxy = new Matrix3().set(m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]);

    this.texture = new Data3DTexture(bake.data, bake.size, bake.size, bake.size);
    this.texture.format = RGBAFormat;
    this.texture.type = UnsignedByteType;
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.wrapS = ClampToEdgeWrapping;
    this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.wrapR = ClampToEdgeWrapping;
    this.texture.needsUpdate = true;

    this.material = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uVolume: { value: this.texture },
        uCentrePc: { value: new Vector3(...bake.centrePc) },
        uCamPc: { value: new Vector3() },
        uWorldToGalaxy: { value: new Matrix3() },
        uHalfPc: { value: bake.halfExtentsPc[0] },
        uDustRef: { value: bake.dustRef },
        uDensityRef: { value: bake.densityRef },
        uEmissionHot: { value: new Vector3(...bake.emissionHot) },
        uEmissionCool: { value: new Vector3(...bake.emissionCool) },
        uReflection: { value: new Vector3(...bake.reflectionColor) },
        uEmissionScale: { value: EMISSION_SCALE },
        uScatterScale: { value: SCATTER_SCALE },
        uOpacity: { value: 1 },
      },
      side: BackSide,
      // Premultiplied alpha is exactly the volume-rendering composite:
      // what the nebula emits, plus what survives of everything behind.
      blending: NormalBlending,
      premultipliedAlpha: true,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    this.mesh = new Mesh(new SphereGeometry(1, 24, 12), this.material);
    // Behind the star points and the sky domes, in front of the galaxy.
    this.mesh.renderOrder = -6;
    this.mesh.frustumCulled = false;
  }

  set opacity(value: number) {
    this.material.uniforms.uOpacity.value = value;
    this.mesh.visible = value > 0.002;
  }

  /** Per-frame: where the camera stands, in the galaxy's own frame. */
  update(cameraWorldKm: Vector3, worldToScene: Matrix3, pcKm: number, domeRadiusKm: number): void {
    const worldToGalaxy = this.material.uniforms.uWorldToGalaxy.value as Matrix3;
    worldToGalaxy.multiplyMatrices(this.sceneToGalaxy, worldToScene);
    const cam = this.material.uniforms.uCamPc.value as Vector3;
    cam.copy(cameraWorldKm).applyMatrix3(worldToGalaxy).divideScalar(pcKm);
    cam.set(
      cam.x + this.viewpointPc.xPc,
      cam.y + this.viewpointPc.yPc,
      cam.z + this.viewpointPc.zPc,
    );
    this.mesh.position.copy(cameraWorldKm);
    this.mesh.scale.setScalar(domeRadiusKm);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

/**
 * Emission and scattering scales: the volume's brightness against the
 * pipeline's exposure. Provisional, and the one thing here still set by
 * eye — the emission measure and the line spectrum are physical, but
 * what a magnitude of surface brightness comes to in this renderer is
 * the sky's photometric zero point, and hooking these to it is what
 * will make the volume and the sprite it replaces agree at the distance
 * they hand off.
 */
const EMISSION_SCALE = 4e-4;
const SCATTER_SCALE = 0.6;
