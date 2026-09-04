import {
  AdditiveBlending,
  Color,
  HalfFloatType,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

/** Bloom stands in for the display's point-spread function, not a
 *  second tone mapper: once a source is this far over the threshold,
 *  more radiance belongs in its own pixel rather than in wider glare. */
export const BLOOM_INPUT_MAX = 1.5;

/** Radiance where glare begins, and the width of its soft knee. */
const BLOOM_THRESHOLD = 1;
const BLOOM_KNEE = 0.01;

/**
 * The glare pyramid, fine to coarse: each level blurs the one above at
 * half its resolution with a wider Gaussian, and the weights keep a
 * compact core with faint wings. Every level costs two render passes,
 * so the pyramid stops where a level's weight would no longer show.
 */
export const BLOOM_LEVELS: readonly { kernelRadius: number; weight: number }[] = [
  { kernelRadius: 6, weight: 1 },
  { kernelRadius: 10, weight: 0.32 },
  { kernelRadius: 14, weight: 0.08 },
];

const HORIZONTAL = new Vector2(1, 0);
const VERTICAL = new Vector2(0, 1);

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// The scene is read through a finite window: NaN and infinite texels
// count as dark and nothing above the input ceiling goes in, so one
// bad pixel can only ever be one pixel of glare rather than a band
// smeared across the frame by the blur.
const BRIGHT_FRAGMENT = /* glsl */ `
#include <common>
uniform sampler2D tDiffuse;
varying vec2 vUv;
void main() {
  vec4 texel = texture2D(tDiffuse, vUv);
  bvec3 bad = bvec3(
    isnan(texel.x) || isinf(texel.x),
    isnan(texel.y) || isinf(texel.y),
    isnan(texel.z) || isinf(texel.z)
  );
  vec3 color = clamp(mix(texel.xyz, vec3(0.0), vec3(bad)), 0.0, ${BLOOM_INPUT_MAX.toFixed(2)});
  float glare = smoothstep(
    ${BLOOM_THRESHOLD.toFixed(2)},
    ${(BLOOM_THRESHOLD + BLOOM_KNEE).toFixed(2)},
    luminance(color)
  );
  gl_FragColor = vec4(color * glare, 1.0);
}`;

const BLUR_FRAGMENT = /* glsl */ `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform vec2 invSize;
uniform vec2 direction;
uniform float reversedDepth;
uniform float gaussianCoefficients[KERNEL_RADIUS];
varying vec2 vUv;

// Depth is reciprocal under both projection conventions once standard
// depth is reflected about one. Clear sky is zero; larger values stand
// closer to the camera. A foreground pixel may gather glare from its own
// depth layer, but not from an emitter behind it. Sky remains unmasked so
// the point-spread function can still form naturally around a visible sun.
float proximityAt(vec2 uv) {
  float depth = texture2D(depthTexture, clamp(uv, vec2(0.0), vec2(1.0))).r;
  return mix(1.0 - depth, depth, reversedDepth);
}

float visibilityAt(float centerProximity, vec2 sampleUv) {
  if (centerProximity <= 1e-7) return 1.0;
  float sampleProximity = proximityAt(sampleUv);
  // Leave room for the depth slope across a curved or rugged surface.
  // A stellar or clear-sky source behind terrain is orders of magnitude
  // farther away and falls cleanly below this relative interval.
  return smoothstep(centerProximity * 0.65, centerProximity * 0.82, sampleProximity);
}

void main() {
  float centerProximity = proximityAt(vUv);
  float centerWeight = gaussianCoefficients[0];
  vec3 diffuseSum = texture2D(colorTexture, vUv).rgb * centerWeight;
  for (int i = 1; i < KERNEL_RADIUS; i++) {
    float x = float(i);
    float w = gaussianCoefficients[i];
    vec2 uvOffset = direction * invSize * x;
    vec2 uv1 = vUv + uvOffset;
    vec2 uv2 = vUv - uvOffset;
    vec3 sample1 = texture2D(colorTexture, uv1).rgb;
    vec3 sample2 = texture2D(colorTexture, uv2).rgb;
    diffuseSum += sample1 * w * visibilityAt(centerProximity, uv1);
    diffuseSum += sample2 * w * visibilityAt(centerProximity, uv2);
  }
  gl_FragColor = vec4(diffuseSum, 1.0);
}`;

function blurMaterial(kernelRadius: number, reversedDepth: boolean): ShaderMaterial {
  const sigma = kernelRadius / 3;
  const coefficients: number[] = [];
  for (let i = 0; i < kernelRadius; i++) {
    coefficients.push((0.39894 * Math.exp((-0.5 * i * i) / (sigma * sigma))) / sigma);
  }
  return new ShaderMaterial({
    defines: { KERNEL_RADIUS: kernelRadius },
    uniforms: {
      colorTexture: { value: null },
      depthTexture: { value: null },
      invSize: { value: new Vector2(1, 1) },
      direction: { value: HORIZONTAL },
      reversedDepth: { value: reversedDepth ? 1 : 0 },
      gaussianCoefficients: { value: coefficients },
    },
    vertexShader: VERTEX,
    fragmentShader: BLUR_FRAGMENT,
  });
}

/** The levels summed by weight and added straight over the scene: the
 *  composite and the blend UnrealBloom draws separately, in one pass. */
function blendMaterial(
  levels: readonly { weight: number }[],
  strength: number,
): ShaderMaterial {
  const uniforms: Record<string, { value: unknown }> = { bloomStrength: { value: strength } };
  const samplers: string[] = [];
  const terms: string[] = [];
  levels.forEach((level, i) => {
    uniforms[`level${i}`] = { value: null };
    samplers.push(`uniform sampler2D level${i};`);
    terms.push(`${level.weight.toFixed(4)} * texture2D(level${i}, vUv).rgb`);
  });
  return new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: /* glsl */ `
uniform float bloomStrength;
${samplers.join('\n')}
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(bloomStrength * (${terms.join('\n    + ')}), 1.0);
}`,
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
}

/**
 * Threshold bloom with a short mip pyramid: a bright pass at half
 * resolution, a separable Gaussian per level at halving resolution,
 * and one additive pass that sums the levels over the scene buffer.
 * A pass on a tile-based GPU costs a fixed load and store whatever
 * its size, so the pass count is the budget this keeps small.
 */
export class CompactBloomPass extends Pass {
  private readonly bright: WebGLRenderTarget;
  private readonly horizontal: WebGLRenderTarget[] = [];
  private readonly vertical: WebGLRenderTarget[] = [];
  private readonly brightMaterial: ShaderMaterial;
  private readonly blurMaterials: ShaderMaterial[] = [];
  private readonly blend: ShaderMaterial;
  private readonly levels: readonly { kernelRadius: number; weight: number }[];
  private readonly quad = new FullScreenQuad();
  private readonly black = new Color(0, 0, 0);
  private readonly savedClearColor = new Color();

  constructor(
    strength: number,
    options: {
      levels?: readonly { kernelRadius: number; weight: number }[];
      reversedDepth?: boolean;
    } = {},
  ) {
    super();
    this.needsSwap = false;
    this.levels = options.levels ?? BLOOM_LEVELS;
    const reversedDepth = options.reversedDepth ?? true;
    const half = { type: HalfFloatType };
    this.bright = new WebGLRenderTarget(1, 1, half);
    for (const level of this.levels) {
      this.horizontal.push(new WebGLRenderTarget(1, 1, half));
      this.vertical.push(new WebGLRenderTarget(1, 1, half));
      this.blurMaterials.push(blurMaterial(level.kernelRadius, reversedDepth));
    }
    this.brightMaterial = new ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: VERTEX,
      fragmentShader: BRIGHT_FRAGMENT,
    });
    this.blend = blendMaterial(this.levels, strength);
  }

  get brightShader(): string {
    return this.brightMaterial.fragmentShader;
  }

  get blurShader(): string {
    return this.blurMaterials[0]?.fragmentShader ?? '';
  }

  /** Each level's target size, finest first. */
  get levelSizes(): [number, number][] {
    return this.vertical.map((target) => [target.width, target.height]);
  }

  override setSize(width: number, height: number): void {
    let w = Math.max(1, Math.round(width / 2));
    let h = Math.max(1, Math.round(height / 2));
    this.bright.setSize(w, h);
    this.levels.forEach((_, i) => {
      this.horizontal[i].setSize(w, h);
      this.vertical[i].setSize(w, h);
      (this.blurMaterials[i].uniforms.invSize.value as Vector2).set(1 / w, 1 / h);
      w = Math.max(1, Math.round(w / 2));
      h = Math.max(1, Math.round(h / 2));
    });
  }

  override render(
    renderer: WebGLRenderer,
    _writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
  ): void {
    renderer.getClearColor(this.savedClearColor);
    const savedClearAlpha = renderer.getClearAlpha();
    const savedAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.black, 0);

    this.brightMaterial.uniforms.tDiffuse.value = readBuffer.texture;
    this.draw(renderer, this.brightMaterial, this.bright);

    let input = this.bright;
    this.levels.forEach((_, i) => {
      const blur = this.blurMaterials[i];
      blur.uniforms.depthTexture.value = readBuffer.depthTexture;
      blur.uniforms.colorTexture.value = input.texture;
      blur.uniforms.direction.value = HORIZONTAL;
      this.draw(renderer, blur, this.horizontal[i]);
      blur.uniforms.colorTexture.value = this.horizontal[i].texture;
      blur.uniforms.direction.value = VERTICAL;
      this.draw(renderer, blur, this.vertical[i]);
      input = this.vertical[i];
      this.blend.uniforms[`level${i}`].value = this.vertical[i].texture;
    });

    // Added over the scene in place; the buffer keeps what it held.
    renderer.setRenderTarget(readBuffer);
    this.quad.material = this.blend;
    this.quad.render(renderer);

    renderer.setClearColor(this.savedClearColor, savedClearAlpha);
    renderer.autoClear = savedAutoClear;
  }

  private draw(renderer: WebGLRenderer, material: ShaderMaterial, target: WebGLRenderTarget): void {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    renderer.clear();
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.bright.dispose();
    for (const target of [...this.horizontal, ...this.vertical]) target.dispose();
    for (const material of [this.brightMaterial, ...this.blurMaterials, this.blend]) {
      material.dispose();
    }
    this.quad.dispose();
  }
}
