import {
  BufferAttribute,
  BufferGeometry,
  Camera,
  HalfFloatType,
  LinearMipmapLinearFilter,
  Mesh,
  ShaderMaterial,
  Vector3,
  Vector4,
  WebGLCubeRenderTarget,
  type WebGLRenderer,
} from 'three';
import {
  activeStorms,
  bandFade01,
  MAX_ACTIVE_STORMS,
  type Circulation,
} from '../../universe/planet/circulation';
import type { Characterization } from '../../universe/planet/types';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';
import { createPatternUniforms, HEIGHT_SCALE, PATTERN_GLSL } from './giantPattern';

const BAKE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BAKE_FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform vec3 uFaceForward;
uniform vec3 uFaceRight;
uniform vec3 uFaceUp;

${SIMPLEX_NOISE_GLSL}
${PATTERN_GLSL}

void main() {
  vec2 st = vUv * 2.0 - 1.0;
  vec3 dir = normalize(uFaceForward + st.x * uFaceRight + st.y * uFaceUp);
  vec3 surface;
  float cloudH;
  deckAt(dir, surface, cloudH);
  gl_FragColor = vec4(surface, clamp(cloudH * ${HEIGHT_SCALE.toFixed(2)}, 0.0, 1.0));
}
`;

// GL cubemap face bases (spec table), with the t axis flipped for the
// framebuffer's bottom-left origin.
const FACES: Array<{ forward: Vector3; right: Vector3; up: Vector3 }> = [
  { forward: new Vector3(1, 0, 0), right: new Vector3(0, 0, -1), up: new Vector3(0, 1, 0) },
  { forward: new Vector3(-1, 0, 0), right: new Vector3(0, 0, 1), up: new Vector3(0, 1, 0) },
  { forward: new Vector3(0, 1, 0), right: new Vector3(1, 0, 0), up: new Vector3(0, 0, -1) },
  { forward: new Vector3(0, -1, 0), right: new Vector3(1, 0, 0), up: new Vector3(0, 0, 1) },
  { forward: new Vector3(0, 0, 1), right: new Vector3(1, 0, 0), up: new Vector3(0, 1, 0) },
  { forward: new Vector3(0, 0, -1), right: new Vector3(-1, 0, 0), up: new Vector3(0, 1, 0) },
];

/**
 * Renders a giant's deck pattern into a mipmapped cubemap. A cube has
 * no pole singularity and uniform texel density, and hardware mip
 * filtering antialiases every octave the pattern carries — the whole
 * class of per-fragment shimmer, moiré, and pinch artifacts ends here.
 */
export class DeckBaker {
  private readonly material: ShaderMaterial;
  private readonly mesh: Mesh;
  private readonly camera = new Camera();
  private readonly circulation: Circulation;

  constructor(physical: Characterization, circulation: Circulation) {
    this.circulation = circulation;
    this.material = new ShaderMaterial({
      vertexShader: BAKE_VERTEX,
      fragmentShader: BAKE_FRAGMENT,
      uniforms: {
        ...createPatternUniforms(physical, circulation),
        uFaceForward: { value: new Vector3() },
        uFaceRight: { value: new Vector3() },
        uFaceUp: { value: new Vector3() },
      },
      depthTest: false,
      depthWrite: false,
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    );
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
  }

  static createTarget(size: number): WebGLCubeRenderTarget {
    return new WebGLCubeRenderTarget(size, {
      type: HalfFloatType,
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
    });
  }

  /** Render the deck at one sim time into the target's six faces. */
  bake(
    renderer: WebGLRenderer,
    target: WebGLCubeRenderTarget,
    timeDays: number,
    lightDirObj: Vector3,
  ): void {
    const uniforms = this.material.uniforms;
    uniforms.uTimeDays.value = timeDays;
    (uniforms.uLightDirObj.value as Vector3).copy(lightDirObj);
    const storms = activeStorms(this.circulation, timeDays);
    const slots = uniforms.uStorms.value as Vector4[];
    for (let i = 0; i < MAX_ACTIVE_STORMS; i++) {
      const storm = storms[i];
      if (storm) {
        slots[i].set(
          storm.latRad,
          storm.lonRad,
          storm.kind === 'eruption' ? -storm.sizeRad : storm.sizeRad,
          storm.age01,
        );
      }
    }
    uniforms.uStormCount.value = storms.length;
    const fades = uniforms.uBandFade.value as number[];
    for (let i = 0; i < fades.length; i++) {
      const band = this.circulation.bands[i];
      fades[i] = band ? bandFade01(band, timeDays) : 0;
    }

    const previous = renderer.getRenderTarget();
    for (let face = 0; face < 6; face++) {
      (uniforms.uFaceForward.value as Vector3).copy(FACES[face].forward);
      (uniforms.uFaceRight.value as Vector3).copy(FACES[face].right);
      (uniforms.uFaceUp.value as Vector3).copy(FACES[face].up);
      renderer.setRenderTarget(target, face);
      renderer.render(this.mesh, this.camera);
    }
    renderer.setRenderTarget(previous);
  }

  dispose(): void {
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
