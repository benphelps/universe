# 04 — Planet Level: Types, Interiors, Atmospheres, Climate, Appearance

Turns a system slot (mass, composition, orbit, stellar context) into a fully characterized world. Everything the surface level (07) and renderer (08) need — colors, clouds, ice caps, banding, volcanism — is decided here by physics, not by picking from an art table.

## Generation pipeline

```
slot (mass, composition, a, e) + star + age
  → bulk: radius, density, gravity, interior structure
  → rotation & obliquity → tidal state
  → atmosphere: retention → composition → pressure → greenhouse
  → climate: T_eq → surface T field → phases of water → clouds/ice
  → classification + appearance parameters
```

### 1. Bulk properties

- **Mass–radius relations** by composition: rocky `R/R⊕ ≈ (M/M⊕)^0.27` (valid to ~10 M⊕, iron-rich smaller, water-rich larger); volatile-envelope worlds sit above the **radius valley** (~1.8 R⊕) — envelope fraction sampled, radius from core+envelope model; giants saturate near ~1 R_J across 0.4–13 M_J (degenerate interior), with **hot-Jupiter inflation** for strongly irradiated giants.
- Surface gravity, escape velocity, bulk density derived; oblateness from rotation rate (`J₂`-level flattening — fast-spinning giants visibly oblate).
- **Interior structure** (layer stack by differentiation): iron core fraction (sampled around stellar Fe abundance), silicate mantle, crust; ice layers / high-pressure ice for water worlds; metallic-hydrogen interior for giants. Outputs: core size, **heat budget** = radiogenic (declines with age) + primordial + tidal (from e and a via tidal dissipation scaling).
- **Magnetic field**: dynamo heuristic — convecting conductive layer (molten iron / metallic H / salty ocean) + sufficient rotation → field strength scale; drives aurorae and (with 07) surface weathering context.
- **Geological activity level** from heat budget vs. mass (small worlds are dead; Earth-mass with heat → tectonics likely; heat without mobile lid → stagnant-lid volcanism, Venus-style resurfacing) — the key input to terrain style in 07.

### 2. Rotation & tidal state

- Primordial spin (hours-scale for giants, ~10–30 h terrestrial) → **tidal despinning** vs. age and `a`: inside the lock radius → synchronous (eyeball worlds); near-resonant capture possible for eccentric orbits (3:2 Mercury-style); otherwise primordial with obliquity sampled broadly (Uranus-class tipped worlds occasionally — large moonless terrestrials get chaotic-obliquity flavor).
- Day length + obliquity + eccentricity fully determine the insolation pattern used by climate.

### 3. Atmosphere

- **Retention physics — the "cosmic shoreline"**: compare escape velocity to thermal speed of each candidate gas at exobase temperature (Jeans parameter `λ = v_esc²/v_th²`), scaled by stellar XUV history (M-dwarf planets lose more). Determines which species survive over the body's age: H/He only on massive/cold worlds → N₂/CO₂/CH₄ mid-tier → airless below the line.
- **Composition classes**: primordial H/He (giants, mini-Neptunes), CO₂ (Venus/Mars-type), N₂–O₂-analog (temperate geologically active worlds; O₂ flagged as biotic option), N₂–CH₄ (Titan-class cold), steam (runaway), SO₂-tinged (volcanic), sodium-thin exospheres (lava worlds).
- **Surface pressure** sampled log-normal per class, scaled by gravity and volatile inventory; **scale height** `H = kT/(mg)` derived (feeds both climate and the visual atmosphere depth in 08).
- **Greenhouse**: gray-atmosphere model `T_s⁴ ≈ T_eq⁴ (1 + ¾τ)` with optical depth τ from composition + pressure — reproduces Venus (huge τ), Earth (+33 K), Mars (+5 K) behavior from one formula.

### 4. Climate (deterministic energy-balance model)

- `T_eq = T_eff √(R★/2a) (1−A)^¼` with albedo solved self-consistently (ice and clouds raise A → iterate to fixpoint; produces genuine **snowball bistability**).
- **Latitudinal energy balance**: 1-D insolation-vs-latitude with obliquity + eccentricity + heat transport (pressure-dependent) → temperature by latitude/season → **ice-cap extent, freeze/boil lines for water**, precipitation proxy from evaporation + circulation cells (Hadley banding by rotation rate).
- Synchronous worlds get substellar/antistellar EBM instead (day-side sea, night-side ice; terminator habitability).
- Output: `ClimateField` (coarse latitudinal/longitudinal T, precip, ice fraction) — 07 turns it into terrain-resolution detail; 08 uses it for cloud and ice visuals.

### 5. Classification (emergent, not assigned)

Labels derive from the physics above — used for naming/UI, never as generation input: lava world, desert world, ocean world, temperate terrestrial, snowball, Venus-class hothouse, Mars-class cold desert, Titan-class, mini-Neptune, ice giant, gas giant, hot Jupiter, iron world, carbon world (C/O-rich systems), rogue-adjacent cold wanderers (outer far orbits).

### 6. Appearance parameters (consumed by 07/08)

- **Terrestrials**: surface palette from actual mineralogy + oxidation (basalt grays, Mars-red hematite where CO₂+history fits, sulfur tints on volcanics), ocean color from depth + dissolved chemistry, ice/snow albedo, cloud coverage/type from climate, night-side lava glow on volcanic worlds, aurora ovals where field + wind exist.
- **Giants**: band count from rotation rate (fast → many narrow belts/zones), chromophore palette by temperature class (ammonia creams/browns → water-cloud blues → hot alkali-dark), **methane absorption** turns cold ice giants teal/azure via the spectral color pipeline, storm spots (sampled anticyclone inventory with sizes/lifetimes), polar hexagon-flavor vortices, ring shadows.
- **Phase & lighting truth**: terminator position, eclipse/transit shadows, planetshine — all from real geometry at time `t`.

## Data shape

`Planet { seed, orbit, bulk: {M, R, ρ, g, oblateness}, interior, spin: {period, obliquity, locked}, magneticField, atmosphere?: {composition, P₀, H, τ, hazes}, climate: ClimateField, hydrosphere?, appearance: AppearanceParams, moons: Moon[] (05), rings?: RingSystem (05) }`

## Testing targets

- Fixtures: Earth inputs → ~288 K surface, N₂-capable, liquid water band; Venus inputs → runaway ~735 K; Mars inputs → thin CO₂, subfreezing; Jupiter inputs → ~1 R_J, banded, strong field; Uranus-class → methane-teal chromaticity.
- Radius-valley histogram appears in sampled populations; airless/atmosphere boundary tracks the shoreline relation.
- Climate fixpoint converges for all sampled worlds; snowball hysteresis reproducible.
