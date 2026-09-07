import { AlwaysDepth, NeverDepth, Scene, type Camera, type Mesh, type ShaderMaterial, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import { Pass } from 'three/addons/postprocessing/Pass.js';

/** One analytic cloud segment, clipped to the beauty pass's nearest surface.
 * Borrows the composer's color/depth buffers; no cloud target or depth prepass.
 * The shader copies scene depth for subsequent depth-aware glare. */
export class CloudPass extends Pass {
  private readonly scene = new Scene();
  private shell: Mesh | null = null;

  constructor(private readonly camera: Camera) {
    super();
    this.enabled = false;
  }

  setShell(shell: Mesh | null): void {
    if (this.shell) this.scene.remove(this.shell);
    this.shell = shell;
    if (shell) this.scene.add(shell);
    this.enabled = shell !== null;
  }

  override render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget): void {
    if (!this.shell) return;
    const material = this.shell.material as ShaderMaterial;
    // Three r185 complements ALL depth functions in reversed Z, including
    // Always/Never. Request Never there so the actual GL comparison is ALWAYS.
    material.depthFunc = renderer.capabilities.reversedDepthBuffer ? NeverDepth : AlwaysDepth;
    const uniforms = material.uniforms;
    uniforms.uSceneColor.value = readBuffer.texture;
    uniforms.uSceneDepth.value = readBuffer.depthTexture;
    uniforms.uInverseProjection.value.copy(this.camera.projectionMatrixInverse);
    const autoClear = renderer.autoClear;
    try {
      renderer.autoClear = false;
      renderer.setRenderTarget(writeBuffer);
      renderer.render(this.scene, this.camera);
    } finally {
      renderer.autoClear = autoClear;
    }
  }

  override dispose(): void {
    // The focused body owns the mesh/material and disposes them on departure.
    this.setShell(null);
  }
}
