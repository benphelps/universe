# 03 — System Level: Disks, Orbital Architecture, Stability

Turns a star (or stellar hierarchy) into a full planetary system: how many planets, what kinds, where, on what orbits — plus belts, comet reservoirs, and the zones (frost line, habitable zone) that drive planet character downstream.

## Generation pipeline

```
star(s) → protoplanetary disk model → planet slots (masses, compositions by zone)
        → orbital elements + resonances → stability filter
        → belts, scattered disc, comet cloud → system inventory
```

### 1. Protoplanetary disk (the "why" behind the architecture)

The disk is not simulated — it is a *closed-form recipe* whose parameters shape sampling:

- Disk mass ≈ 1–10% of stellar mass (log-normal), truncated in tight binaries.
- Surface density profile `Σ(a) ∝ a^−1.5` (MMSN-like), scaled by disk mass.
- **Frost line** `a_ice ≈ 2.7 AU · √(L/L☉)` (T ≈ 170 K in the disk): inside → rock/metal solids only; outside → ices multiply solid mass ~3–4× → giant cores form there.
- Metallicity multiplies solid inventory: giant-planet occurrence scales steeply with [Fe/H] (Fischer–Valenti-like `∝ 10^(2·[Fe/H])`); M dwarfs rarely host gas giants but commonly host compact super-Earth systems — matching Kepler statistics.

### 2. Planet slots

- Occurrence calibrated to Kepler/RV statistics: most stars host planets; super-Earths/mini-Neptunes (1–4 R⊕) are the most common outcome; hot Jupiters are rare (~1%); cold giants moderately common around metal-rich FGK stars.
- Slots seeded outward from the inner edge (silicate sublimation radius ≈ 0.02–0.1 AU) with spacing drawn in **mutual Hill radii** (Δ ~ 10–30, peaked ~20) — this reproduces both packed compact systems and sparse giant systems from one rule.
- Each slot's mass budget comes from local disk surface density × feeding-zone width; composition from zone (rock/iron inside frost line, ice-rich beyond, gas envelope if core reaches ~10 M⊕ while the notional gas disk persists).
- **Migration flavor** applied statistically: a minority of giants relocate inward (hot/warm Jupiters, eccentric after scattering), resonant chains for some compact systems (2:1, 3:2 pairs with near-integer period ratios), Grand-Tack-like truncated inner systems occasionally.

### 3. Orbital elements

- Semi-major axes from slot layout; **eccentricities** Rayleigh-distributed (σ ≈ 0.03–0.05 for packed multis, broader up to ~0.3+ for scattered giants); **mutual inclinations** Rayleigh σ ≈ 1–2°; nodes/arguments/phases uniform.
- All bodies get full Keplerian element sets referenced to the system invariable plane; system plane orientation random on the sphere (star's spin axis roughly aligned, with occasional obliquity outliers).
- **Stability filter** (cheap, analytic): adjacent-pair mutual-Hill spacing ≥ 2√3, chain-stability margin for multis, Hill-sphere non-overlap at closest approach with eccentricity — violating slots are shrunk, merged, or dropped so every emitted system is long-term plausible without integration.

### 4. Multi-star systems

- **S-type** planets (around one component): stable out to ~0.1–0.4 × companion periapsis (Holman–Wiegert); disk truncation shrinks planet inventories.
- **P-type** planets (circumbinary): stable beyond ~2–4 × binary separation, eccentricity-dependent; the sampler respects the critical radius and seeds Tatooine-class worlds there.
- Sky consequences handled downstream: double sunsets, twin shadows, companion star as brilliant point.

### 5. Zones (computed once, consumed by 04/07)

- **Habitable zone** (Kopparapu effective-flux bounds): runaway-greenhouse inner edge `S_eff ≈ 1.05`, maximum-greenhouse outer `S_eff ≈ 0.35`, with M-dwarf spectral corrections; distance `d = √(L/S_eff)` AU.
- **Tidal-lock radius** vs system age (`t_lock ∝ a⁶`): planets inside it are synchronous — eyeball worlds around M dwarfs emerge naturally.
- Frost line (current, for surface volatiles) and silicate line (lava-world zone).

### 6. Belts & reservoirs

- **Asteroid belt** where a giant starved a slot (classically between rock and ice zones): total mass small (~10⁻³ M⊕-scale), **Kirkwood gaps** carved at the giant's mean-motion resonances (3:1, 5:2, 7:3, 2:1) — gap positions computed from resonance arithmetic, not hand-placed.
- **Debris/Kuiper-like belt** beyond the outermost giant: cold classical + scattered populations, resonant families (3:2 "plutino" analogs).
- **Scattered disc & Oort-like cloud**: parameterized reservoirs that source comets (06) — represented as density functions, individual bodies instantiated lazily.
- Trojan swarms at L4/L5 of massive planets (co-orbital elements, tadpole libration rendered as element jitter).

### 7. System inventory (data shape)

`StarSystem { seed, stars: OrbitNode<Star>, planets: Planet[], belts: Belt[], reservoirs, zones: { hz, frostLine, tidalLockRadius }, invariablePlane }` — every child carries full Keplerian elements; positions at any `t` via the 00 solver.

## Visual deliverables

- **System map view**: to-scale orbits with correct eccentric shapes, resonance annotations, HZ band, frost line ring; live body positions at simulation time.
- Real-time motion: inner planets visibly orbit at high time-scale, resonant pairs visibly librate (period-ratio patterns).
- Belt rendering as instanced particle fields with correct radial structure (gaps visible at Kirkwood radii).

## Testing targets

- Solar fixture: Sun-like star + forced classic layout keeps Earth in HZ, frost line ~2.7 AU, Kirkwood gaps at 2.50/2.82/2.96/3.27 AU for a Jupiter at 5.2 AU.
- Statistical: occurrence rates by class match calibration tables; all emitted systems pass the stability filter; period-ratio histogram shows resonance pileups just wide of 2:1 and 3:2.
- Any-time exactness: element propagation at `t` and `t + N·T` agrees to numerical tolerance.
