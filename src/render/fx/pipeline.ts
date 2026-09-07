import {
  ACESFilmicToneMapping,
  DepthTexture,
  HalfFloatType,
  UnsignedIntType,
  WebGLRenderer,
  WebGLRenderTarget,
  type Camera,
  type Scene,
  type Object3D,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { CompactBloomPass } from './compactBloom';
import { CloudPass } from './cloudPass';
import { DiagramPass } from './diagramLayer';
import { SkyLayer } from './skyLayer';
import { GpuFrameTimer } from './gpuFrameTimer';
import { auditGlCalls } from './glCallAudit';
import { initializeVolumeUnpack } from '../galaxy/volumeUpload';

/**
 * HDR render pipeline: linear half-float rendering → threshold bloom →
 * ACES tone mapping + sRGB encode in the output pass. Bloom is the only
 * source of glow anywhere; brightness beyond 1.0 blooms naturally.
 *
 * Diagrams come last, after the tone map. They are annotations rather
 * than light: a zone wash blended into the scene takes its appearance
 * from whatever sky happens to be behind it, which is how an opaque
 * dark cloud ends up looking like it was painted over a ring drawn
 * after it. Composited onto the finished image, a decal's strength is
 * its own wherever it falls.
 */
export class RenderPipeline {
  readonly renderer: WebGLRenderer;
  /** Half-resolution home of the volume domes; composited into the
   *  scene pass as a single depth-tested quad. */
  readonly sky = new SkyLayer();
  readonly clouds: CloudPass;
  private readonly composer: EffectComposer;
  private readonly bloom: CompactBloomPass;
  private readonly stopGlAudit: () => void;
  private readonly preparations = new Set<Promise<Object3D>>();
  private disposed = false;
  private readonly skipPreparation = typeof location !== 'undefined'
    && new URLSearchParams(location.search).has('benchmark')
    && new URLSearchParams(location.search).get('benchmarkPrepare') === 'off';

  constructor(
    container: HTMLElement,
    scene: Scene,
    private readonly camera: Camera,
  ) {
    // Reversed-Z: quasi-logarithmic depth precision, so a planet at
    // half a million km and the star behind it stop quantizing to the
    // same far-plane depth and z-fighting in shards. Needs
    // EXT_clip_control; three falls back (with a warning) without it.
    this.renderer = new WebGLRenderer({ antialias: true, reversedDepthBuffer: true });
    this.stopGlAudit = auditGlCalls(this.renderer.getContext() as WebGL2RenderingContext);
    initializeVolumeUnpack(this.renderer);
    // Shader log queries synchronously cross into the driver even after
    // compileAsync completes. Keep this diagnostic cost in development.
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV;
    this.renderer.info.autoReset = false;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    container.appendChild(this.renderer.domElement);

    // Keep the beauty pass's depth available to post-processing. This
    // display-glare cue should spread through open sky, but must not make
    // a nearer solid surface look translucent. A sampled depth attachment
    // keeps that rule geometric instead of special-casing planets or sunsets.
    const sceneTarget = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      depthBuffer: true,
      depthTexture: new DepthTexture(1, 1, UnsignedIntType),
    });
    this.composer = new EffectComposer(this.renderer, sceneTarget);
    this.composer.addPass(new RenderPass(scene, camera));
    this.clouds = new CloudPass(camera);
    this.composer.addPass(this.clouds);
    // Glare is a compact optical cue around HDR emitters: a broad
    // point-spread turns the physically small solar disc into a white
    // bank across the horizon, hiding sunset color and eclipse contacts.
    this.bloom = new CompactBloomPass(0.18, {
      reversedDepth: this.renderer.capabilities.reversedDepthBuffer,
    });
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new DiagramPass(scene, camera));
    scene.add(this.sky.quad);
    this.timer = new GpuFrameTimer(this.renderer.getContext() as WebGL2RenderingContext);
    this.sky.ready = false;
    void this.prepareSceneObject(this.sky.quad, scene).catch(() => {}).then(() => { this.sky.ready = true; });
  }

  /** Size the drawing buffer to the view. The ratio defaults to the
   *  display's own; a capture asks for more pixels per CSS pixel. */
  setSize(width: number, height: number, ratio = Math.min(window.devicePixelRatio, 2)): void {
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height);
    // The composer owns its own targets and inherits nothing from the
    // renderer, so it has to be told the pixel ratio separately. Left
    // out, every pass runs at CSS resolution and is scaled up to a
    // drawing buffer twice the size — the whole scene through a half
    // resolution it never asked for, which on a dense display reads as
    // a star field that will not come into focus.
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(width, height);
    this.sky.setSize(width, height, ratio);
  }

  /** Compile against the same HDR target as the scene pass. Compiling
   * against the screen would warm a different tone-mapping variant. */
  prepareSceneObject(object: Object3D, scene: Scene): Promise<Object3D> {
    if (this.disposed || this.skipPreparation) return Promise.resolve(object);
    const target = this.renderer.getRenderTarget();
    const face = this.renderer.getActiveCubeFace();
    const level = this.renderer.getActiveMipmapLevel();
    try {
      this.renderer.setRenderTarget(this.composer.readBuffer);
      const pending = this.renderer.compileAsync(object, this.camera, scene);
      this.preparations.add(pending);
      void pending.then(() => this.preparations.delete(pending), () => this.preparations.delete(pending));
      return pending;
    } finally {
      this.renderer.setRenderTarget(target, face, level);
    }
  }

  /** Explicit profiling control; ordinary rendering leaves bloom enabled. */
  setBloomEnabled(enabled: boolean): void { this.bloom.enabled = enabled; }

  set exposure(value: number) {
    this.renderer.toneMappingExposure = value;
  }

  get exposure(): number {
    return this.renderer.toneMappingExposure;
  }

  /**
   * GPU time of the most recent frame whose query has resolved, ms —
   * what the frame actually costs to draw, which a frame *interval*
   * quantized to the display's refresh cannot show. Null where the
   * timer extension is missing; callers fall back to the interval.
   */
  get gpuFrameMs(): number | null { return this.timer.elapsedMs; }
  private readonly timer: GpuFrameTimer;
  private frameOpen = false;

  /** Called before any offscreen work, including black-hole tracing,
   *  atmosphere passes and lensed-sky captures. */
  beginFrame(): void {
    if (this.frameOpen) return;
    this.frameOpen = true;
    this.renderer.info.reset();
    this.timer.begin();
  }

  render(): void {
    // Standalone captures have no preceding viewer frame.
    this.beginFrame();
    try {
      this.sky.render(this.renderer, this.camera);
      this.composer.render();
    } finally {
      this.timer.end();
      this.frameOpen = false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.domElement.remove();
    // compileAsync polls renderer-owned material properties. Tearing those
    // down mid-poll can throw or strand deferred body disposal. Allow owner
    // completion callbacks to release their materials before the renderer.
    if (this.preparations.size) {
      void Promise.allSettled([...this.preparations]).then(() => {
        setTimeout(() => this.releaseResources(), 0);
      });
    } else this.releaseResources();
  }

  private releaseResources(): void {
    this.stopGlAudit();
    this.timer.dispose();
    // Composer disposal owns its two buffers and internal copy pass;
    // the passes we added retain their own targets/materials.
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
    this.sky.dispose();
    this.renderer.dispose();
  }
}
