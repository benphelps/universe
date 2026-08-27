import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  Points,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { GalacticPosition } from '../../universe/galaxy/density';
import { getGalaxyParticles } from '../../universe/galaxy/particles';

const VERTEX = /* glsl */ `
attribute vec3 aColor;
attribute float aSizePc;
attribute float aType;

uniform float uPointScale;
uniform float uOpacity;

varying vec3 vColor;
varying float vType;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float dist = max(length(mvPosition.xyz), 1.0);
  gl_PointSize = clamp(uPointScale * aSizePc / dist, 1.0, 160.0);
  vColor = aColor * uOpacity;
  vType = aType;
  gl_Position = projectionMatrix * mvPosition;
  // Reversed-Z: the far plane sits at z = 0 — pin the whole galaxy
  // just inside it, like the sky stars, so no view-depth clipping.
  gl_Position.z = clamp(gl_Position.z, 1e-7 * gl_Position.w, gl_Position.w);
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vType;

void main() {
  vec2 c = 2.0 * gl_PointCoord - 1.0;
  float rho = length(c);
  if (rho > 1.0) discard;
  float falloff = 1.0 - rho;
  float alpha;
  if (vType < 0.5) {
    alpha = falloff * falloff;          // star: compact
  } else if (vType < 1.5) {
    alpha = 0.05 * falloff;             // dust billow: huge and faint
  } else if (vType < 2.5) {
    alpha = 0.07 * falloff;             // filament dust
  } else if (vType < 3.5) {
    alpha = 0.35 * falloff * falloff;   // H2 glow
  } else {
    alpha = falloff;                    // H2 core
  }
  gl_FragColor = vec4(vColor * alpha, 1.0);
}
`;

/**
 * The galaxy's particle body: the density-wave population from
 * universe/galaxy/particles rendered as additive sprites — grain,
 * clumps, and broken arm patches are the discreteness itself. One
 * static geometry shared across systems; each system just orients it
 * into its own sky frame.
 */
export class GalaxyParticles {
  readonly group = new Group();
  private readonly material: ShaderMaterial;
  private readonly points: Points;
  private readonly pcKm: number;

  constructor(viewpointPc: GalacticPosition, sceneFromGalaxy: Float32Array, pcKm: number) {
    this.pcKm = pcKm;
    const set = getGalaxyParticles();
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(set.positionsPc, 3));
    geometry.setAttribute('aColor', new BufferAttribute(set.colors, 3));
    geometry.setAttribute('aSizePc', new BufferAttribute(set.sizesPc, 1));
    geometry.setAttribute('aType', new BufferAttribute(set.types, 1));

    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uPointScale: { value: 1 },
        uOpacity: { value: 0 },
      },
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.points = new Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = -7;
    this.group.add(this.points);

    // Galactic pc → scene km: rotate into this system's sky frame,
    // scale, and place the galactic origin relative to the viewpoint.
    const m = sceneFromGalaxy;
    const rotation = new Matrix4().set(
      m[0], m[1], m[2], 0,
      m[3], m[4], m[5], 0,
      m[6], m[7], m[8], 0,
      0, 0, 0, 1,
    );
    const quat = new Quaternion().setFromRotationMatrix(rotation);
    // Lives inside the viewer's pc-scaled sky group, so the ground
    // frame's spin carries it exactly like the rest of the sky:
    // transform stays in pc units.
    const originScene = new Vector3(-viewpointPc.xPc, -viewpointPc.yPc, -viewpointPc.zPc)
      .applyQuaternion(quat);
    this.group.quaternion.copy(quat);
    this.group.position.copy(originScene);
    this.group.visible = false;
  }

  /** Per-frame: fade with the same handoff the volume uses; the point
   *  scale converts world sizes to pixels for the current viewport. */
  update(opacity: number, pixelsPerRadian: number): void {
    this.group.visible = opacity > 0.002;
    if (!this.group.visible) return;
    this.material.uniforms.uOpacity.value = opacity;
    // Sizes are authored in pc; positions ride a km-scaled group.
    this.material.uniforms.uPointScale.value = pixelsPerRadian * this.pcKm;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
