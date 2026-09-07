import {
  TURBULENCE_OCTAVES,
  cloudShapePermutation,
  cloudStretch,
  cloudStretchAxis,
  type MolecularCloud,
} from '../../universe/galaxy/clouds';
import { carveFunctionGlsl, SEEDED_NOISE } from './cloudFieldGlsl';
import type { Nebula } from '../../universe/galaxy/nebula';
import {
  finishNebulaBake,
  evolveNebulaGas,
  NEBULA_SHADOW_STEPS,
  NEBULA_SHADOW_CELL_STEP,
  nebulaFieldScales,
  planNebulaBake,
  solveNebulaIonization,
  type NebulaBakeFields,
  type NebulaBakePlan,
  type NebulaVolumeBake,
} from '../../universe/galaxy/nebulaVolume';
import { glslFloat as f } from '../glsl/format';
import { NebulaBakeStorage, nebulaStorageLayout } from './nebulaBakeStorage';
import { NebulaGasAccumulator } from '../../universe/galaxy/nebulaGasInventory';
import { CONTINUUM_FRAGMENT } from './nebulaContinuumGlsl';
import { CONTINUUM_SIZE, continuumSources, encodeContinuum } from '../../universe/galaxy/nebulaContinuum';
import { DUST_OPACITY_PER_PC } from '../../universe/galaxy/density';
import { NebulaAtlasReadback } from './nebulaReadback';

/** GPU natal-field sampling, followed by the shared CPU material
 * remap, photon transport and final-dust attenuation. The GPU path
 * evaluates the same initial field; it does not impose a separate
 * expansion, shell boost or untracked density loss. */
export interface NebulaGpuBaker {
  /** Retained working-texture payload; excludes displayed volumes and driver overhead. */
  readonly storageBytes: number;
  readonly readbackBytes: number;
  /** Sample natal gas/dust; motion and transport follow in shared code. */
  sample(plan: NebulaBakePlan): NebulaBakeFields;
  /** Trace continuum through the final dust, reusing the working textures. */
  attenuate(plan: NebulaBakePlan, fields: NebulaBakeFields): void;
  bake(
    cloud: MolecularCloud,
    nebula: Nebula | null,
    size: number,
    boxRequestPc?: number,
  ): NebulaVolumeBake;
  dispose(): void;
}

const VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** One z-layer of the natal field: cloudFineDensity's envelope, cascade
 *  and carve, leaving the per-cloud amplitude to the march's scales. */
const FIELD_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform float uLayer;
uniform float uCellPc;
uniform float uBoxPc;
uniform vec3 uOriginPc;
uniform vec3 uInvStretch;
uniform float uRadiusPc;
uniform float uSeedOffset;
out float outCarve;
${SEEDED_NOISE}
${carveFunctionGlsl('fineCarve', TURBULENCE_OCTAVES.length)}
void main() {
  vec3 posPc = vec3(gl_FragCoord.xy, uLayer + 0.5) * uCellPc - uBoxPc + uOriginPc;
  outCarve = fineCarve(posPc, uInvStretch, uRadiusPc, uSeedOffset);
}
`;

/** The per-cell walk of marchNebulaCpu, one fragment per cell, the
 *  volume's layers tiled across a 2D atlas. */
const MARCH_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
uniform sampler3D uField;
uniform int uSize;
uniform int uCols;
uniform float uGasScale;
uniform float uDustScale;
out vec4 outCell;
void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  ivec2 tile = pixel / uSize;
  int layer = tile.y * uCols + tile.x;
  if (layer >= uSize) { outCell = vec4(0.0); return; }
  float carve = texelFetch(uField, ivec3(pixel % uSize, layer), 0).r;
  float n = carve * uGasScale;
  outCell = vec4(carve * uDustScale, n, n, 1.0);
}
`;

