import type { NoiseSampler3 } from './simplex3';

export interface FractalOptions {
  octaves: number;
  lacunarity?: number;
  gain?: number;
}

/** Fractal Brownian motion over a base sampler, output roughly in [-1, 1]. */
export function fbm(base: NoiseSampler3, options: FractalOptions): NoiseSampler3 {
  const { octaves, lacunarity = 2, gain = 0.5 } = options;
  return (x, y, z) => {
    let sum = 0;
    let amplitude = 1;
    let frequency = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amplitude * base(x * frequency, y * frequency, z * frequency);
      norm += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / norm;
  };
}

/** Ridged multifractal: sharp crests from inverted absolute noise, output in [0, 1]. */
export function ridged(base: NoiseSampler3, options: FractalOptions): NoiseSampler3 {
  const { octaves, lacunarity = 2, gain = 0.5 } = options;
  return (x, y, z) => {
    let sum = 0;
    let amplitude = 1;
    let frequency = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      const ridge = 1 - Math.abs(base(x * frequency, y * frequency, z * frequency));
      sum += amplitude * ridge * ridge;
      norm += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / norm;
  };
}

/** Domain warp: offsets sample positions by a warp field before sampling. */
export function warped(base: NoiseSampler3, warp: NoiseSampler3, strength: number): NoiseSampler3 {
  return (x, y, z) => {
    const wx = warp(x + 31.7, y, z);
    const wy = warp(x, y + 57.3, z);
    const wz = warp(x, y, z + 91.1);
    return base(x + strength * wx, y + strength * wy, z + strength * wz);
  };
}
