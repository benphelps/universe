import { DUST_ALBEDO, HG_G } from './density';

/**
 * Multiple scattering in dust, as a table.
 *
 * A voxel lit by a star does not only scatter the beam that reaches it
 * directly: light scattered elsewhere in the cloud arrives from every
 * side and scatters again, and for the optical depths real reflection
 * nebulae carry that diffuse field rivals the beam. Marching secondary
 * rays per frame is out of the question, so the transfer is solved
 * once, in the canonical configuration — a point source in an infinite
 * homogeneous medium of the model's own albedo and grain asymmetry —
 * by successive orders of scattering, and kept as a table over the two
 * things a voxel knows: the optical depth back to its source and the
 * scattering angle to the camera (Magnor's reflection-nebula table).
 * The frame shader indexes it with the depth the bake actually marched
 * through the inhomogeneous field, the standard grafting of the
 * canonical solution onto the real cloud; a clump's shadow stays dark
 * at first order and fills with softly diffused light at the higher
 * ones, exactly as real shadows in real nebulae do.
 *
 * Units: the medium has unit scattering opacity, so radius IS optical
 * depth. The table entry M(τ, μ) is normalized so first order alone is
 * e^(−τ)·Φ(μ) with Φ the 4π-scaled Henyey–Greenstein phase — the very
 * factor the frame shader used when it was single-scatter only, so the
 * table drops into its place.
 */

/** Wavelength dependence of dust opacity across the display's
 *  channels: A_R/A_V and A_B/A_V on the R_V = 3.1 curve, V riding
 *  green. Scattering rises where extinction does — the reason
 *  reflection nebulae are blue while transmitted light reddens. */
export const SCATTER_OPACITY_RGB: [number, number, number] = [0.748, 1, 1.324];

/** The same ratios as a hue, luminance-normalized: the blue tilt the
 *  sprite tier's scattered continuum wears, standing in for the per-λ
 *  march only the volume runs. */
export const SCATTER_TINT_RGB: [number, number, number] = (() => {
  const [r, g, b] = SCATTER_OPACITY_RGB;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [r / luminance, g / luminance, b / luminance];
})();

export const SCATTER_TABLE_TAUS = 96;
export const SCATTER_TABLE_MUS = 64;
export const SCATTER_TABLE_TAU_MAX = 20;

/** Where an optical depth sits on the table's log axis, 0..1. */
export function scatterTauCoord(tau: number): number {
  return Math.log1p(Math.min(tau, SCATTER_TABLE_TAU_MAX)) / Math.log1p(SCATTER_TABLE_TAU_MAX);
}

/** The 4π-scaled Henyey–Greenstein phase: (1/4π)∫Φ dΩ = 1. */
export function hgPhase(mu: number, g = HG_G): number {
  return (1 - g * g) * (1 + g * g - 2 * g * mu) ** -1.5;
}

/** Single scattering alone — the table's first order, analytically:
 *  the attenuated beam through the model phase. What the frame shader
 *  computes while the solved table is still on its way. */
export function singleScatterTable(g = HG_G): Float32Array {
  const table = new Float32Array(SCATTER_TABLE_TAUS * SCATTER_TABLE_MUS);
  for (let j = 0; j < SCATTER_TABLE_MUS; j++) {
    const mu = -1 + ((j + 0.5) * 2) / SCATTER_TABLE_MUS;
    const phase = hgPhase(mu, g);
    for (let t = 0; t < SCATTER_TABLE_TAUS; t++) {
      table[j * SCATTER_TABLE_TAUS + t] = Math.exp(-tableTau(t)) * phase;
    }
  }
  return table;
}

/** The optical depth at a table column's texel centre. */
function tableTau(column: number): number {
  const u = (column + 0.5) / SCATTER_TABLE_TAUS;
  return Math.expm1(u * Math.log1p(SCATTER_TABLE_TAU_MAX));
}

/** Solver grid: radii log-spaced from the source standoff (the point
 *  source given a physical size, as the frame shader's scatter floor
 *  gives it) out past the table's reach; directions uniform in μ. */
const NR = 72;
const NMU = 48;
const R_MIN = 0.02;
const R_MAX = 24;

/**
 * The full table, all scattering orders: successive orders around the
 * point source, each order's source function swept into radiance along
 * straight rays and scattered once more, until the next order carries
 * under a thousandth of the first. Deterministic, a few tens of
 * milliseconds — solved once per session and cached by the caller.
 */
