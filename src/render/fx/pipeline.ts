import { ACESFilmicToneMapping, Vector2, WebGLRenderer, type Camera, type Scene } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/**
 * HDR render pipeline: linear half-float rendering → threshold bloom →
 * ACES tone mapping + sRGB encode in the output pass. Bloom is the only
 * source of glow anywhere; brightness beyond 1.0 blooms naturally.
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
  }

  setSize(width: number, height: number): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.bloom.resolution.set(width, height);
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
