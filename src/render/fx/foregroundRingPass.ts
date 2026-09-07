import { Mesh, Scene, type Camera, type ShaderMaterial, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import { Pass } from 'three/addons/postprocessing/Pass.js';

/** Rings outside the focused planet's cloud sphere can lie wholly before
 * or after its cloud interval on each ray. Render the background fragments
 * in the beauty pass, then the foreground fragments over finished clouds.
 * This preserves partial ring opacity without a depth-writing ring mask
 * (which would incorrectly erase clouds visible through thin ringlets).
 */
export class ForegroundRingPass extends Pass {
  private readonly scene = new Scene();
  private source: Mesh | null = null;
  private proxy: Mesh | null = null;

  constructor(private readonly camera: Camera) {
    super();
    this.enabled = false;
    this.needsSwap = false;
  }

  /** The focus frame places the planet/cloud sphere at the origin. */
  setRing(ring: Mesh | null, cloudOuterRadiusKm = 0): void {
    if (this.source) {
      const uniforms = (this.source.material as ShaderMaterial).uniforms;
      uniforms.uRingCloudRadius.value = 0;
      uniforms.uRingCloudPass.value = 0;
    }
    if (this.proxy) this.scene.remove(this.proxy);
    this.source = this.proxy = null;
    this.enabled = !!ring && cloudOuterRadiusKm > 0;
    if (!this.enabled || !ring) return;
    this.source = ring;
    const material = ring.material as ShaderMaterial;
    material.uniforms.uRingCloudRadius.value = cloudOuterRadiusKm;
    material.uniforms.uRingCloudPass.value = 1;
    this.proxy = new Mesh(ring.geometry, material);
    this.proxy.matrixAutoUpdate = false;
    this.scene.add(this.proxy);
  }

  override render(renderer: WebGLRenderer, _writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget): void {
    if (!this.source || !this.proxy) return;
    const material = this.source.material as ShaderMaterial;
    this.proxy.matrix.copy(this.source.matrixWorld);
    this.proxy.visible = this.source.visible;
    const autoClear = renderer.autoClear;
    try {
      material.uniforms.uRingCloudPass.value = 2;
      renderer.autoClear = false;
      // CloudPass copied the solid depth here. It still hides the far
      // ring behind terrain; foreground fragments alpha-blend normally.
      renderer.setRenderTarget(readBuffer);
      renderer.render(this.scene, this.camera);
    } finally {
      material.uniforms.uRingCloudPass.value = 1;
      renderer.autoClear = autoClear;
    }
  }

  override dispose(): void { this.setRing(null); }
}
