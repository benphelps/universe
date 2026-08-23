# 02 — Star Level: Physics, Classification, Color, Visuals

The first level we implement. Input: seed + context from the galaxy level (`[Fe/H]`, age, population). Output: a complete physical star (or multi-star) model plus everything rendering needs for a photoreal star at any distance.

## Generation pipeline

```
seed + (age, [Fe/H]) 
  → initial mass (IMF)
  → evolutionary stage (age vs lifetime)
  → L, T_eff, R at current stage
  → spectral class + luminosity class
  → color (spectral pipeline)
  → rotation, activity, variability
  → multiplicity (companions ⇒ recurse)
```

### 1. Initial mass — Kroupa IMF

Broken power law `ξ(m) ∝ m^−α`, sampled by piecewise inverse CDF:

| Range (M☉) | α | Outcome |
| --- | --- | --- |
| 0.01–0.08 | 0.3 | Brown dwarfs (L/T/Y — see below) |
| 0.08–0.5 | 1.3 | M dwarfs (the majority of all stars) |
| 0.5–150 | 2.3 | K through O |

Upper cutoff modulated by population (halo stars that massive are long dead — resolved by the age check anyway).

### 2. Main-sequence properties (piecewise empirical relations)

- **Luminosity**: `L/L☉ = 0.23 M^2.3` (M < 0.43), `M^4` (0.43–2), `1.4 M^3.5` (2–55), `∝ M` above (Eddington-flattened).
- **Radius**: `R/R☉ ≈ M^0.8` (M < 1), `M^0.57` (M ≥ 1).
- **Effective temperature** from Stefan–Boltzmann: `T_eff = (L / 4πR²σ)^¼` — keeps L, R, T mutually consistent by construction.
- **Metallicity correction**: metal-poor stars slightly hotter/bluer at fixed mass (small T_eff offset per dex).
- **Main-sequence lifetime**: `t_MS ≈ 10 Gyr · (M/M☉)/(L/L☉)`.

### 3. Evolutionary stage from age

Compare system age to `t_MS` (fractional age `f = age/t_MS`):

- `f < 1` — main sequence; apply modest luminosity brightening across the MS (Sun-like stars brighten ~30% over their MS life).
- `1 < f` and M < ~8 M☉ — **subgiant → red giant branch** (R up to 10–100 R☉, T_eff → 3,000–4,500 K) → **horizontal branch / red clump** → **AGB** (R to 200–400 R☉, thermal pulses, heavy mass loss) → **planetary nebula** (brief; a rendered nebula shell around the emerging core) → **white dwarf**.
- M ≈ 8–20 M☉ — supergiant phases → core-collapse: **neutron star** (supernova remnant nebula if recent).
- M ≳ 20 M☉ — **black hole**.

Stage timing uses simple parameterized track segments (fractions of `t_MS` per phase, interpolated L/T/R per phase) — tuned so an HR diagram of a random sample reproduces the real one (dense main sequence, giant branch, white dwarf sequence).

### 4. Compact objects & substellar

- **White dwarf**: mass from initial–final mass relation (~0.5–0.7 M☉ typical), Earth-sized radius `R ∝ M^−⅓`, cooling track gives T_eff from cooling age (100,000 K young → 4,000 K ancient) — color follows automatically.
- **Neutron star**: ~1.4–2 M☉, 12 km; pulsar beams + spin-down age; optionally magnetar flavor.
- **Black hole**: 5–50 M☉; visible only via lensing + accretion (if binary mass transfer) — rendering in 08.
- **Brown dwarfs** (13–80 M_J): L/T/Y classes by cooling age; magenta-to-infrared-dark appearance, aurora-like variability.

### 5. Classification

- **Spectral class** from T_eff: O (>30,000 K), B (10,000–30,000), A (7,500–10,000), F (6,000–7,500), G (5,200–6,000), K (3,700–5,200), M (2,400–3,700), plus L/T/Y, and D-classes for white dwarfs. Numeric subtype interpolated within the band (G2, M5…).
- **Luminosity class** from stage: V (dwarf/MS), IV (subgiant), III (giant), I (supergiant), D (degenerate).
- Human-readable designation generated per star (catalog-style naming — deterministic from seed).

