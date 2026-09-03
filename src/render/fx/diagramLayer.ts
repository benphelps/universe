import { Camera, Object3D, Scene, WebGLRenderer, type WebGLRenderTarget } from 'three';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * The copy to the screen is where the frame drops from half-float to
 * eight bits, and a hazy disc or a twilight sky is a gradient a few
 * levels deep across the whole view: quantized flat it bands, and a
 * capture turns the bands into blocks. Three's own dither breaks the
 * steps up before they are taken.
 */
const DITHERED_COPY = {
  uniforms: { tDiffuse: { value: null }, opacity: { value: 1 } },
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
  fragmentShader: /* glsl */ `
#define DITHERING
#include <common>
#include <dithering_pars_fragment>
uniform sampler2D tDiffuse;
uniform float opacity;
varying vec2 vUv;
void main() {
  vec4 texel = texture2D(tDiffuse, vUv);
  gl_FragColor = vec4(dithering(texel.rgb), texel.a) * opacity;
}`,
};

/**
 * The layer diagrams live on.
 *
 * A habitable zone and an orbit ring are not things in the sky — they
 * are drawn *about* it, and they should read the same whether what
 * lies behind them is a bright star field or the inside of a molecular
 * cloud. Left in the scene they cannot: a nine percent wash takes
 * ninety-one percent of its appearance from whatever is behind it, and
 * the tone map then treats that differently depending on how bright it
 * was. Which is why an opaque rift reads as painted over the top of a
 * zone ring that is, in fact, drawn after it.
 *
 * So diagrams come out of the scene pass and composite onto the
 * finished image instead, where a decal's strength is its own.
 *
 * The sky's own annotations — constellation borders, sector names —
 * stay in the scene rather than joining this layer: they are part of
 * the sky, and bodies in front of them should still occlude them. But
 * within the sky stack they draw over the domes and the volume
 * composite (sectorChart orders them after it), because a map that an
 * opaque rift can erase fails exactly where it has something to name.
 */
export const DIAGRAM_LAYER = 1;

/** Put an object and everything under it on the diagram layer. */
export function markAsDiagram(root: Object3D): void {
  root.traverse((node) => node.layers.set(DIAGRAM_LAYER));
}

/**
 * Copies the finished scene through, then draws the diagram layer over
 * it in display space.
 */
export class DiagramPass extends Pass {
  private readonly copy: ShaderPass;

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
  ) {
    super();
    this.needsSwap = false;
    this.copy = new ShaderPass(DITHERED_COPY);
  }

  override render(
    renderer: WebGLRenderer,
    writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
  ): void {
    this.copy.renderToScreen = this.renderToScreen;
    this.copy.render(renderer, writeBuffer, readBuffer, 0, false);

    const autoClear = renderer.autoClear;
    const layers = this.camera.layers.mask;
    renderer.autoClear = false;
    this.camera.layers.set(DIAGRAM_LAYER);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    // The copy quad just wrote its own depth over the whole frame, and
    // under reversed-Z that reads as the nearest thing there is: every
    // diagram behind it would fail the test. The scene's depth is gone
    // by this point anyway — diagrams are annotations over the finished
    // image — so the buffer is cleared and they draw on top.
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    this.camera.layers.mask = layers;
    renderer.autoClear = autoClear;
  }

  override dispose(): void {
    this.copy.dispose();
  }
}
