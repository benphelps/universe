import { ACESFilmicToneMapping, Vector2, WebGLRenderer, type Camera, type Scene } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { DiagramPass } from './diagramLayer';

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
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;

  constructor(container: HTMLElement, scene: Scene, camera: Camera) {
    // Reversed-Z: quasi-logarithmic depth precision, so a planet at
    // half a million km and the star behind it stop quantizing to the
    // same far-plane depth and z-fighting in shards. Needs
    // EXT_clip_control; three falls back (with a warning) without it.
    this.renderer = new WebGLRenderer({ antialias: true, reversedDepthBuffer: true });
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    container.appendChild(this.renderer.domElement);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new Vector2(1, 1), 0.45, 0.6, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new DiagramPass(scene, camera));
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
  }

  set exposure(value: number) {
    this.renderer.toneMappingExposure = value;
  }

  get exposure(): number {
    return this.renderer.toneMappingExposure;
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
