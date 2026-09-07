import { Data3DTexture, FloatType, GLSL3, HalfFloatType, Mesh, NoBlending, OrthographicCamera,
  PlaneGeometry, RedFormat, RGBAFormat, Scene, ShaderMaterial, WebGLRenderer, WebGLRenderTarget } from 'three';
import { VolumeUpload, initializeVolumeUnpack } from '../../src/render/galaxy/volumeUpload';

// Run via the Vite dev server. Checks actual GPU texels across slab boundaries,
// channel formats and the final partial slab, using the production uploader.
document.querySelector<HTMLButtonElement>('#run')!.onclick = async () => {
  const renderer = new WebGLRenderer(); renderer.setSize(160, 160);
  initializeVolumeUnpack(renderer);
  const gl = renderer.getContext() as WebGL2RenderingContext, getParameter = gl.getParameter.bind(gl);
  const unpack = new Set<number>([gl.UNPACK_ROW_LENGTH, gl.UNPACK_IMAGE_HEIGHT, gl.UNPACK_SKIP_PIXELS,
    gl.UNPACK_SKIP_ROWS, gl.UNPACK_SKIP_IMAGES]);
  let unpackQueries = 0;
  gl.getParameter = name => { if (unpack.has(name)) unpackQueries++; return getParameter(name); };
  const target = new WebGLRenderTarget(160, 160, { type: FloatType });
  const material = new ShaderMaterial({ glslVersion: GLSL3, blending: NoBlending,
    uniforms: { grid: { value: null }, layer: { value: 0 } },
    vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: 'precision highp sampler3D; uniform sampler3D grid; uniform int layer; out vec4 color; void main(){color=texelFetch(grid,ivec3(ivec2(gl_FragCoord.xy),layer),0);}' });
  const mesh = new Mesh(new PlaneGeometry(2, 2), material), scene = new Scene(); scene.add(mesh);
  const camera = new OrthographicCamera(), rows: unknown[] = [];
  const baselineTextures = renderer.info.memory.textures;
  for (const mode of ['rgba8', 'red8', 'rgba16f']) {
    const channels = mode === 'red8' ? 1 : 4, depth = 17;
    const data = mode === 'rgba16f' ? new Uint16Array(160 * 160 * depth * channels) : new Uint8Array(160 * 160 * depth * channels);
    for (let z = 0; z < depth; z++) for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) for (let c = 0; c < channels; c++) {
      const value = (x + y * 3 + z * 7 + c * 11) % 2;
      data[((z * 160 + y) * 160 + x) * channels + c] = mode === 'rgba16f' ? value * 0x3c00 : value * 255;
    }
    const texture = new Data3DTexture(data, 160, 160, depth);
    texture.format = channels === 1 ? RedFormat : RGBAFormat;
    if (mode === 'rgba16f') texture.type = HalfFloatType;
    texture.needsUpdate = true;
    const upload = new VolumeUpload([texture]); let steps = 0;
    do { steps++; } while (!upload.step(renderer));
    material.uniforms.grid.value = texture;
    let mismatches = 0;
    const pixels = new Float32Array(160 * 160 * 4);
    for (let z = 0; z < depth; z++) {
      material.uniforms.layer.value = z; renderer.setRenderTarget(target); renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, 160, 160, pixels);
      for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) for (let c = 0; c < 4; c++) {
        const expected = c < channels ? (x + y * 3 + z * 7 + c * 11) % 2 : c === 3 ? 1 : 0;
        if (pixels[(y * 160 + x) * 4 + c] !== expected) mismatches++;
      }
    }
    upload.dispose(); texture.dispose();
    rows.push({ mode, steps, texels: 160 * 160 * depth, mismatches });
  }
  material.dispose(); mesh.geometry.dispose(); target.dispose();
  rows.push({ texturesAfterDisposal: renderer.info.memory.textures, baselineTextures, unpackQueries });
  document.querySelector('#result')!.textContent = JSON.stringify(rows, null, 2);
  renderer.dispose();
};
