import {
  TURBULENCE_OCTAVES,
  cloudShapePermutation,
  cloudStretch,
  cloudStretchAxis,
  type MolecularCloud,
} from '../../universe/galaxy/clouds';
import { carveFunctionGlsl, SEEDED_NOISE } from './cloudFieldGlsl';
import {
  DUST_DEPLETION,
  SHELL_SKIN_SHARE,
  SHELL_WIDTH,
  VENT_RESIDUAL,
  WIND_CAVITY_RESIDUAL,
  WIND_REACH,
  WIND_STALL,
  WIND_WALL_BOOST,
  WIND_WALL_WIDTH,
} from '../../universe/galaxy/ionization';
import type { Nebula } from '../../universe/galaxy/nebula';
import {
  EROSION_REACH,
  EROSION_STALL,
  FRONT_SOFTNESS,
  LOG_U_MAX,
  LOG_U_MIN,
  SCATTER_MAX_STEPS,
  SCATTER_STEP_FACTOR,
  finishNebulaBake,
  nebulaMarchScales,
  planNebulaBake,
  type NebulaBakeFields,
  type NebulaVolumeBake,
} from '../../universe/galaxy/nebulaVolume';
import { glslFloat as f } from '../glsl/format';

/**
 * The nebula bake rendered instead of computed: the same field, the
 * same walk, on whatever GPU the worker's OffscreenCanvas reaches.
 * Independent cells, a smooth field, texture-shaped sampling — the
 * work was fragment-shaped all along, and seconds of CPU become
 * milliseconds here.
 *
 * The CPU march stays the physics authority; this is a renderer of it.
 * Every constant is read from the model's own exports and every scale
 * arrives through nebulaMarchScales, folded into order-unity ratios in
 * doubles first, because the raw factors overflow the 32-bit floats a
 * shader runs on. The field texture holds the dimensionless carve and
 * leaves the per-cloud scale to a uniform for the same reason. Output
 * comes home a strip of tiles at a time as float grids and goes
 * through the shared finish, so the quantization and the emission
 * books are the CPU path's own.
 */