### 6. Color — no shortcuts

`T_eff → Planck spectrum → CIE XYZ → linear sRGB` via the 00 pipeline. This yields the true sequence: deep orange-red M dwarfs → orange K → yellow-white G → white F/A → blue-white B/O. **No green stars, no oversaturated cartoon palettes.** Giants share the same temperature-color law (a K giant and K dwarf are the same color at different luminosities). The renderer receives chromaticity + luminance, applies photographic exposure — bright stars whiten toward the ACES white point exactly like real photography, faint stars keep saturated hue.

### 7. Rotation, activity, variability (all deterministic functions of seed + t)

- Rotation period: mass- and age-dependent (gyrochronology-flavored — young stars fast, Sun-like slow with age; massive stars fast).
- **Starspots**: coverage scales with activity (young + M dwarfs spotty); rendered as photosphere features rotating with the star.
- **Flares**: M dwarfs flare frequently — Poisson process in time from the star's seed (deterministic schedule), luminosity spikes with fast rise/exp decay, blue-shifted color.
- **Pulsators**: instability-strip membership → Cepheids (1–100 d, luminous), RR Lyrae (~0.5 d, old population), Mira variables (AGB, ~330 d, huge amplitude). Brightness/temperature oscillate as periodic functions of `t`.
- **Granulation**: convective cell size scales with surface gravity (giant granules are huge) — drives the photosphere shader's noise scale.
- **Limb darkening** coefficient from T_eff (linear law `I(μ) = I₀[1 − u(1−μ)]`, u ≈ 0.3–0.9 hot→cool) — passed to the shader.

### 8. Multiplicity (companions)

- Multiplicity fraction rises with mass: M dwarfs ~25%, solar ~45%, A ~60%, O/B ~80%+.
- Companion mass ratio `q` roughly uniform (0.1–1); period log-normal (Raghavan: peak `log P[days] ≈ 5`, σ ≈ 2.3); eccentricity thermal-ish above short periods, tidally circularized below ~10 d.
- Hierarchical triples/quadruples allowed when stable (outer/inner period ratio > ~5 with eccentricity margin).
- Output is a **system hierarchy tree** (barycenters + Keplerian orbits), which the system level (03) builds planets around — S-type (circumstellar) and P-type (circumbinary) slots with Holman–Wiegert stability limits.

## Star model (data shape)

`Star { seed, mass, age, feH, stage, L, T_eff, radius, spectralType, rotation: {period, axialTilt}, activity: {spotCoverage, flareRate}, variability?, limbDarkening, chromaticity, companions: OrbitNode[] }`

## Visual deliverables (with 08)

- **Photosphere**: emissive sphere; granulation (animated 3D noise advected by rotation), differential rotation, spots (darker ~3,800 K patches with penumbra), limb darkening, correct chromaticity everywhere.
- **Chromosphere/corona**: thin red-hued rim, streamer-y corona (radial noise billboarding), coronal loops/prominences on active stars (curl-noise arcs along spot latitudes).
- **Photometric correctness at distance**: star sprite brightness follows inverse-square through the HDR pipeline so a star fades continuously from blinding disc → point of correct magnitude and color; the same model feeds the 01 skybox.
- Special renders: white dwarf (tiny brilliant disc), neutron star (pulsar beam cones + nebula), black hole (lensed background + optional accretion disc with Doppler beaming), planetary nebulae, supernova remnants.

## Testing targets

- Sun fixture: `M=1, age=4.6 Gyr, [Fe/H]=0` → L≈1, T_eff≈5,770 K, R≈1, class G2V, white-yellow chromaticity.
- HR diagram of 10⁵ random stars reproduces expected morphology and class fractions (~76% M, ~12% K, ~7.6% G/F…).
- Betelgeuse-like fixture: 18 M☉ at late age → M-class supergiant with R > 700 R☉.
- Deterministic flare/pulsation schedules: same seed + t → same luminosity.
