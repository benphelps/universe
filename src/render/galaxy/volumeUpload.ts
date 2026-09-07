import { Box3, Data3DTexture, Vector3, type WebGLRenderer } from 'three';

export const VOLUME_UPLOAD_BYTES_PER_FRAME = 512 * 1024;

/** Call once on a fresh renderer. Three's first CPU sub-region copy otherwise
 * queries these defaults synchronously while previous GPU work is in flight.
 * Seat them through its state cache so later copies restore them without a
 * driver readback. Do not reset an already configured/shared context here. */
export function initializeVolumeUnpack(renderer: Pick<WebGLRenderer, 'getContext' | 'state'>): void {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  for (const name of [gl.UNPACK_ROW_LENGTH, gl.UNPACK_IMAGE_HEIGHT, gl.UNPACK_SKIP_PIXELS,
    gl.UNPACK_SKIP_ROWS, gl.UNPACK_SKIP_IMAGES]) renderer.state.pixelStorei(name, 0);
}

/** Upload an unpublished volume in bounded Z slabs. Source wrappers share
 * the bake arrays, but must never be initialized as GPU textures: Three's
 * copy API would then select a GPU-to-GPU copy instead of the CPU data. */
export class VolumeUpload {
  private index = 0;
  private layer = 0;
  private initialized = false;
  private source: Data3DTexture | null = null;
  private readonly region = new Box3();
  private readonly position = new Vector3();

  constructor(private readonly textures: readonly Data3DTexture[]) {}

  /** Exactly one allocation or one bounded transfer per viewer frame. The
   * destination is safe to publish only after this returns true. */
  step(renderer: Pick<WebGLRenderer, 'initTexture' | 'copyTextureToTexture'>): boolean {
    const texture = this.textures[this.index];
    if (!texture) return true;
    const { data, width, height, depth } = texture.image;
    if (!data) throw new Error('Volume upload requires CPU data');
    if (!this.initialized) {
      texture.source.dataReady = false;
      try { renderer.initTexture(texture); }
      finally { texture.source.dataReady = true; }
      this.source = new Data3DTexture(data, width, height, depth);
      this.source.format = texture.format;
      this.source.type = texture.type;
      this.initialized = true;
      return false;
    }
    const bytesPerLayer = data.byteLength / depth;
    const layers = Math.min(depth - this.layer,
      Math.max(1, Math.floor(VOLUME_UPLOAD_BYTES_PER_FRAME / bytesPerLayer)));
    this.region.min.set(0, 0, this.layer);
    this.region.max.set(width, height, this.layer + layers);
    this.position.set(0, 0, this.layer);
    renderer.copyTextureToTexture(this.source!, texture, this.region, this.position);
    this.layer += layers;
    if (this.layer === depth) {
      this.source!.dispose(); this.source = null;
      this.index++; this.layer = 0; this.initialized = false;
    }
    return this.index === this.textures.length;
  }

  /** The caller owns destination textures and their bake arrays. */
  dispose(): void { this.source?.dispose(); this.source = null; }
}