export function dustScatterTable(albedo = DUST_ALBEDO, g = HG_G): Float32Array {
  const logMin = Math.log(R_MIN);
  const logStep = (Math.log(R_MAX) - logMin) / (NR - 1);
  const radii = new Float64Array(NR);
  for (let i = 0; i < NR; i++) radii[i] = Math.exp(logMin + i * logStep);
  const mus = new Float64Array(NMU);
  for (let j = 0; j < NMU; j++) mus[j] = -1 + ((j + 0.5) * 2) / NMU;

  // Azimuth-integrated phase kernel k[out][in], column-normalized so a
  // scattering event conserves photons exactly in the quadrature.
  const kernel = new Float64Array(NMU * NMU);
  const AZ = 64;
  for (let jin = 0; jin < NMU; jin++) {
    const si = Math.sqrt(1 - mus[jin] * mus[jin]);
    let column = 0;
    for (let jo = 0; jo < NMU; jo++) {
      const so = Math.sqrt(1 - mus[jo] * mus[jo]);
      let sum = 0;
      for (let az = 0; az < AZ; az++) {
        const cosTheta = mus[jo] * mus[jin] + so * si * Math.cos(((az + 0.5) / AZ) * 2 * Math.PI);
        sum += hgPhase(cosTheta, g);
      }
      const value = ((sum / AZ) * (2 / NMU)) / 2;
      kernel[jo * NMU + jin] = value;
      column += value;
    }
    for (let jo = 0; jo < NMU; jo++) kernel[jo * NMU + jin] /= column;
  }

  // First order analytically: the attenuated beam, radially outward,
  // scattered through the phase. S has the transfer equation's own
  // normalization; the table's comes off at the end.
  const first = new Float64Array(NR * NMU);
  for (let i = 0; i < NR; i++) {
    const flux = Math.exp(-radii[i]) / (16 * Math.PI * Math.PI * radii[i] * radii[i]);
    for (let j = 0; j < NMU; j++) first[i * NMU + j] = albedo * flux * hgPhase(mus[j], g);
  }

  // A source function sampled off-grid: bilinear in (log r, μ), the
  // point source's 1/r² held finite at the standoff.
  const sampleSource = (source: Float64Array, r: number, mu: number): number => {
    if (r >= R_MAX) return 0;
    const clamped = Math.max(r, R_MIN);
    const x = Math.min(NR - 1.001, Math.max(0, (Math.log(clamped) - logMin) / logStep));
    const i0 = Math.floor(x);
    const fx = x - i0;
    const y = Math.min(NMU - 1.001, Math.max(0, ((mu + 1) / 2) * NMU - 0.5));
    const j0 = Math.floor(y);
    const fy = y - j0;
    const a = source[i0 * NMU + j0] * (1 - fy) + source[i0 * NMU + j0 + 1] * fy;
    const b = source[(i0 + 1) * NMU + j0] * (1 - fy) + source[(i0 + 1) * NMU + j0 + 1] * fy;
    return a * (1 - fx) + b * fx;
  };

  const total = Float64Array.from(first);
  let current = first;
  const radiance = new Float64Array(NR * NMU);
  const peakFirst = first.reduce((best, value) => Math.max(best, value), 0);
  for (let order = 2; order <= 40; order++) {
    // Radiance from the previous order's sources: for each point and
    // incoming direction, walk back along the ray, attenuated by the
    // depth walked.
    for (let i = 0; i < NR; i++) {
      const r0 = radii[i];
      for (let j = 0; j < NMU; j++) {
        const mu0 = mus[j];
        let sum = 0;
        let s = 0;
        let ds = 0.004;
        while (s < 21) {
          const mid = s + ds / 2;
          const r = Math.sqrt(Math.max(1e-12, r0 * r0 - 2 * mid * r0 * mu0 + mid * mid));
          const muLocal = Math.min(1, Math.max(-1, (r0 * mu0 - mid) / Math.max(r, 1e-6)));
          sum += sampleSource(current, r, muLocal) * Math.exp(-mid) * ds;
          s += ds;
          ds *= 1.06;
        }
        radiance[i * NMU + j] = sum;
      }
    }
    // Scatter it once more.
    const next = new Float64Array(NR * NMU);
    let peak = 0;
    for (let i = 0; i < NR; i++) {
      for (let jo = 0; jo < NMU; jo++) {
        let sum = 0;
        for (let jin = 0; jin < NMU; jin++) {
          sum += kernel[jo * NMU + jin] * radiance[i * NMU + jin];
        }
        const value = albedo * sum;
        next[i * NMU + jo] = value;
        total[i * NMU + jo] += value;
        if (value > peak) peak = value;
      }
    }
    current = next;
    if (peak < 1e-3 * peakFirst) break;
  }

  // Onto the texture grid, in the shader's normalization: first order
  // alone reads e^(−τ)·Φ(μ). Below the solver's standoff the beam term
  // is analytic and the diffuse term dies as τ² — the geometry of a
  // vanishing shell.
  const table = new Float32Array(SCATTER_TABLE_TAUS * SCATTER_TABLE_MUS);
  for (let j = 0; j < SCATTER_TABLE_MUS; j++) {
    const mu = -1 + ((j + 0.5) * 2) / SCATTER_TABLE_MUS;
    for (let t = 0; t < SCATTER_TABLE_TAUS; t++) {
      const tau = tableTau(t);
      const norm = (16 * Math.PI * Math.PI * Math.max(tau, R_MIN) ** 2) / albedo;
      const diffuse =
        (sampleSource(total, Math.max(tau, R_MIN), mu) - sampleSource(first, Math.max(tau, R_MIN), mu)) *
        norm *
        (tau < R_MIN ? (tau / R_MIN) ** 2 : 1);
      table[j * SCATTER_TABLE_TAUS + t] = Math.exp(-tau) * hgPhase(mu, g) + Math.max(0, diffuse);
    }
  }
  return table;
}

/** Read the table the way the shader's bilinear fetch does. */
export function sampleScatterTable(table: Float32Array, tau: number, mu: number): number {
  const x = Math.min(
    SCATTER_TABLE_TAUS - 1.001,
    Math.max(0, scatterTauCoord(Math.max(0, tau)) * SCATTER_TABLE_TAUS - 0.5),
  );
  const y = Math.min(
    SCATTER_TABLE_MUS - 1.001,
    Math.max(0, ((Math.min(1, Math.max(-1, mu)) + 1) / 2) * SCATTER_TABLE_MUS - 0.5),
  );
  const t0 = Math.floor(x);
  const j0 = Math.floor(y);
  const fx = x - t0;
  const fy = y - j0;
  const a =
    table[j0 * SCATTER_TABLE_TAUS + t0] * (1 - fx) + table[j0 * SCATTER_TABLE_TAUS + t0 + 1] * fx;
  const b =
    table[(j0 + 1) * SCATTER_TABLE_TAUS + t0] * (1 - fx) +
    table[(j0 + 1) * SCATTER_TABLE_TAUS + t0 + 1] * fx;
  return a * (1 - fy) + b * fy;
}
