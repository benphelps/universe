import { FIELD_SELECTION_GLSL } from '../glsl/fieldSelection';
import { fieldSelectionData,fieldSelectionScales,fieldSelectionRows,SELECTION_WIDTH,SELECTION_HEIGHT } from '../../universe/galaxy/fieldSelection';
import { neighborRadiusPc } from '../../universe/galaxy/neighborhood';
import { CONTINUUM_SAMPLE_GLSL } from './nebulaContinuumGlsl';
import { packContinuumPair } from '../../universe/galaxy/nebulaContinuum';
import { createNebulaGpuBaker } from './nebulaBakeGpu';
import { bakeNebulaPair } from '../../universe/galaxy/nebulaPair';
import { GALAXY_COMPONENT_GLSL, galaxyComponentUniforms } from '../glsl/galaxyComponents';
import { CELL_TRANSFER_GLSL } from '../../core/physics/radiativeTransfer';
import {
  ARM_LUT_RADIUS_MAX_PC,
  ARM_LUT_RADIUS_MIN_PC,
  ARM_LUT_SIZE,
  bakeArmLut,
} from '../../universe/galaxy/armLut';
import {
  CARVE_GAIN,
  cloudDustFactor,
  cloudReachPc,
  cloudShapePermutation,
  cloudStretch,
  cloudStretchAxis,
  expectedCloudField,
  type MolecularCloud,
} from '../../universe/galaxy/clouds';
import {
  DUST_OPACITY_PER_PC,
  SMOOTH_MODEL,
  type GalacticPosition,
} from '../../universe/galaxy/density';
import { galaxySeed } from '../../universe/galaxy/galaxySeed';
import { nebulaPortrait, nebulaPortraitPhotometry } from '../../universe/galaxy/nebulaPortrait';
import { SCATTER_EMISSIVITY_PER_LSUN } from '../../universe/galaxy/nebulaVolume';
import {
  DARK_ATLAS_COLS,
  DARK_ATLAS_ROWS,
  DARK_TILE,
  DUST_KAPPA,
  GLOW_HEIGHT,
  GLOW_WIDTH,
  NEBULA_ATLAS_COLS,
  NEBULA_ATLAS_ROWS,
  NEBULA_TILE,
  NEBULA_TILE_MAX_STEPS,
  RIFT_HEIGHT,
  RIFT_NEAR_PC,
  RIFT_WIDTH,
  type DarkTileJob,
  type NebulaTileJob,
  type SkyMapBaker,
} from '../../universe/galaxy/skyfield';
import { glslFloat as f } from '../glsl/format';
import { carveFunctionGlsl, SEEDED_NOISE } from './cloudFieldGlsl';

/**
 * The sky's background maps rendered instead of computed: the Milky
 * Way glow, the rift transmission map and the dark-cloud tiles are
 * each a per-pixel line integral of a deterministic field — the
 * smooth galaxy model and the seeded cloud carve — which is exactly
 * the shape a fragment shader is. The CPU builders in
 * universe/galaxy/skyfield stay the authority and the fallback; these
 * mirror them step for step, reading the same constants, so that a
 * sky lands in tens of milliseconds where it took seconds.
 *
 * The arm profile enters through the model's own polar LUT rather
 * than the orbit-family solve, read with a bilinear fetch by hand on a
 * float texture so no filtering extension is needed.
 */

const VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

const LOG_SPAN = Math.log(ARM_LUT_RADIUS_MAX_PC / ARM_LUT_RADIUS_MIN_PC);

/** armProfile off the LUT: azimuth across (wrapping), log radius down
 *  (clamped), bilinear between texel centres. */
