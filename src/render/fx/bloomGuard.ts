import type { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

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
    texel.xyz = clamp(mix(texel.xyz, vec3(0.0), vec3(bad)), 0.0, 65000.0);
    texel.w = 1.0;`,
  );
  material.needsUpdate = true;
}
