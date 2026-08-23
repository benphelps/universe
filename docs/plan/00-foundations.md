# 00 — Foundations: Seeding, RNG, Units, Math, Time

The substrate every other level builds on. Nothing here is visible on screen, but every level's correctness and determinism depends on it.

## Seeding & RNG

- **Hierarchical seed tree.** One 64-bit root seed. Child seeds derive via a stable hash: `childSeed = hash64(parentSeed, kindTag, index)`. Kind tags are string constants (`"sector"`, `"star"`, `"planet"`, `"moon"`, `"chunk"`), so inserting new kinds never perturbs existing ones.
- **PRNG**: PCG32 (or sfc32) seeded per-entity — small state, excellent statistical quality, trivially portable to GLSL/WGSL if shaders need matching streams. Implemented once in `core/rng`, consumed everywhere.
- **Distribution toolkit** in `core/rng/distributions`:
  - uniform, normal (Box–Muller), log-normal, Rayleigh, exponential
  - bounded power-law via inverse CDF (IMF, crater/asteroid size-frequency)
  - piecewise power-law (broken power laws like the Kroupa IMF)
  - weighted discrete choice (spectral peculiarities, planet type tables)
  - Poisson-disc / low-discrepancy sequences (star placement, crater placement)
- **Rules**: every generator receives its own `Rng` instance; no global RNG; draw counts inside a generator are fixed per code path so refactors don't shift sibling results (draws happen up-front into named locals).

## Units & constants

- **Internal unit system**: SI doubles. Astronomy-friendly wrappers (`AU`, `SOLAR_MASS`, `EARTH_RADIUS`, `JUPITER_MASS`, parsec, year) are conversion constants, not types at runtime — but TypeScript branded types (`Meters`, `Kilograms`, `Kelvin`, `Seconds`, `Watts`) keep unit errors compile-time visible at API boundaries.
- **`core/physics/constants`**: G, σ (Stefan–Boltzmann), k_B, h, c, Wien's b, standard atmospheric molar masses. One authoritative file.

## Math library (`core/math`)

- Vec2/Vec3 double-precision ops (render layer converts to float32 at the boundary).
- **Kepler solver**: eccentric anomaly from mean anomaly (Newton–Raphson with Markley-style starter), elliptical + hyperbolic branches. Orbital elements ⇄ state vectors both directions.
- Orbital element type: `{ a, e, i, Ω, ω, M₀, epoch }` plus derived period via `T = 2π√(a³/μ)`.
- Rotation utilities: axial tilt frames, quaternion from axis/angle, body-fixed ⇄ orbital frame transforms.
- Interpolation/easing, smoothstep families, remap helpers used across generation.

## Noise library (`core/noise`)

Seeded, deterministic, dimension-3 first (spherical domains dominate):

- Simplex/OpenSimplex2 base noise (seeded gradient tables from the entity RNG)
- fBm, ridged multifractal, billow combinators
- Domain warping (single and dual)
- Cellular/Worley (crater-adjacent patterns, cloud cells)
- Curl noise (atmospheric flow fields)

All noise samplers are pure `(x, y, z) → value` closures built from a seed, usable identically on main thread and workers. Shader-side mirrors (GLSL) live in `render/`, kept numerically compatible where visuals must match model data.

## Color science (`core/color`)

Correct star and daylight colors are non-negotiable, so the pipeline is spectral:

1. **Planck's law** `B(λ, T)` sampled 380–780 nm.
2. Integrate against **CIE 1931 2° color-matching functions** → XYZ.
3. XYZ → linear sRGB (D65 matrix), luminance-normalized.
4. Out-of-gamut handling by desaturation toward the white point (never per-channel clamping, which shifts hue).
5. Cached lookup: temperature → chromaticity curve (1,000 K–200,000 K) baked into a table for cheap runtime queries and shader upload.

The same machinery handles arbitrary spectra later (emission nebulae, absorption-filtered light through atmospheres).

## Time model

- **Simulation epoch**: single `t` in seconds since universe epoch, held as a double (precision is sufficient: μs resolution over ~300,000 years; galaxy-scale time offsets use a separate coarse epoch component if ever needed).
- **Closed-form propagation**: every orbital position is `elements + t → state`, O(1) for any `t`. No accumulated integration in the base universe — time can be scrubbed, jumped, or run at any speed with zero drift.
- **Slow processes are functions of age, not simulation**: stellar evolution stage, tidal locking, crater density, ring spreading are all computed from body age at generation time, not evolved live.
- **Rotation**: body orientation is `θ = θ₀ + ωt` around the tilt axis — same any-time property.
- N-body effects we care about (resonances, Lagrange points, ring shepherding) are *encoded statistically at generation* (e.g. resonant elements assigned directly) rather than integrated, keeping any-time access exact. Live numerical integration is reserved for a future gameplay layer (spacecraft), outside the base universe.

## Worker protocol (`workers/`)

- Request/response messages: `{ requestId, kind, seedPath, params }` → `{ requestId, buffers }` with transferable `Float32Array`/`Uint8Array` payloads.
- Workers import only `core/` + `universe/` (no DOM, no Three.js) — enforced by the layering rule, verified by a lint boundary check.
- A small scheduler on the main thread handles priority (camera-near chunks first) and cancellation (stale LOD requests dropped).

## Testing targets for this level

- Seed determinism: identical seeds → deep-equal outputs across runs and across main-thread/worker execution.
- Kepler solver: round-trip elements → state → elements to 1e-9; energy/angular-momentum consistency along an orbit.
- Color: G2V temperature (5,772 K) lands near solar white (x≈0.326, y≈0.335 chromaticity); Wien-peak sanity across classes.
- Distribution shape tests: KS-style checks on IMF and power-law samplers.
