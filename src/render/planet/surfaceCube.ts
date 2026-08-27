import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  LinearMipmapLinearFilter,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  RGBAFormat,
  ShaderMaterial,
  WebGLCubeRenderTarget,
  type WebGLRenderer,
} from 'three';

const COPY_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const COPY_FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uFace;
void main() {
  gl_FragColor = texture2D(uFace, vUv);
}
`;

let copyMaterial: ShaderMaterial | null = null;
let copyMesh: Mesh | null = null;
// The copy writes clip coordinates directly; the camera only satisfies
// the renderer's projection bookkeeping (reversed-Z).
const copyCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

/** Blit six CPU-baked RGBA faces into a mipmapped cubemap. */
export function uploadSurfaceCube(
  renderer: WebGLRenderer,
  faces: Uint8Array[],
  size: number,
): WebGLCubeRenderTarget {
  if (!copyMaterial || !copyMesh) {
    copyMaterial = new ShaderMaterial({
      vertexShader: COPY_VERTEX,
      fragmentShader: COPY_FRAGMENT,
      uniforms: { uFace: { value: null } },
      depthTest: false,
      depthWrite: false,
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    );
    copyMesh = new Mesh(geometry, copyMaterial);
    copyMesh.frustumCulled = false;
  }
  const target = new WebGLCubeRenderTarget(size, {
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
  });
  const previous = renderer.getRenderTarget();
  for (let face = 0; face < 6; face++) {
    const texture = new DataTexture(faces[face], size, size, RGBAFormat);
    texture.minFilter = NearestFilter;
    texture.magFilter = NearestFilter;
    texture.needsUpdate = true;
    copyMaterial.uniforms.uFace.value = texture;
    renderer.setRenderTarget(target, face);
    renderer.render(copyMesh, copyCamera);
    texture.dispose();
  }
  renderer.setRenderTarget(previous);
  copyMaterial.uniforms.uFace.value = null;
  return target;
}