export interface NebulaGpuBaker {
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
uniform float uBoxPc;
uniform float uCellPc;
uniform vec3 uIonizePc;
uniform float uGrowth;
uniform float uDilution;
uniform float uShellBoost;
uniform float uStepPc;
uniform float uReachLimitPc;
uniform float uBudgetOn;
uniform float uRecombFrac;
uniform float uTauScale;
uniform float uGasScale;
uniform float uDustScale;
uniform float uFluxScale;
uniform vec3 uScatterSourcePc;
uniform float uScatterOn;
uniform float uWindCavityPc;
uniform float uWindPivotCarve;
uniform float uVentConfineCarve;
uniform float uErosionPivotCarve;
out vec4 outCell;

float fieldAt(vec3 posPc) {
  return textureLod(uField, (posPc + uBoxPc) / (2.0 * uBoxPc), 0.0).r;
}

void main() {
  ivec2 fc = ivec2(gl_FragCoord.xy);
  ivec2 tile = fc / uSize;
  int layer = tile.y * uCols + tile.x;
  if (layer >= uSize) { outCell = vec4(0.0); return; }
  ivec3 cell = ivec3(fc - tile * uSize, layer);
  vec3 x = vec3(cell) * uCellPc + 0.5 * uCellPc - uBoxPc;

  vec3 d = x - uIonizePc;
  float dist = max(length(d), 1e-4);
  bool reachable = uBudgetOn > 0.5 && dist < uReachLimitPc;
  vec3 dir = d / dist;

  float recombined = 0.0;
  float tau = 0.0;
  float frontR = -1.0;
  if (reachable) {
    int steps = max(1, int(ceil(dist / uStepPc)));
    float ds = dist / float(steps);
    for (int s = 0; s < 512; s++) {
      if (s >= steps) break;
      float r = (float(s) + 0.5) * ds;
      if (frontR < 0.0) {
        float rn = r / uGrowth;
        float carve = fieldAt(uIonizePc + dir * rn);
        recombined += carve * carve * uRecombFrac * rn * rn * (ds / uGrowth);
        if (recombined >= 1.0) frontR = r;
        tau += carve * uDilution * uTauScale * ds * ${f(1 / DUST_DEPLETION)};
      } else {
        float swept = r <= frontR * ${f(1 + SHELL_WIDTH)} ? uShellBoost : 1.0;
        tau += fieldAt(uIonizePc + dir * r) * swept * uTauScale * ds;
      }
    }
  } else if (uScatterOn > 0.5) {
    vec3 sd = x - uScatterSourcePc;
    float shine = max(length(sd), 1e-4);
    int coarse = clamp(
      int(ceil(shine / ${f(SCATTER_STEP_FACTOR)} / uStepPc)), 1, ${SCATTER_MAX_STEPS});
    float coarseDs = shine / float(coarse);
    for (int s = 0; s < ${SCATTER_MAX_STEPS}; s++) {
      if (s >= coarse) break;
      float r = (float(s) + 0.5) * coarseDs / shine;
      tau += fieldAt(uScatterSourcePc + sd * r) * uTauScale * coarseDs;
    }
  }

  float spent = reachable ? recombined : 2.0;
  // The eroded front and its ionized skin, mirroring the CPU march:
  // the mean front modulated by the uncontracted ambient at its own
  // radius, the rim glowing along the eroded shape, the skin never
  // thinner than a cell.
  float frontLoc = frontR;
  if (frontR >= 0.0 && uErosionPivotCarve > 0.0) {
    float ambient = fieldAt(uIonizePc + dir * frontR);
    frontLoc = frontR * clamp(
      pow(uErosionPivotCarve / max(1e-9, ambient), ${f(1 / 3)}),
      ${f(EROSION_STALL)}, ${f(EROSION_REACH)});
  }
  float skin = frontR >= 0.0
    ? (dist <= frontLoc
        ? 1.0
        : exp(-(dist - frontLoc) /
            max(uCellPc, ${f(SHELL_SKIN_SHARE * SHELL_WIDTH)} * frontLoc)))
    : 0.0;
  float ionized = max(skin, clamp((1.0 - spent) * ${f(1 / FRONT_SOFTNESS)}, 0.0, 1.0));
  float transmittance = exp(-tau);
  bool inBubble = reachable && frontR < 0.0;
  bool inShell =
    frontR >= 0.0 && dist > frontLoc && dist <= frontLoc * ${f(1 + SHELL_WIDTH)};
  float carveHere = inBubble
    ? fieldAt(uIonizePc + dir * (dist / uGrowth)) * uDilution
    : texelFetch(uField, cell, 0).r * (inShell ? uShellBoost : 1.0);
  // The wind's re-plumbing and the champagne gate, mirroring the CPU
  // march: an optically empty cavity, a swept wall carrying the
  // ploughed-out mass, and streaming loss wherever the natal field at
  // this cell is too thin to confine the hot interior.
  if (inBubble) {
    float confinement = uVentConfineCarve > 0.0
      ? clamp(texelFetch(uField, cell, 0).r / uVentConfineCarve, ${f(VENT_RESIDUAL)}, 1.0)
      : 1.0;
    float cavity = uWindCavityPc;
    if (cavity > 0.0 && uWindPivotCarve > 0.0) {
      float ploughed = fieldAt(uIonizePc + dir * (cavity / uGrowth));
      cavity *= clamp(
        pow(uWindPivotCarve / max(1e-9, ploughed), 0.25), ${f(WIND_STALL)}, ${f(WIND_REACH)});
    }
    carveHere *= confinement * (dist < cavity
      ? ${f(WIND_CAVITY_RESIDUAL)}
      : (dist <= cavity * ${f(1 + WIND_WALL_WIDTH)} ? ${f(WIND_WALL_BOOST)} : 1.0));
  }
  float n = carveHere * uGasScale;
  float uParam = uBudgetOn > 0.5 && n > 0.0
    ? uFluxScale * transmittance / (dist * dist * n)
    : 0.0;
  float hardness = uParam > 0.0
    ? clamp(
        (log(uParam) * ${f(1 / Math.LN10)} - ${f(LOG_U_MIN)}) * ${f(1 / (LOG_U_MAX - LOG_U_MIN))},
        0.0, 1.0)
    : 0.0;
  outCell = vec4(
    carveHere * uDustScale / (1.0 + ${f(DUST_DEPLETION - 1)} * ionized),
    n * ionized,
    hardness,
    transmittance);
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
  try {
    fieldProgram = link(gl, FIELD_FRAGMENT);
    marchProgram = link(gl, MARCH_FRAGMENT);
  } catch (error) {
    console.warn('nebula GPU bake unavailable:', error);
    return null;
  }
  const at = (program: WebGLProgram, name: string): WebGLUniformLocation | null =>
    gl.getUniformLocation(program, name);
  const framebuffer = gl.createFramebuffer();
  let permTexture: WebGLTexture | null = null;
  // Storage is immutable once allocated, so a grid's field and atlas
  // textures are made once per size and kept for the baker's life: a
  // residency of the same-sized bakes reuses them instead of
  // allocating and freeing tens of megabytes of GPU memory each.
  const storage = new Map<number, { field: WebGLTexture; atlas: WebGLTexture; cols: number; rows: number }>();
  const texturesFor = (size: number): { field: WebGLTexture; atlas: WebGLTexture; cols: number; rows: number } => {
    const kept = storage.get(size);
    if (kept) return kept;
    const field = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, field);
    gl.texStorage3D(gl.TEXTURE_3D, 1, gl.R16F, size, size, size);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_3D, null);
    const cols = Math.ceil(Math.sqrt(size));
    const rows = Math.ceil(size / cols);
    const atlas = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, atlas);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, cols * size, rows * size);
    gl.bindTexture(gl.TEXTURE_2D, null);
    const made = { field, atlas, cols, rows };
    storage.set(size, made);
    return made;
  };

  const bake = (
    cloud: MolecularCloud,
    nebula: Nebula | null,
    size: number,
    boxRequestPc?: number,
  ): NebulaVolumeBake => {
    if (gl.isContextLost()) throw new Error('context lost');
    const plan = planNebulaBake(cloud, nebula, size, boxRequestPc);
    const scales = nebulaMarchScales(plan);

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
    const { field: fieldTexture, atlas: atlasTexture, cols, rows } = texturesFor(size);

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

    // The march, every cell at once, layers tiled onto one atlas.
    gl.useProgram(marchProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, fieldTexture);
    gl.uniform1i(at(marchProgram, 'uField'), 0);
    gl.uniform1i(at(marchProgram, 'uSize'), size);
    gl.uniform1i(at(marchProgram, 'uCols'), cols);
    gl.uniform1f(at(marchProgram, 'uBoxPc'), plan.boxPc);
    gl.uniform1f(at(marchProgram, 'uCellPc'), plan.cellPc);
    gl.uniform3fv(at(marchProgram, 'uIonizePc'), plan.ionizePc);
    gl.uniform1f(at(marchProgram, 'uGrowth'), plan.growth);
    gl.uniform1f(at(marchProgram, 'uDilution'), plan.dilution);
    gl.uniform1f(at(marchProgram, 'uShellBoost'), plan.shellBoost);
    gl.uniform1f(at(marchProgram, 'uStepPc'), plan.stepPc);
    gl.uniform1f(at(marchProgram, 'uReachLimitPc'), plan.reachLimitPc);
    gl.uniform1f(at(marchProgram, 'uBudgetOn'), plan.budget > 0 ? 1 : 0);
    gl.uniform1f(at(marchProgram, 'uRecombFrac'), scales.recombFrac);
    gl.uniform1f(at(marchProgram, 'uTauScale'), scales.tauScale);
    gl.uniform1f(at(marchProgram, 'uGasScale'), scales.gasScale);
    gl.uniform1f(at(marchProgram, 'uDustScale'), scales.dustScale);
    gl.uniform1f(at(marchProgram, 'uFluxScale'), scales.fluxScale);
    gl.uniform3fv(at(marchProgram, 'uScatterSourcePc'), plan.scatterSourcePc);
    gl.uniform1f(at(marchProgram, 'uScatterOn'), plan.scatterLuminositySolar > 0 ? 1 : 0);
    gl.uniform1f(at(marchProgram, 'uWindCavityPc'), plan.windCavityPc);
    gl.uniform1f(
      at(marchProgram, 'uWindPivotCarve'),
      plan.windPivotDensity > 0 ? plan.windPivotDensity / scales.gasScale : 0,
    );
    gl.uniform1f(
      at(marchProgram, 'uVentConfineCarve'),
      plan.ventConfineDensity > 0 ? plan.ventConfineDensity / scales.gasScale : 0,
    );
    gl.uniform1f(
      at(marchProgram, 'uErosionPivotCarve'),
      plan.erosionPivotDensity > 0 ? plan.erosionPivotDensity / scales.gasScale : 0,
    );
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, atlasTexture, 0);
    // One draw for the whole atlas. Slicing it per layer with a flush
    // between — yield points for the frame renderer sharing this GPU —
    // was measured at thirty times the cost: each flush is a command
    // buffer submission, and a worker context's submissions wait.
    gl.viewport(0, 0, cols * size, rows * size);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Home one row of tiles at a time, de-tiled straight into the same
    // grids the CPU march hands over: the readback buffer is a strip a
    // tile high rather than the whole atlas — a near-grade grid's atlas
    // is seventy megabytes of floats, and the fields it fills are as
    // large again.
    const cells = size ** 3;
    const fields: NebulaBakeFields = {
      dust: new Float32Array(cells),
      ionized: new Float32Array(cells),
      hardness: new Float32Array(cells),
      transmittance: new Float32Array(cells),
    };
    const atlasWidth = cols * size;
    const strip = new Float32Array(atlasWidth * size * 4);
    for (let tileRow = 0; tileRow < rows; tileRow++) {
      gl.readPixels(0, tileRow * size, atlasWidth, size, gl.RGBA, gl.FLOAT, strip);
      for (let column = 0; column < cols; column++) {
        const k = tileRow * cols + column;
        if (k >= size) break;
        const tileX = column * size;
        for (let j = 0; j < size; j++) {
          const row = (j * atlasWidth + tileX) * 4;
          const out = (k * size + j) * size;
          for (let i = 0; i < size; i++) {
            fields.dust[out + i] = strip[row + i * 4];
            fields.ionized[out + i] = strip[row + i * 4 + 1];
            fields.hardness[out + i] = strip[row + i * 4 + 2];
            fields.transmittance[out + i] = strip[row + i * 4 + 3];
          }
        }
      }
    }
    gl.bindTexture(gl.TEXTURE_3D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`GL error ${error}`);
    return finishNebulaBake(plan, fields);
  };

  return {
    bake,
    dispose: () => {
      for (const { field, atlas } of storage.values()) {
        gl.deleteTexture(field);
        gl.deleteTexture(atlas);
      }
      storage.clear();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