const ARM_LUT_GLSL = `
uniform sampler2D uArmLut;
vec2 armProfile(float radiusPc, float azimuthRad) {
  if (radiusPc < ${f(SMOOTH_MODEL.waveMinRadiusPc)}) return vec2(0.0);
  float row = (log(radiusPc / ${f(ARM_LUT_RADIUS_MIN_PC)}) / ${f(LOG_SPAN)}) * ${f(ARM_LUT_SIZE)} - 0.5;
  row = clamp(row, 0.0, ${f(ARM_LUT_SIZE - 1)});
  float az = azimuthRad;
  if (az < 0.0) az += 6.283185307179586;
  float col = (az / 6.283185307179586) * ${f(ARM_LUT_SIZE)} - 0.5;
  if (col < 0.0) col += ${f(ARM_LUT_SIZE)};
  int r0 = int(floor(row));
  int r1 = min(r0 + 1, ${ARM_LUT_SIZE - 1});
  int c0 = int(floor(col)) % ${ARM_LUT_SIZE};
  int c1 = (c0 + 1) % ${ARM_LUT_SIZE};
  float fr = row - floor(row);
  float fc = col - floor(col);
  vec2 a = mix(texelFetch(uArmLut, ivec2(c0, r0), 0).rg, texelFetch(uArmLut, ivec2(c1, r0), 0).rg, fc);
  vec2 b = mix(texelFetch(uArmLut, ivec2(c0, r1), 0).rg, texelFetch(uArmLut, ivec2(c1, r1), 0).rg, fc);
  return mix(a, b, fr);
}
`;

/** buildGlow, one fragment per texel of the lat–long map. */
const GLOW_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform vec3 uViewPc;
uniform float uCloudFieldPerDust;
out vec4 outGlow;
${ARM_LUT_GLSL}
${CELL_TRANSFER_GLSL}
${GALAXY_COMPONENT_GLSL}
${FIELD_SELECTION_GLSL}
void main() {
  vec2 texel = gl_FragCoord.xy;
  float latitude = (texel.y / ${f(GLOW_HEIGHT)} - 0.5) * 3.141592653589793;
  float longitude = (texel.x / ${f(GLOW_WIDTH)}) * 6.283185307179586;
  vec3 dir = vec3(cos(latitude) * cos(longitude), cos(latitude) * sin(longitude), sin(latitude));
  vec3 light = vec3(0.0);
  vec3 transmission = vec3(1.0);
  float s = 0.0;
  for (int i = 0; i < 112; i++) {
    if (s >= 25000.0) break;
    float stepPc = min(25000.0 - s, (s < 180.0 ? 5.0 : max(30.0, s * 0.11)));
    float midpoint = s + 0.5 * stepPc;
    vec3 p = uViewPc + dir * midpoint;
    float radius = length(p.xy);
    float absZ = abs(p.z);
    vec2 arm = armProfile(radius, atan(p.y, p.x));
    float dust = exp(-radius / ${f(SMOOTH_MODEL.dustScaleLengthPc)}) *
      exp(-absZ / ${f(SMOOTH_MODEL.dustScaleHeightPc)}) * (1.0 + ${f(SMOOTH_MODEL.dustLaneWeight)} * arm.y);
    float armBoost = 1.0 + arm.x;
    float clump = midpoint > ${f(RIFT_NEAR_PC)}
      ? 0.45 + 1.6 * uCloudFieldPerDust * dust * (0.4 + 0.6 * armBoost)
      : 0.45;
    float depth = dust * clump * ${f(DUST_KAPPA)} * stepPc;
    vec3 cellDepth = depth * GALAXY_DUST_RGB;
    vec3 cellThrough = exp(-cellDepth);
    vec3 counts = galaxyFieldDensity(p / 1000.0);
    counts.x *= armBoost;
    vec3 emission = unresolvedFieldEmission(vec4(counts,galaxyBulgeDensity(p/1000.0)),midpoint);
    light += emission * stepPc *
      transmission * cellEmissionWeight(cellDepth, cellThrough);
    transmission *= cellThrough;
    s += stepPc;
  }
  outGlow = vec4(light / 12.566370614359172, 1.0);
}
`;

/** Per-cloud rows of a float texture: what a march through one cloud
 *  needs, laid out by the CPU. */
const CLOUD_TEXELS = 4;

/** buildCloudTransmission, one fragment per texel of the rift map:
 *  every cloud in reach tested against this direction's cone, and
 *  marched where it covers it. */
const RIFT_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uClouds;
uniform int uCloudCount;
out vec4 outTransmission;
${SEEDED_NOISE}
${carveFunctionGlsl('localCarve', 3)}
void main() {
  vec2 texel = gl_FragCoord.xy;
  float latitude = (texel.y / ${f(RIFT_HEIGHT)}) * 3.141592653589793 - 1.5707963267948966;
  float longitude = (texel.x / ${f(RIFT_WIDTH)}) * 6.283185307179586;
  float cosLat = cos(latitude);
  vec3 dir = vec3(cosLat * cos(longitude), cosLat * sin(longitude), sin(latitude));
  float transmission = 1.0;
  for (int i = 0; i < 4096; i++) {
    if (i >= uCloudCount) break;
    vec4 place = texelFetch(uClouds, ivec2(0, i), 0);
    vec3 rel = place.xyz;
    float reach = place.w;
    float distance = length(rel);
    float cosSep = dot(dir, rel) / distance;
    float angRad = asin(min(1.0, reach / distance));
    if (cosSep < cos(angRad)) continue;
    vec4 shape = texelFetch(uClouds, ivec2(1, i), 0);
    vec4 scale = texelFetch(uClouds, ivec2(2, i), 0);
    float ds = 2.0 * reach / 9.0;
    float tau = 0.0;
    for (int k = 0; k < 9; k++) {
      float s = distance - reach + (float(k) + 0.5) * ds;
      tau += localCarve(dir * s - rel, shape.xyz, shape.w, scale.x) * scale.y * ds;
    }
    if (tau > 0.0) transmission *= exp(-tau);
  }
  outTransmission = vec4(transmission, 0.0, 0.0, 1.0);
}
`;