const SHADOW_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
uniform sampler3D uField;
uniform int uSize;
uniform int uCols;
uniform float uBoxPc;
uniform float uCellPc;
uniform float uDustRef;
uniform vec3 uSourcePc;
out vec4 outCell;
void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy), tile = pixel / uSize;
  int layer = tile.y * uCols + tile.x;
  if (layer >= uSize) { outCell = vec4(0.0); return; }
  vec3 p = (vec3(pixel % uSize, layer) + 0.5) * uCellPc - uBoxPc;
  vec3 delta = p - uSourcePc;
  float entry = 0.0;
  for (int axis = 0; axis < 3; axis++) {
    if (abs(uSourcePc[axis]) > uBoxPc) {
      entry = max(entry, ((uSourcePc[axis] < 0.0 ? -uBoxPc : uBoxPc) - uSourcePc[axis]) / delta[axis]);
    }
  }
  float path = length(delta) * (1.0 - entry);
  int steps = min(${NEBULA_SHADOW_STEPS}, max(1, int(ceil(path / (${f(NEBULA_SHADOW_CELL_STEP)} * uCellPc)))));
  float tau = 0.0;
  for (int step = 0; step < ${NEBULA_SHADOW_STEPS}; step++) {
    if (step >= steps) break;
    float t = entry + (1.0 - entry) * (float(step) + 0.5) / float(steps);
    vec3 pos = uSourcePc + delta * t;
    tau += texture(uField, (pos + uBoxPc) / (2.0 * uBoxPc)).r * uDustRef
      * ${f(DUST_OPACITY_PER_PC)} * path / float(steps);
    if (tau > 20.0) break;
  }
  outCell = vec4(0.0, 0.0, 0.0, exp(-tau));
}
`;

function compile(gl: WebGL2RenderingContext, kind: number, source: string): WebGLShader {
  const shader = gl.createShader(kind);
  if (!shader) throw new Error('shader allocation failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed');
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, fragment: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('program allocation failed');
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
  }
  return program;
}

/**
 * A baker over a fresh WebGL2 context, or null where one cannot stand
 * (no OffscreenCanvas, no float render targets) — the caller falls
 * back to the CPU march. Programs and the permutation live for the
 * baker's life; the volume-sized textures for a bake's only.
 */
export function createNebulaGpuBaker(): NebulaGpuBaker | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const gl = new OffscreenCanvas(1, 1).getContext('webgl2', {
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
  });
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null;
  let fieldProgram: WebGLProgram;
  let marchProgram: WebGLProgram;
  let shadowProgram: WebGLProgram;
  let continuumProgram: WebGLProgram;
  try {
    fieldProgram = link(gl, FIELD_FRAGMENT);
    marchProgram = link(gl, MARCH_FRAGMENT);
    shadowProgram = link(gl, SHADOW_FRAGMENT);
    continuumProgram = link(gl, CONTINUUM_FRAGMENT);
  } catch (error) {
    console.warn('nebula GPU bake unavailable:', error);
    return null;
  }
  // Programs are linked once for this baker's life. Repeating location
  // queries on every grid synchronizes with the driver unnecessarily.
  const locations = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  const at = (program: WebGLProgram, name: string): WebGLUniformLocation | null => {
    let names = locations.get(program);
    if (!names) { names = new Map(); locations.set(program, names); }
    if (!names.has(name)) names.set(name, gl.getUniformLocation(program, name));
    return names.get(name)!;
  };
  const framebuffer = gl.createFramebuffer();
  const readback = new NebulaAtlasReadback(gl);
  let permTexture: WebGLTexture | null = null;
  // Reuse within 80 MiB per worker. A 160³ working set fits; stale
  // intermediate grades cannot accumulate beside it indefinitely.
  const storage = new NebulaBakeStorage(80 << 20, (size: number) => {
    const field = gl.createTexture();
    if (!field) throw new Error('nebula field allocation failed');
    gl.bindTexture(gl.TEXTURE_3D, field);
    gl.texStorage3D(gl.TEXTURE_3D, 1, gl.R16F, size, size, size);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_3D, null);
    const { cols, rows } = nebulaStorageLayout(size);
    const atlas = gl.createTexture();
    if (!atlas) { gl.deleteTexture(field); throw new Error('nebula atlas allocation failed'); }
    gl.bindTexture(gl.TEXTURE_2D, atlas);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, cols * size, rows * size);
    gl.bindTexture(gl.TEXTURE_2D, null);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      gl.deleteTexture(field); gl.deleteTexture(atlas);
      throw new Error(`nebula storage allocation GL error ${error}`);
    }
    return { field, atlas, cols, rows };
  }, ({ field, atlas }) => { gl.deleteTexture(field); gl.deleteTexture(atlas); });

  const sample = (plan: NebulaBakePlan): NebulaBakeFields => {
    if (gl.isContextLost()) throw new Error('context lost');
    const { cloud, size } = plan;
    const scales = nebulaFieldScales(plan);

    // The galaxy's one shape permutation, uploaded on first use — the
    // seed is locked for the session, so it never changes under us.
    if (!permTexture) {
      permTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, permTexture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8UI, 512, 1);
      gl.texSubImage2D(
        gl.TEXTURE_2D, 0, 0, 0, 512, 1, gl.RED_INTEGER, gl.UNSIGNED_BYTE,
        cloudShapePermutation(),
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }

    // The natal field, layer by layer. Half floats hold the carve
    // comfortably — it is dimensionless and order unity.
    // Deleted textures can remain alive while attached to an FBO.
    // Detach before reserving/evicting, not after the new allocation.
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    const { field: fieldTexture, atlas: atlasTexture, cols, rows } = storage.acquire(size);

    gl.useProgram(fieldProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, permTexture);
    gl.uniform1i(at(fieldProgram, 'uPerm'), 0);
    gl.uniform1f(at(fieldProgram, 'uCellPc'), plan.cellPc);
    gl.uniform1f(at(fieldProgram, 'uBoxPc'), plan.boxPc);
    gl.uniform3fv(at(fieldProgram, 'uOriginPc'), plan.originPc);
    const stretch = cloudStretch(cloud);
    const invStretch: [number, number, number] = [1, 1, 1];
    invStretch[cloudStretchAxis(cloud)] = 1 / stretch;
    gl.uniform3fv(at(fieldProgram, 'uInvStretch'), invStretch);
    gl.uniform1f(at(fieldProgram, 'uRadiusPc'), cloud.radiusPc);
    gl.uniform1f(at(fieldProgram, 'uSeedOffset'), Number(cloud.seed & 0xffn));
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, size, size);
    const layerLocation = at(fieldProgram, 'uLayer');
    for (let layer = 0; layer < size; layer++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, fieldTexture, 0, layer);
      gl.uniform1f(layerLocation, layer);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // Read the natal field in physical units, tiled onto one atlas.
    gl.useProgram(marchProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, fieldTexture);
    gl.uniform1i(at(marchProgram, 'uField'), 0);
    gl.uniform1i(at(marchProgram, 'uSize'), size);
    gl.uniform1i(at(marchProgram, 'uCols'), cols);
    gl.uniform1f(at(marchProgram, 'uGasScale'), scales.gasScale);
    gl.uniform1f(at(marchProgram, 'uDustScale'), scales.dustScale);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, atlasTexture, 0);
    // One draw for the whole atlas. Slicing it per layer with a flush
    // between — yield points for the frame renderer sharing this GPU —
    // was measured at thirty times the cost: each flush is a command
    // buffer submission, and a worker context's submissions wait.
    gl.viewport(0, 0, cols * size, rows * size);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Batch readbacks within a fixed scratch budget, then de-tile into
    // the same fields as the CPU march. Small grids need one driver
    // round trip; near grids still avoid a seventy-megabyte CPU atlas.
    const cells = size ** 3;
    const inventory = new NebulaGasAccumulator(plan.cellPc, plan.inventoryExclusion);
    const fields: NebulaBakeFields = {
      dust: new Float32Array(cells),
      hydrogen: new Float32Array(cells),
      ionized: new Float32Array(cells),
      hardness: new Float32Array(cells),
      transmittance: new Float32Array(cells),
    };
    const atlasWidth = cols * size;
    readback.readRows(size, cols, rows, (tileRow, strip) => {
      for (let column = 0; column < cols; column++) {
        const k = tileRow * cols + column;
        if (k >= size) break;
        const tileX = column * size;
        for (let j = 0; j < size; j++) {
          const row = (j * atlasWidth + tileX) * 4;
          const out = (k * size + j) * size;
          for (let i = 0; i < size; i++) {
            fields.dust[out + i] = strip[row + i * 4];
            fields.hydrogen[out + i] = strip[row + i * 4 + 1];
            inventory.add(i, j, k, strip[row + i * 4 + 2], fields.hydrogen[out + i]);
            fields.transmittance[out + i] = strip[row + i * 4 + 3];
          }
        }
      }
    });
    gl.bindTexture(gl.TEXTURE_3D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`GL error ${error}`);
    fields.gasInventory = inventory.finish();
    return fields;
  };

  const attenuate = (plan: NebulaBakePlan, fields: NebulaBakeFields): void => {
    if (gl.isContextLost()) throw new Error('context lost');
    let dustRef = 0;
    for (const dust of fields.dust) dustRef = Math.max(dustRef, dust);
    if (plan.scatterLuminositySolar <= 0) { fields.transmittance.fill(1); return; }
    const { size } = plan;
    // Normalize into the existing output array before uploading. No
    // additional 3D CPU array or GPU texture is retained for shadows.
    for (let i = 0; i < fields.dust.length; i++) fields.transmittance[i] = fields.dust[i] / (dustRef || 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    const { field, atlas, cols, rows } = storage.acquire(size);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, field);
    gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, size, size, size, gl.RED, gl.FLOAT, fields.transmittance);
    if (!plan.continuumSources?.length) {
    gl.useProgram(shadowProgram);
    gl.uniform1i(at(shadowProgram, 'uField'), 0);
    gl.uniform1i(at(shadowProgram, 'uSize'), size);
    gl.uniform1i(at(shadowProgram, 'uCols'), cols);
    gl.uniform1f(at(shadowProgram, 'uBoxPc'), plan.boxPc);
    gl.uniform1f(at(shadowProgram, 'uCellPc'), plan.cellPc);
    gl.uniform1f(at(shadowProgram, 'uDustRef'), dustRef);
    gl.uniform3fv(at(shadowProgram, 'uSourcePc'), plan.scatterSourcePc);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, atlas, 0);
    gl.viewport(0, 0, cols * size, rows * size);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const width = cols * size;
    readback.readRows(size, cols, rows, (tileRow, strip) => {
      for (let column = 0; column < cols; column++) {
        const k = tileRow * cols + column;
        if (k >= size) break;
        for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
          fields.transmittance[(k * size + j) * size + i] = strip[(j * width + column * size + i) * 4 + 3];
        }
      }
    });
    }
    if (plan.continuumSources?.length) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, atlas, 0);
      const grid = { ...plan, sources: plan.continuumSources }, sources = continuumSources(grid);
      const lightSize = Math.min(CONTINUUM_SIZE, size), lightCols = Math.ceil(Math.sqrt(2 * lightSize));
      const lightRows = Math.ceil(2 * lightSize / lightCols), lightWidth = lightCols * lightSize;
      const sourceData = new Float32Array(Math.max(1, sources.length) * 8);
      sources.forEach((source, i) => sourceData.set([
        ...source.positionPc.map((p, axis) => p - plan.originPc[axis]), source.luminositySolar,
        ...source.color, 0,
      ], i * 8));
      const sourceTexture = gl.createTexture();
      if (!sourceTexture) throw new Error('continuum source allocation failed');
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 2, Math.max(1, sources.length));
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 2, Math.max(1, sources.length), gl.RGBA, gl.FLOAT, sourceData);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      // The paired continuum slabs fit the already reserved RGBA32F
      // atlas for production grades (48,96,160). Tiny test grades use
      // a short-lived target and account for it in their audit.
      let lightAtlas: WebGLTexture | null = null;
      if (lightWidth > cols * size || lightRows * lightSize > rows * size) {
        lightAtlas = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, lightAtlas);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, lightWidth, lightRows * lightSize);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lightAtlas, 0);
      }
      try {
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
        gl.useProgram(continuumProgram);
        gl.uniform1i(at(continuumProgram, 'uField'), 0); gl.uniform1i(at(continuumProgram, 'uSources'), 1);
        gl.uniform1i(at(continuumProgram, 'uSourceCount'), sources.length);
        gl.uniform1i(at(continuumProgram, 'uSize'), lightSize); gl.uniform1i(at(continuumProgram, 'uCols'), lightCols);
        gl.uniform1f(at(continuumProgram, 'uBoxPc'), plan.boxPc); gl.uniform1f(at(continuumProgram, 'uCellPc'), plan.cellPc);
        gl.uniform1f(at(continuumProgram, 'uDustRef'), dustRef);
        gl.viewport(0, 0, lightWidth, lightRows * lightSize); gl.drawArrays(gl.TRIANGLES, 0, 3);
        const raw = new Float32Array(lightSize ** 3 * 8);
        readback.readRows(lightSize, lightCols, lightRows, (row, pixels) => {
          for (let col = 0; col < lightCols; col++) {
            const layer = row * lightCols + col;
            if (layer >= 2 * lightSize) break;
            for (let j = 0; j < lightSize; j++) {
              const from = (j * lightWidth + col * lightSize) * 4;
              raw.set(pixels.subarray(from, from + lightSize * 4), (layer * lightSize + j) * lightSize * 4);
            }
          }
        });
        fields.continuum = encodeContinuum(grid, sources, raw);
        fields.transmittance.fill(1);
      } finally {
        gl.bindTexture(gl.TEXTURE_2D, null); gl.deleteTexture(sourceTexture);
        if (lightAtlas) { gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, atlas, 0); gl.deleteTexture(lightAtlas); }
        gl.activeTexture(gl.TEXTURE0);
      }
    }
    gl.bindTexture(gl.TEXTURE_3D, null); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`nebula shadow GL error ${error}`);
  };

  return {
    sample,
    attenuate,
    bake(cloud, nebula, size, boxRequestPc) {
      const plan = planNebulaBake(cloud, nebula, size, boxRequestPc);
      const fields = evolveNebulaGas(plan, sample(plan));
      attenuate(plan, fields);
      return finishNebulaBake(plan, solveNebulaIonization(plan, fields));
    },
    get storageBytes() { return storage.bytes; },
    get readbackBytes() { return readback.bytes; },
    dispose: () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
      storage.dispose();
      readback.dispose();
      gl.deleteFramebuffer(framebuffer);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
