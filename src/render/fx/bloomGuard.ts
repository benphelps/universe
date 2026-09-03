import type { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/** Bloom represents the display/camera point-spread function, not a
 *  second tone mapper. Once a source is this far over the extraction
 *  threshold, more scene radiance belongs in the source pixel rather
 *  than making its glare cover more of the frame. */
export const BLOOM_INPUT_MAX = 1.5;

/** Fine to coarse blur levels. UnrealBloom's stock broad levels are
 *  useful for a dreamy effect but turn a 16 px solar disc into a glow
 *  hundreds of pixels wide. Keep a compact core and very faint wings. */
export const COMPACT_BLOOM_FACTORS = [1, 0.32, 0.08, 0.018, 0.004] as const;

/**
 * A single NaN or infinite pixel in the scene buffer is not a dot on
 * the bloom: its high pass carries the poison into the blur, the
 * separable blur spreads it along a row and then down every column,
 * and the additive composite paints a full-height black band over the
 * frame for that one frame. The guard reads the scene through a
 * finite window — bad texels count as dark, and nothing brighter than
 * a half-float can hold goes in — so a bad pixel stays a pixel.
 */
export function guardBloomInput(bloom: UnrealBloomPass): void {
  const material = bloom.materialHighPassFilter;
  material.fragmentShader = material.fragmentShader.replace(
    'vec4 texel = texture2D( tDiffuse, vUv );',
    `vec4 texel = texture2D( tDiffuse, vUv );
    bvec3 bad = bvec3(isnan(texel.x) || isinf(texel.x), isnan(texel.y) || isinf(texel.y), isnan(texel.z) || isinf(texel.z));
    texel.xyz = clamp(
      mix(texel.xyz, vec3(0.0), vec3(bad)),
      0.0,
      ${BLOOM_INPUT_MAX.toFixed(2)}
    );
    texel.w = 1.0;`,
  );
  material.needsUpdate = true;
  bloom.compositeMaterial.uniforms.bloomFactors.value = [...COMPACT_BLOOM_FACTORS];
}