/** Per-tile rows: the tile's frame and its cloud. */
const TILE_TEXELS = 5;

/** buildDarkClouds' tiles, one fragment per texel of the atlas. */
const DARK_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uTiles;
uniform int uTileCount;
out vec4 outTransmission;
${SEEDED_NOISE}
${carveFunctionGlsl('localCarve', 3)}
void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  ivec2 tileAt = texel / ${DARK_TILE};
  int tile = tileAt.y * ${DARK_ATLAS_COLS} + tileAt.x;
  ivec2 cell = texel - tileAt * ${DARK_TILE};
  outTransmission = vec4(1.0, 0.0, 0.0, 1.0);
  if (tile >= uTileCount) return;
  if (cell.x == 0 || cell.y == 0 || cell.x == ${DARK_TILE - 1} || cell.y == ${DARK_TILE - 1}) return;
  vec4 view = texelFetch(uTiles, ivec2(0, tile), 0);
  vec3 right = texelFetch(uTiles, ivec2(1, tile), 0).xyz;
  vec3 up = texelFetch(uTiles, ivec2(2, tile), 0).xyz;
  vec4 shape = texelFetch(uTiles, ivec2(3, tile), 0);
  vec4 scale = texelFetch(uTiles, ivec2(4, tile), 0);
  float reach = view.w;
  float u = ((float(cell.x) + 0.5) / ${f(DARK_TILE)}) * 2.0 - 1.0;
  float v = ((float(cell.y) + 0.5) / ${f(DARK_TILE)}) * 2.0 - 1.0;
  vec3 o = (right * u + up * v) * reach;
  float ds = 2.0 * reach / 12.0;
  float tau = 0.0;
  for (int s = 0; s < 12; s++) {
    float t = -reach + (float(s) + 0.5) * ds;
    tau += localCarve(o + view.xyz * t, shape.xyz, shape.w, scale.x);
  }
  tau *= scale.y * ds;
  if (tau > 0.0) outTransmission.r = exp(-tau);
}
`;

/** Distant images sample the same encoded solved volumes as the near
 * renderer. Fine and coarse intervals are integrated once each. */
const NEBULA_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
uniform sampler3D uCoarse;
uniform sampler3D uFine;
uniform sampler3D uContinuum;
uniform vec3 uContinuumRef;
uniform vec4 uBox[2];
uniform vec4 uRef[2];
uniform vec2 uSize;
uniform vec3 uView;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uExtent;
out vec4 outMarch;
${CELL_TRANSFER_GLSL}
${CONTINUUM_SAMPLE_GLSL}
vec2 interval(vec4 box, vec3 origin) {
  float near = -1e20, far = 1e20;
  for (int axis = 0; axis < 3; axis++) {
    float p = origin[axis] - box[axis], d = uView[axis];
    if (abs(d) < 1e-12) { if (abs(p) > box.w) return vec2(0.0); }
    else {
      float a = (-box.w - p) / d, b = (box.w - p) / d;
      near = max(near, min(a,b)); far = min(far, max(a,b));
    }
  }
  return far > near ? vec2(near,far) : vec2(0.0);
}
vec3 gOrigin;
float gTau;
vec4 gSums;
void integrate(sampler3D field, int grid, float near, float far) {
  if (far <= near) return;
  float cellPc = 2.0 * uBox[grid].w / uSize[grid];
  int count = min(${NEBULA_TILE_MAX_STEPS}, max(1, int(ceil((far-near)/cellPc*(1.0-2e-6)))));
  float dt = (far-near)/float(count);
  for (int step = 0; step < ${NEBULA_TILE_MAX_STEPS}; step++) {
    if (step >= count) break;
    vec3 p = gOrigin + uView * (near+(float(step)+0.5)*dt);
    vec4 raw = texture(field, (p-uBox[grid].xyz)/(2.0*uBox[grid].w)+0.5);
    float dust = raw.r*raw.r*uRef[grid].x;
    float emitting = pow((raw.g*256.0+raw.a)/257.0*uRef[grid].y, 2.0)*mix(uRef[grid].z,uRef[grid].w,raw.b)*dt;
    float scattering = 0.0;
    if (uContinuumRef[grid] > 0.0) {
      vec3 coord = (p-uBox[grid].xyz)/(2.0*uBox[grid].w)+0.5;
      vec3 rgb = texture(uContinuum, continuumCoord(coord,uContinuumRef.z,float(2*grid))).rgb;
      vec3 moment = texture(uContinuum, continuumCoord(coord,uContinuumRef.z,float(2*grid+1))).rgb*2.0-1.0;
      scattering = dot(rgb*rgb,vec3(0.2126,0.7152,0.0722))*uContinuumRef[grid]*continuumPhase(moment,uView)
        *${f(SCATTER_EMISSIVITY_PER_LSUN)}*dust*dt;
    }
    float depth = dust*${f(DUST_OPACITY_PER_PC)}*dt;
    float transmitted = exp(-gTau)*cellEmissionWeight(depth);
    gSums += vec4(emitting*transmitted,scattering*transmitted,emitting,scattering);
    gTau += depth;
  }
}
void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  outMarch = vec4(0.0);
  if (cell.x==0 || cell.y==0 || cell.x==${NEBULA_TILE-1} || cell.y==${NEBULA_TILE-1}) return;
  vec2 uv = (vec2(cell)+0.5)/${f(NEBULA_TILE)}*2.0-1.0;
  gOrigin = (uRight*uv.x+uUp*uv.y)*uExtent;
  vec2 outer = interval(uBox[0],gOrigin);
  if (outer.y<=outer.x) return;
  vec2 inner = uBox[1].w>0.0 ? interval(uBox[1],gOrigin) : vec2(0.0);
  gTau=0.0;gSums=vec4(0.0);
  if (inner.y>inner.x) {
    integrate(uCoarse,0,outer.x,inner.x);
    integrate(uFine,1,inner.x,inner.y);
    integrate(uCoarse,0,inner.y,outer.y);
  } else integrate(uCoarse,0,outer.x,outer.y);
  outMarch=gSums;
}
`;

