import {
  BufferAttribute,
  BufferGeometry,
  Color,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NormalBlending,
  Scene,
  ShaderMaterial,
  Matrix4,
  Vector3,
  WebGLRenderTarget,
  type Camera,
  type Object3D,
  type WebGLRenderer,
} from 'three';
import { AIR_VIEW_GLSL, airViewUniforms, applyAirView, type AirView } from '../lighting/airView';

/**
 * The layer the volume marches live on.
 *
 * The galaxy dome and the nebula dome are the two most expensive
 * fragments in the frame, and both paint smooth glow: nothing in them
 * survives at pixel frequency. So they render together into one target
 * at half resolution — a quarter of the march cost — and reach the
 * frame as a single composite, upsampled bilinearly, still depth-tested
 * at the far plane so solid geometry occludes the sky exactly as it
 * occluded the domes.
 *
 * The composite also settles what the reversed-Z render order had
 * quietly inverted: inside this target the galaxy is drawn first and
 * the nebula composites over it, and in the scene the star points draw
 * after the composite — each star carrying its own extinction through
 * the cloud — instead of the volume veiling every star on screen,
 * foreground ones included.
 */
export const SKY_RESOLUTION_SCALE = 0.5;
/**
 * The march's sample pitch on a dense display, in CSS pixels: the
 * layer never renders finer than this, so a device pixel ratio of two
 * does not quadruple the march for glow that carries nothing at pixel
 * frequency. This is the frame's one obvious dial. Measured at the near
 * grade over Musas on a 2564×1962 buffer, 1.0 → 1.4 took 26 → 20 ms of
 * GPU at a mean pixel difference of 1.2 in 255; every step coarser buys
 * more of the same at the same kind of price, and a step finer costs it
 * back. Change it, look at the crops the ledger describes, decide.
 */
export const SKY_SAMPLE_CSS_PX = 1.4;

/** The layer's scale against the drawing buffer at a pixel ratio:
 *  half, or coarser where half of a dense buffer would be finer than
 *  the sample pitch. */
export function skyResolutionScale(pixelRatio: number): number {
  return Math.min(SKY_RESOLUTION_SCALE, 1 / (SKY_SAMPLE_CSS_PX * pixelRatio));
}

/** The last sub-pixel tail of a point fade is not worth submitting. */
export const SKY_POINT_VISIBILITY_FLOOR = 0.000001;

/**
 * Extended light is likewise kept through its entire perceptible fade.
 * Its broad gradients otherwise appear all at once when a coarse common
 * cutoff is crossed during twilight.
 */
export const SKY_EXTENDED_VISIBILITY_FLOOR = 0.000001;

const VERTEX = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  // At the far plane in the reversed-Z convention, exactly where the
  // domes pin themselves: anything that wrote depth wins.
  gl_Position = vec4(position.xy, 1e-24, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSky;
uniform float uIntensity;
uniform mat4 uProjectionInverse;
uniform mat4 uCameraWorld;
${AIR_VIEW_GLSL}
void main() {
  // The sightline behind this pixel, for the air it crosses.
  vec4 clip = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec4 eye = uProjectionInverse * clip;
  vec3 dir = normalize(mat3(uCameraWorld) * (eye.xyz / eye.w));
  // Premultiplied, so one factor washes the domes out of a daytime
  // sky the way the star points wash out: the light fades and the
  // occlusion fades with it — a rift cannot darken an atmosphere
  // that shines in front of it.
  fragColor = texture(uSky, vUv) * uIntensity * skyVisibility(dir);
  fragColor.rgb *= airTransmittance(dir);
}
`;

export class SkyLayer {
  /** Where the volume domes live now, in place of the main scene. */
  readonly scene = new Scene();
  /** The composite, for the pipeline to seat in the main scene. */
  readonly quad: Mesh;
  /** Daylight washout, 0..1 — the same factor the star points carry.
   *  The domes are everything stellar beyond the system, and a bright
   *  atmosphere stands in front of all of it. */
  intensity = 1;
  private readonly target: WebGLRenderTarget;
  private readonly savedColor = new Color();

  constructor() {
    this.target = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
    });
    const geometry = new BufferGeometry();
    // One triangle over the whole screen: no diagonal seam to interpolate
    // across, nothing to cull.
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    );
    this.quad = new Mesh(
      geometry,
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
          uSky: { value: this.target.texture },
          uIntensity: { value: 1 },
          uProjectionInverse: { value: new Matrix4() },
          uCameraWorld: { value: new Matrix4() },
          ...airViewUniforms(),
        },
        // Premultiplied over: the galaxy half is pure added light with
        // zero alpha, the nebula half carries its own occlusion.
        blending: NormalBlending,
        premultipliedAlpha: true,
        transparent: true,
        depthWrite: false,
        depthTest: true,
      }),
    );
    // Reversed-Z inverts renderOrder: LOWEST draws last. The composite
    // must draw before the star points (-2) and everything above them,
    // so it takes the highest slot in the sky stack.
    this.quad.renderOrder = -1;
    this.quad.frustumCulled = false;
  }

  /** Track the drawing-buffer size; the target keeps its half scale. */
  setSize(width: number, height: number, pixelRatio: number): void {
    const scale = skyResolutionScale(pixelRatio);
    this.target.setSize(
      Math.max(1, Math.round(width * pixelRatio * scale)),
      Math.max(1, Math.round(height * pixelRatio * scale)),
    );
  }

  /** Render whatever sky volumes are standing; with none — or with
   *  daylight washing the whole layer out — the composite stands down
   *  and the frame never touches the target. */
  render(renderer: WebGLRenderer, camera: Camera): void {
    const anything =
      this.intensity > SKY_EXTENDED_VISIBILITY_FLOOR &&
      this.scene.children.some((child) => child.visible);
    this.quad.visible = anything;
    if (!anything) return;
    const uniforms = (this.quad.material as ShaderMaterial).uniforms;
    uniforms.uIntensity.value = this.intensity;
    (uniforms.uProjectionInverse.value as Matrix4).copy(camera.projectionMatrixInverse);
    (uniforms.uCameraWorld.value as Matrix4).copy(camera.matrixWorld);
    const previousTarget = renderer.getRenderTarget();
    renderer.getClearColor(this.savedColor);
    const previousAlpha = renderer.getClearAlpha();
    const previousAutoClear = renderer.autoClear;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.target);
    renderer.clear(true, false, false);
    renderer.autoClear = false;
    renderer.render(this.scene, camera);
    renderer.autoClear = previousAutoClear;
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(this.savedColor, previousAlpha);
  }

  /** The air the composite is seen through from a ground. */
  setAirView(air: AirView | null): void {
    applyAirView(this.quad.material as ShaderMaterial, air);
  }

  /**
   * Lend the domes to a scene for a cube capture: a screen-space
   * composite is the one thing a cube camera must not photograph, so
   * for the capture the domes themselves stand in, recentred on the
   * capture point the way the backdrop is — their carriers ride the
   * main camera otherwise. `reclaim` puts them back.
   */
  lendTo(scene: Scene, centreWorldKm: Vector3): Object3D[] {
    const domes = [...this.scene.children];
    for (const dome of domes) {
      scene.add(dome);
      dome.position.copy(centreWorldKm);
    }
    this.quad.visible = false;
    return domes;
  }

  reclaim(domes: Object3D[]): void {
    for (const dome of domes) this.scene.add(dome);
  }

  dispose(): void {
    this.target.dispose();
    this.quad.geometry.dispose();
    (this.quad.material as ShaderMaterial).dispose();
  }
}
