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
  ARM_YOUNG_LIGHT,
  DUST_OPACITY_PER_PC,
  SMOOTH_MODEL,
  type GalacticPosition,
} from '../../universe/galaxy/density';
import { galaxySeed } from '../../universe/galaxy/galaxySeed';
import { dustToGas, HYDROGEN_PER_DUST } from '../../universe/galaxy/gas';
import {
  DUST_DEPLETION,
  SHELL_SKIN_SHARE,
  SHELL_WIDTH,
  sweptShellBoost,
  VENT_CONFINEMENT,
  VENT_RESIDUAL,
  WIND_CAVITY_RESIDUAL,
  WIND_REACH,
  WIND_STALL,
  WIND_WALL_BOOST,
  WIND_WALL_WIDTH,
} from '../../universe/galaxy/ionization';
import {
  FRONT_DIRECTIONS,
  FRONT_LOOKUP,
  FRONT_LOOKUP_COLS,
  FRONT_LOOKUP_ROWS,
  MEMBER_SPREAD,
  nebulaGrowth,
  nebulaIlluminant,
} from '../../universe/galaxy/nebula';
import {
  DARK_ATLAS_COLS,
  DARK_ATLAS_ROWS,
  DARK_TILE,
  DUST_KAPPA,
  GLOW_HEIGHT,
  GLOW_WIDTH,
  meanPopulationLuminosity,
  NEBULA_ATLAS_COLS,
  NEBULA_ATLAS_ROWS,
  NEBULA_TILE,
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
uniform float uMeanLum;
uniform float uCloudFieldPerDust;
out vec4 outGlow;
${ARM_LUT_GLSL}
void main() {
  vec2 texel = gl_FragCoord.xy;
  float latitude = (texel.y / ${f(GLOW_HEIGHT)} - 0.5) * 3.141592653589793;
  float longitude = (texel.x / ${f(GLOW_WIDTH)}) * 6.283185307179586;
  vec3 dir = vec3(cos(latitude) * cos(longitude), cos(latitude) * sin(longitude), sin(latitude));
  float light = 0.0;
  float opticalDepth = 0.0;
  float s = 80.0;
  for (int i = 0; i < 96; i++) {
    if (s >= 25000.0) break;
    float stepPc = max(90.0, s * 0.11);
    vec3 p = uViewPc + dir * s;
    float radius = length(p.xy);
    float absZ = abs(p.z);
    vec2 arm = armProfile(radius, atan(p.y, p.x));
    float thinSmooth = ${f(SMOOTH_MODEL.thinNorm)} * exp(-radius / ${f(SMOOTH_MODEL.thinScaleLengthPc)}) *
      exp(-absZ / ${f(SMOOTH_MODEL.thinScaleHeightPc)});
    float thick = ${f(SMOOTH_MODEL.thickNorm)} * exp(-radius / ${f(SMOOTH_MODEL.thickScaleLengthPc)}) *
      exp(-absZ / ${f(SMOOTH_MODEL.thickScaleHeightPc)});
    float halo = ${f(SMOOTH_MODEL.haloNorm)} *
      pow(max(length(vec2(radius, absZ)), ${f(SMOOTH_MODEL.haloFloorPc)}) / ${f(SMOOTH_MODEL.haloReferencePc)},
        ${f(SMOOTH_MODEL.haloIndex)});
    float dust = exp(-radius / ${f(SMOOTH_MODEL.dustScaleLengthPc)}) *
      exp(-absZ / ${f(SMOOTH_MODEL.dustScaleHeightPc)}) * (1.0 + ${f(SMOOTH_MODEL.dustLaneWeight)} * arm.y);
    float armBoost = 1.0 + arm.x;
    float clump = s > ${f(RIFT_NEAR_PC)}
      ? 0.45 + 1.6 * uCloudFieldPerDust * dust * (0.4 + 0.6 * armBoost)
      : 0.45;
    opticalDepth += dust * clump * ${f(DUST_KAPPA)} * stepPc;
    light += (thinSmooth * (1.0 + ${f(ARM_YOUNG_LIGHT)} * arm.x) + thick + halo) * uMeanLum * stepPc *
      exp(-opticalDepth);
    s += stepPc;
  }
  outGlow = vec4(light / 12.566370614359172, exp(-opticalDepth * 0.25), 0.0, 1.0);
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

/** Per-nebula rows: the tile's frame, the illuminant and the
 *  region's re-plumbing scalars, laid out by the CPU. */
const NEBULA_TEXELS = 8;
/** The marched front, FRONT_DIRECTIONS radii packed four to a texel. */
const FRONT_TEXELS = FRONT_DIRECTIONS / 4;
/** Sightline steps through the body, marchNebulaTile's own. */
const NEBULA_TILE_STEPS = 16;

/**
 * marchNebulaTile, one fragment per texel of the nebula atlas: the
 * cloud as nebulaGasAt re-plumbs it — the diluted interior read in
 * contracted coordinates, the wind cavity eroded toward each point,
 * the champagne gate, the swept shell and its ionized skin, the natal
 * cloud beyond — with the front read off the model's own marched rays
 * through the same latitude–longitude lookup. Each pixel keeps both
 * mechanisms' integrals with and without the view path's extinction.
 */
const NEBULA_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uTiles;
uniform sampler2D uFronts;
uniform highp usampler2D uLookup;
uniform int uTileCount;
out vec4 outMarch;
${SEEDED_NOISE}
${carveFunctionGlsl('localCarve', 3)}

int gTile;
vec3 gInvStretch;
float gRadiusPc;
float gSeedOffset;
float gDensityScale;
vec3 gSource;
float gLit;
float gBubblePc;
float gFrontReachPc;
float gGrowth;
float gDilution;
float gCavityPc;
float gSourceHydrogen;
float gHydrogenPerDust;
float gShellBoost;
float gConfining;

float dustAt(vec3 p) {
  return localCarve(p, gInvStretch, gRadiusPc, gSeedOffset) * gDensityScale;
}

float frontToward(vec3 u) {
  int row = min(${FRONT_LOOKUP_ROWS - 1}, int(floor(
    (asin(clamp(u.z, -1.0, 1.0)) / 3.141592653589793 + 0.5) * ${f(FRONT_LOOKUP_ROWS)})));
  float longitude = atan(u.y, u.x);
  if (longitude < 0.0) longitude += 6.283185307179586;
  int col = min(${FRONT_LOOKUP_COLS - 1}, int(floor(
    longitude / 6.283185307179586 * ${f(FRONT_LOOKUP_COLS)})));
  int ray = int(texelFetch(uLookup, ivec2(col, row), 0).r);
  vec4 quad = texelFetch(uFronts, ivec2(ray >> 2, gTile), 0);
  return quad[ray & 3];
}

vec2 gasAt(vec3 p) {
  if (gLit < 0.5) return vec2(dustAt(p), 0.0);
  vec3 d = p - gSource;
  float r = length(d);
  if (r > gFrontReachPc * 1.5) return vec2(dustAt(p), 0.0);
  float bubble = r > 0.0 ? frontToward(d / r) : gBubblePc;
  if (r < bubble) {
    float natal = dustAt(gSource + d / gGrowth) * gDilution;
    float cavity = gCavityPc;
    if (cavity > 0.0 && r > 0.0) {
      float ploughed = dustAt(gSource + d * (cavity / gGrowth / r)) * gHydrogenPerDust;
      cavity *= clamp(
        pow(gSourceHydrogen / max(1e-6, ploughed), 0.25), ${f(WIND_STALL)}, ${f(WIND_REACH)});
    }
    float wind = r < cavity
      ? ${f(WIND_CAVITY_RESIDUAL)}
      : (r <= cavity * ${f(1 + WIND_WALL_WIDTH)} ? ${f(WIND_WALL_BOOST)} : 1.0);
    float confinement = gConfining > 0.0
      ? clamp(dustAt(p) * gHydrogenPerDust / gConfining, ${f(VENT_RESIDUAL)}, 1.0)
      : 1.0;
    float dust = natal * wind * confinement;
    return vec2(dust * ${f(1 / DUST_DEPLETION)}, dust * gHydrogenPerDust);
  }
  float swept = r <= bubble * ${f(1 + SHELL_WIDTH)} ? gShellBoost : 1.0;
  float dust = dustAt(p) * swept;
  float skin = exp(-(r - bubble) / (${f(SHELL_SKIN_SHARE * SHELL_WIDTH)} * bubble));
  return vec2(dust / (1.0 + ${f(DUST_DEPLETION - 1)} * skin), dust * gHydrogenPerDust * skin);
}

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  ivec2 tileAt = texel / ${NEBULA_TILE};
  gTile = tileAt.y * ${NEBULA_ATLAS_COLS} + tileAt.x;
  ivec2 cell = texel - tileAt * ${NEBULA_TILE};
  outMarch = vec4(0.0);
  if (gTile >= uTileCount) return;
  if (cell.x == 0 || cell.y == 0 || cell.x == ${NEBULA_TILE - 1} || cell.y == ${NEBULA_TILE - 1}) return;
  vec4 view = texelFetch(uTiles, ivec2(0, gTile), 0);
  vec4 right = texelFetch(uTiles, ivec2(1, gTile), 0);
  vec4 up = texelFetch(uTiles, ivec2(2, gTile), 0);
  vec4 shape = texelFetch(uTiles, ivec2(3, gTile), 0);
  vec4 source = texelFetch(uTiles, ivec2(4, gTile), 0);
  vec4 region = texelFetch(uTiles, ivec2(5, gTile), 0);
  vec4 wind = texelFetch(uTiles, ivec2(6, gTile), 0);
  vec4 gate = texelFetch(uTiles, ivec2(7, gTile), 0);
  float extent = view.w;
  float floorSq = right.w;
  gInvStretch = shape.xyz;
  gRadiusPc = up.w;
  gSeedOffset = shape.w;
  gDensityScale = source.w;
  gSource = source.xyz;
  gLit = region.x;
  gBubblePc = region.y;
  gFrontReachPc = region.z;
  gGrowth = region.w;
  gDilution = wind.x;
  gCavityPc = wind.y;
  gSourceHydrogen = wind.z;
  gHydrogenPerDust = wind.w;
  gShellBoost = gate.x;
  gConfining = gate.y;

  float u = ((float(cell.x) + 0.5) / ${f(NEBULA_TILE)}) * 2.0 - 1.0;
  float v = ((float(cell.y) + 0.5) / ${f(NEBULA_TILE)}) * 2.0 - 1.0;
  vec3 o = (right.xyz * u + up.xyz * v) * extent;
  float dt = 2.0 * extent / ${f(NEBULA_TILE_STEPS)};
  float tau = 0.0;
  vec4 sums = vec4(0.0);
  for (int s = 0; s < ${NEBULA_TILE_STEPS}; s++) {
    float t = -extent + (float(s) + 0.5) * dt;
    vec3 p = o + view.xyz * t;
    vec2 gas = gasAt(p);
    if (gas.x <= 0.0 && gas.y <= 0.0) continue;
    vec3 shine = p - gSource;
    float scattering = gas.x * dt / max(dot(shine, shine), floorSq);
    float emitting = gas.y * gas.y * dt;
    float transmitted = exp(-tau);
    sums += vec4(emitting * transmitted, scattering * transmitted, emitting, scattering);
    tau += gas.x * ${f(DUST_OPACITY_PER_PC)} * dt;
  }
  outMarch = sums;
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
  const at = (program: WebGLProgram, name: string): WebGLUniformLocation | null =>
    gl.getUniformLocation(program, name);
  const framebuffer = gl.createFramebuffer();
  let permTexture: WebGLTexture | null = null;
  let armTexture: WebGLTexture | null = null;
  let armGalaxy = -1n;
  let lookupTexture: WebGLTexture | null = null;

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
      return pass(glowProgram, GLOW_WIDTH, GLOW_HEIGHT, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, armTexture);
        gl.uniform1i(at(glowProgram, 'uArmLut'), 0);
        gl.uniform3f(at(glowProgram, 'uViewPc'), viewpoint.xPc, viewpoint.yPc, viewpoint.zPc);
        gl.uniform1f(at(glowProgram, 'uMeanLum'), meanPopulationLuminosity());
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

    nebulaTiles(jobs: NebulaTileJob[]): Float32Array {
      const rows = Math.max(1, jobs.length);
      const table = new Float32Array(NEBULA_TEXELS * rows * 4);
      const fronts = new Float32Array(FRONT_TEXELS * rows * 4);
      jobs.forEach((job, i) => {
        const { cloud, nebula } = job;
        const { invStretch, seedOffset } = cloudRow(cloud);
        const source = nebulaIlluminant(nebula);
        const lit = nebula.sources.length > 0 && nebula.bubbleRadiusPc > 0;
        const { growth, dilution } = nebulaGrowth(nebula);
        const base = i * NEBULA_TEXELS * 4;
        table.set([...job.view, job.extentPc], base);
        table.set([...job.right, (MEMBER_SPREAD * cloud.radiusPc) ** 2], base + 4);
        table.set([...job.up, cloud.radiusPc], base + 8);
        table.set([...invStretch, seedOffset], base + 12);
        table.set(
          [
            source?.dxPc ?? 0,
            source?.dyPc ?? 0,
            source?.dzPc ?? 0,
            cloud.amplitude * CARVE_GAIN * nebula.dustFactor,
          ],
          base + 16,
        );
        table.set([lit ? 1 : 0, nebula.bubbleRadiusPc, nebula.frontReachPc, growth], base + 20);
        table.set(
          [
            dilution,
            nebula.windCavityPc,
            nebula.sourceHydrogenDensity,
            HYDROGEN_PER_DUST / dustToGas(nebula.metallicity),
          ],
          base + 24,
        );
        table.set(
          [sweptShellBoost(dilution), VENT_CONFINEMENT * nebula.sourceHydrogenDensity * dilution, 0, 0],
          base + 28,
        );
        if (lit) fronts.set(nebula.frontPc, i * FRONT_TEXELS * 4);
      });
      if (!lookupTexture) {
        lookupTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, lookupTexture);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8UI, FRONT_LOOKUP_COLS, FRONT_LOOKUP_ROWS);
        gl.texSubImage2D(
          gl.TEXTURE_2D, 0, 0, 0, FRONT_LOOKUP_COLS, FRONT_LOOKUP_ROWS,
          gl.RED_INTEGER, gl.UNSIGNED_BYTE, FRONT_LOOKUP,
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
      const tileTexture = floatTexture(NEBULA_TEXELS, rows, table);
      const frontTexture = floatTexture(FRONT_TEXELS, rows, fronts);
      try {
        return pass(
          nebulaProgram,
          NEBULA_ATLAS_COLS * NEBULA_TILE,
          NEBULA_ATLAS_ROWS * NEBULA_TILE,
          () => {
            ensurePermutation(0, nebulaProgram);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, tileTexture);
            gl.uniform1i(at(nebulaProgram, 'uTiles'), 1);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, frontTexture);
            gl.uniform1i(at(nebulaProgram, 'uFronts'), 2);
            gl.activeTexture(gl.TEXTURE3);
            gl.bindTexture(gl.TEXTURE_2D, lookupTexture);
            gl.uniform1i(at(nebulaProgram, 'uLookup'), 3);
            gl.uniform1i(at(nebulaProgram, 'uTileCount'), jobs.length);
          },
        );
      } finally {
        gl.deleteTexture(tileTexture);
        gl.deleteTexture(frontTexture);
      }
    },

    dispose(): void {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
