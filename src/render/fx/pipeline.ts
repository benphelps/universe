import { ACESFilmicToneMapping, Vector2, WebGLRenderer, type Camera, type Scene } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { DiagramPass } from './diagramLayer';
import { SkyLayer } from './skyLayer';

/** The GPU timer extension's two tokens, which the DOM typings lack. */
interface TimerExtension {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

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
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;

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
    this.renderer.info.autoReset = false;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    container.appendChild(this.renderer.domElement);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new Vector2(1, 1), 0.45, 0.6, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new DiagramPass(scene, camera));
    scene.add(this.sky.quad);
    this.timer = this.renderer
      .getContext()
      .getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null;
  }

  setSize(width: number, height: number): void {
    const ratio = Math.min(window.devicePixelRatio, 2);
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
  gpuFrameMs: number | null = null;
  private readonly timer: TimerExtension | null;
  private readonly timerQueries: WebGLQuery[] = [];

  render(): void {
    // The counters cover the whole frame — every pass of the composer
    // and the sky layer — rather than whichever pass drew last.
    this.renderer.info.reset();
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (this.timer) {
      for (let i = this.timerQueries.length - 1; i >= 0; i--) {
        const query = this.timerQueries[i];
        if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) continue;
        if (!gl.getParameter(this.timer.GPU_DISJOINT_EXT)) {
          this.gpuFrameMs = (gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6;
        }
        gl.deleteQuery(query);
        this.timerQueries.splice(i, 1);
      }
      const query = gl.createQuery();
      if (query) {
        gl.beginQuery(this.timer.TIME_ELAPSED_EXT, query);
        this.timerQueries.push(query);
      }
    }
    this.sky.render(this.renderer, this.camera);
    this.composer.render();
    if (this.timer && this.timerQueries.length) gl.endQuery(this.timer.TIME_ELAPSED_EXT);
  }

  dispose(): void {
    this.sky.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