/** The programs' sources, for the tests that read them. */
export const SKY_BAKE_FRAGMENTS = {
  glow: GLOW_FRAGMENT,
  rift: RIFT_FRAGMENT,
  dark: DARK_FRAGMENT,
  nebula: NEBULA_FRAGMENT,
};

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

/** A cloud's shape and scale as the shaders take them: the stretch as
 *  a per-axis inverse, the seed's offset, and the dust per unit carve
 *  in optical depth per parsec. */
function cloudRow(cloud: MolecularCloud): { invStretch: [number, number, number]; seedOffset: number; dustScale: number } {
  const invStretch: [number, number, number] = [1, 1, 1];
  invStretch[cloudStretchAxis(cloud)] = 1 / cloudStretch(cloud);
  return {
    invStretch,
    seedOffset: Number(cloud.seed & 0xffn),
    dustScale: cloudDustFactor(cloud) * DUST_KAPPA * cloud.amplitude * CARVE_GAIN,
  };
}

/**
 * The baker over a fresh WebGL2 context, or null where one cannot
 * stand — the caller falls back to the CPU builders. Programs, the
 * permutation and the arm LUT live for the baker's life; the arm LUT
 * is the session's galaxy's, rebaked if the galaxy changes.
 */
export function createSkyBakeGpu(): SkyMapBaker | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const gl = new OffscreenCanvas(1, 1).getContext('webgl2', {
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
  });
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null;
  let glowProgram: WebGLProgram;
  let riftProgram: WebGLProgram;
  let darkProgram: WebGLProgram;
  let nebulaProgram: WebGLProgram;
  try {
    glowProgram = link(gl, GLOW_FRAGMENT);
    riftProgram = link(gl, RIFT_FRAGMENT);
    darkProgram = link(gl, DARK_FRAGMENT);
    nebulaProgram = link(gl, NEBULA_FRAGMENT);
  } catch (error) {
    console.warn('sky GPU bake unavailable:', error);
    return null;
  }
  let portraitBaker: ReturnType<typeof createNebulaGpuBaker> | undefined;
  const at = (program: WebGLProgram, name: string): WebGLUniformLocation | null =>
    gl.getUniformLocation(program, name);
  const framebuffer = gl.createFramebuffer();
  let permTexture: WebGLTexture | null = null;
  let armTexture: WebGLTexture | null = null;
  let selectionTexture: WebGLTexture | null = null;
  let armGalaxy = -1n;

  const floatTexture = (width: number, height: number, data: Float32Array | null): WebGLTexture => {
    const texture = gl.createTexture();
    if (!texture) throw new Error('texture allocation failed');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, height);
    if (data) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  };

  const ensurePermutation = (unit: number, program: WebGLProgram): void => {
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
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, permTexture);
    gl.uniform1i(at(program, 'uPerm'), unit);
  };

  /** Render one full-target pass and read it back as RGBA floats. */
  const pass = (
    program: WebGLProgram,
    width: number,
    height: number,
    bind: () => void,
  ): Float32Array => {
    if (gl.isContextLost()) throw new Error('context lost');
    const target = floatTexture(width, height, null);
    gl.useProgram(program);
    bind();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    gl.viewport(0, 0, width, height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const out = new Float32Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteTexture(target);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`GL error ${error}`);
    return out;
  };

  return {
    glow(viewpoint: GalacticPosition): Float32Array {
      if (armGalaxy !== galaxySeed()) {
        if (armTexture) gl.deleteTexture(armTexture);
        // The LUT is RG; widen it to the RGBA texels every pass reads.
        const rg = bakeArmLut();
        const rgba = new Float32Array(ARM_LUT_SIZE * ARM_LUT_SIZE * 4);
        for (let i = 0; i < ARM_LUT_SIZE * ARM_LUT_SIZE; i++) {
          rgba[i * 4] = rg[i * 2];
          rgba[i * 4 + 1] = rg[i * 2 + 1];
        }
        armTexture = floatTexture(ARM_LUT_SIZE, ARM_LUT_SIZE, rgba);
        armGalaxy = galaxySeed();
      }
      if (!selectionTexture) {
        const data=fieldSelectionData(),rgba=new Float32Array(SELECTION_WIDTH*SELECTION_HEIGHT*4);
        for(let i=0;i<data.length/3;i++)for(let c=0;c<3;c++)rgba[i*4+c]=data[i*3+c];
        selectionTexture=floatTexture(SELECTION_WIDTH,SELECTION_HEIGHT,rgba);
      }
      return pass(glowProgram, GLOW_WIDTH, GLOW_HEIGHT, () => {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D,selectionTexture);
        gl.uniform1i(at(glowProgram,'uFieldSelection'),1);
        const scales=fieldSelectionScales(),rows=fieldSelectionRows();
        for(const [c,suffix] of ['R','G','B'].entries())gl.uniform4fv(at(glowProgram,'uSelectionScale'+suffix),scales.map(v=>v[c]));
        gl.uniform4fv(at(glowProgram,'uSelectionCaps'),rows.map(r=>r.cap));
        gl.uniform4fv(at(glowProgram,'uSelectionYoung'),rows.map(r=>r.youngPc));
        gl.uniform4fv(at(glowProgram,'uSelectionOld'),rows.map(r=>r.oldPc));
        gl.uniform1f(at(glowProgram,'uCensusPc'),neighborRadiusPc(viewpoint));
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, armTexture);
        gl.uniform1i(at(glowProgram, 'uArmLut'), 0);
        gl.uniform3f(at(glowProgram, 'uViewPc'), viewpoint.xPc, viewpoint.yPc, viewpoint.zPc);
        const components = galaxyComponentUniforms();
        gl.uniform3fv(at(glowProgram, 'uBulgeModel'), components.bulge);
        gl.uniform3fv(at(glowProgram, 'uBulgeCore'), components.core);
        for (const [c, suffix] of ['R', 'G', 'B'].entries()) {
          gl.uniform4fv(at(glowProgram, 'uPopulation' + suffix), components.optical[c]);
        }
        // expectedCloudField is linear in dust with the (0.4 + 0.6·boost)
        // factor applied here; the unit-dust, unit-boost value carries
        // the rest of its constant.
        gl.uniform1f(at(glowProgram, 'uCloudFieldPerDust'), expectedCloudField(1, 1));
      });
    },

    rift(viewpoint: GalacticPosition, clouds: MolecularCloud[]): Float32Array {
      const rows = Math.max(1, clouds.length);
      const table = new Float32Array(CLOUD_TEXELS * rows * 4);
      clouds.forEach((cloud, i) => {
        const { invStretch, seedOffset, dustScale } = cloudRow(cloud);
        const base = i * CLOUD_TEXELS * 4;
        table.set(
          [
            cloud.positionPc.xPc - viewpoint.xPc,
            cloud.positionPc.yPc - viewpoint.yPc,
            cloud.positionPc.zPc - viewpoint.zPc,
            cloudReachPc(cloud),
          ],
          base,
        );
        table.set([...invStretch, cloud.radiusPc], base + 4);
        table.set([seedOffset, dustScale, 0, 0], base + 8);
      });
      const cloudTexture = floatTexture(CLOUD_TEXELS, rows, table);
      try {
        const out = pass(riftProgram, RIFT_WIDTH, RIFT_HEIGHT, () => {
          ensurePermutation(0, riftProgram);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, cloudTexture);
          gl.uniform1i(at(riftProgram, 'uClouds'), 1);
          gl.uniform1i(at(riftProgram, 'uCloudCount'), clouds.length);
        });
        const transmission = new Float32Array(RIFT_WIDTH * RIFT_HEIGHT);
        for (let i = 0; i < transmission.length; i++) transmission[i] = out[i * 4];
        return transmission;
      } finally {
        gl.deleteTexture(cloudTexture);
      }
    },

    darkTiles(jobs: DarkTileJob[]): Float32Array {
      const rows = Math.max(1, jobs.length);
      const table = new Float32Array(TILE_TEXELS * rows * 4);
      jobs.forEach((job, i) => {
        const { invStretch, seedOffset, dustScale } = cloudRow(job.cloud);
        const base = i * TILE_TEXELS * 4;
        table.set([...job.view, cloudReachPc(job.cloud)], base);
        table.set([...job.right, 0], base + 4);
        table.set([...job.up, 0], base + 8);
        table.set([...invStretch, job.cloud.radiusPc], base + 12);
        table.set([seedOffset, dustScale, 0, 0], base + 16);
      });
      const tileTexture = floatTexture(TILE_TEXELS, rows, table);
      try {
        const width = DARK_ATLAS_COLS * DARK_TILE;
        const height = DARK_ATLAS_ROWS * DARK_TILE;
        const out = pass(darkProgram, width, height, () => {
          ensurePermutation(0, darkProgram);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, tileTexture);
          gl.uniform1i(at(darkProgram, 'uTiles'), 1);
          gl.uniform1i(at(darkProgram, 'uTileCount'), jobs.length);
        });
        const atlas = new Float32Array(width * height);
        for (let i = 0; i < atlas.length; i++) atlas[i] = out[i * 4];
        return atlas;
      } finally {
        gl.deleteTexture(tileTexture);
      }
    },

    nebulaTiles(jobs: NebulaTileJob[], onProgress?: (completed: number, total: number) => void): Float32Array {
      const width = NEBULA_ATLAS_COLS * NEBULA_TILE;
      const atlas = new Float32Array(width * NEBULA_ATLAS_ROWS * NEBULA_TILE * 4);
      // Reuse two upload textures across the selected objects. Their
      // contents come from the bounded portrait cache, not a second model.
      const textures: (WebGLTexture | null)[] = [null, null];
      let heldSize = 0;
      const lightTexture = gl.createTexture();
      let lightSize = 0;
      try {
        jobs.forEach((job, tile) => {
          const pair = job.portrait ?? nebulaPortrait(job.nebula, (cloud, nebula, size) => {
            if (portraitBaker === undefined) portraitBaker = createNebulaGpuBaker();
            return portraitBaker ? bakeNebulaPair(cloud, nebula, size, portraitBaker.sample, portraitBaker.attenuate) : bakeNebulaPair(cloud, nebula, size);
          }), bakes = [pair.coarse, pair.fine ?? pair.coarse];
          nebulaPortraitPhotometry(job.nebula, job.view, pair);
          if (heldSize !== pair.coarse.size) {
            heldSize = pair.coarse.size;
            for (let grid = 0; grid < 2; grid++) {
              gl.deleteTexture(textures[grid]); textures[grid] = gl.createTexture();
              if (!textures[grid]) throw new Error('portrait texture allocation failed');
              gl.bindTexture(gl.TEXTURE_3D, textures[grid]);
              gl.texStorage3D(gl.TEXTURE_3D, 1, gl.RGBA8, heldSize, heldSize, heldSize);
              gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
              gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
              for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, axis, gl.CLAMP_TO_EDGE);
            }
          }
          const light = packContinuumPair(pair.coarse.continuum, pair.fine?.continuum);
          gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_3D, lightTexture);
          // texImage permits a test-grade field to change dimensions.
          gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, light.size, light.size, 4 * light.size, 0, gl.RGBA, gl.HALF_FLOAT, light.data);
          if (lightSize !== light.size) {
            lightSize = light.size;
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, axis, gl.CLAMP_TO_EDGE);
          }
          const out = pass(nebulaProgram, NEBULA_TILE, NEBULA_TILE, () => {
            bakes.forEach((bake, grid) => {
              gl.activeTexture(gl.TEXTURE0 + grid);
              gl.bindTexture(gl.TEXTURE_3D, textures[grid]);
              gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, heldSize, heldSize, heldSize, gl.RGBA, gl.UNSIGNED_BYTE, bake.data);
              gl.uniform4fv(at(nebulaProgram, `uBox[${grid}]`), [...bake.originPc, grid===1 && !pair.fine ? 0 : bake.halfExtentsPc[0]]);
              gl.uniform4fv(at(nebulaProgram, `uRef[${grid}]`), [bake.dustRef,bake.densityRef,bake.emissionCoefficient,bake.emissionHotCoefficient]);
            });
            gl.uniform1i(at(nebulaProgram, 'uContinuum'),2);
            gl.uniform3f(at(nebulaProgram,'uContinuumRef'),pair.coarse.continuum?.irradianceRef??0,pair.fine?.continuum?.irradianceRef??0,light.size);
            gl.uniform1i(at(nebulaProgram, 'uCoarse'),0);gl.uniform1i(at(nebulaProgram, 'uFine'),1);
            gl.uniform2f(at(nebulaProgram,'uSize'),heldSize,heldSize);
            gl.uniform3fv(at(nebulaProgram,'uView'),job.view);gl.uniform3fv(at(nebulaProgram,'uRight'),job.right);gl.uniform3fv(at(nebulaProgram,'uUp'),job.up);
            gl.uniform1f(at(nebulaProgram,'uExtent'),job.extentPc);
          });
          for (let row=0;row<NEBULA_TILE;row++) {
            const target=((Math.floor(tile/NEBULA_ATLAS_COLS)*NEBULA_TILE+row)*width+(tile%NEBULA_ATLAS_COLS)*NEBULA_TILE)*4;
            atlas.set(out.subarray(row*NEBULA_TILE*4,(row+1)*NEBULA_TILE*4),target);
          }
          onProgress?.(tile + 1, jobs.length);
        });
        return atlas;
      } finally {
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_3D,null);
        gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_3D,null);
        for (const texture of textures) gl.deleteTexture(texture);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_3D,null); gl.deleteTexture(lightTexture);
        gl.activeTexture(gl.TEXTURE0);
      }
    },

    dispose(): void {
      portraitBaker?.dispose();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
