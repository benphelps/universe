# 05 — Moons & Rings: Satellite Systems, Tidal Physics, Ring Structure

Moons reuse the planet machinery (04/07) at smaller scale — a moon *is* a body with bulk, surface, and possibly atmosphere — plus the physics unique to satellites: formation channel, Hill-sphere limits, tidal heating, and the moon/ring boundary at the Roche limit.

## Generation pipeline

```
planet + system context
  → satellite budget & formation channels
  → orbit slots within the Hill sphere
  → per-moon bodies (via 04 pipeline, moon-scaled)
  → tidal state: locking, heating, resonances
  → ring system (if any): extent, structure, composition
```

### 1. Formation channels (sets each moon's character)

- **Co-accretion (regular moons)**: giants build satellite systems from circumplanetary disks — prograde, low-inclination, near-circular, ice/rock mix; total satellite mass ≈ 10⁻⁴ of the planet (Canup–Ward scaling) split among a handful of majors (Galilean-style) + small inner moons.
- **Giant impact**: terrestrials can host one large moon (Luna-class, iso-composition with the planet's mantle, initially close and tidally receding — current distance from age) — also the mechanism that grants large-moon obliquity stabilization noted in 04.
- **Capture (irregular moons)**: distant, inclined, often retrograde, elongated captured asteroids/KBO-class bodies (Triton-class rare large captures get circularized close-in and retrograde, dooming them to future Roche disruption); Phobos-class doomed low orbiters on terrestrials.

### 2. Orbital placement

- All satellite orbits live inside the **Hill sphere** `r_H = a(1−e)(M_p/3M★)^⅓`: stable prograde region ≲ 0.4 r_H, retrograde ≲ 0.7 r_H — irregulars populate the outer region.
- Inner boundary at the **Roche limit** `d ≈ 2.44 R_p (ρ_p/ρ_m)^⅓` (fluid) — below it, material is rings, not moons; rubble moons stray slightly inside on borrowed time.
- Regular-moon spacing in mutual Hill radii like 03; **resonant chains seeded deliberately** (Laplace-style 1:2:4) because they drive the tidal heating story.
- Tidal migration vs. age: inner moons recede (or decay, inside synchronous orbit), so older systems are wider — computed analytically at generation.

### 3. Tidal physics (the payoff of moons)

- **Locking**: `t_lock ∝ a⁶/M_p²` — virtually all major moons are synchronous → permanent near/far sides; libration from eccentricity.
- **Tidal heating**: `Q`-scaled dissipation from eccentricity maintained by resonances → per-moon heat flux. Outcomes across the flux scale: dead cratered ice → **subsurface ocean** (Europa-class: young chaotic ice shell, ridges) → **cryovolcanic** (Enceladus-class: south-polar jets feeding a tenuous ring) → **volcanic** (Io-class: sulfur palette, no craters, active plumes). This heat enters the 04 heat budget so 07 renders the right surface.
- Moon-scaled atmospheres are rare but reachable (Titan-class N₂–CH₄ on large cold moons — the 04 shoreline logic handles it).

### 4. Rings

- **Occurrence**: rich systems around cold giants (ice rings darken/redden with proximity to the star), tenuous dusty rings elsewhere, rare rocky rings on terrestrials (recent disruption), transient plume-fed rings (E-ring analog).
- **Structure computed, not painted**: inner edge near the atmosphere/Roche interior, outer edge near Roche; **gaps at moon resonances** (Cassini-division analog at 2:1 of a major moon) and shepherded narrow ringlets with their shepherd moonlets; density waves and edge waviness as noise keyed to real resonance locations; embedded moonlets with propeller gaps.
- **Composition → optics**: water-ice (bright, ~0.8 albedo) vs rocky/dusty (dark ~0.05, Uranus-style charcoal); particle-size distribution sets forward-scattering behavior (backlit rings glow — the renderer's phase-function input) and translucency for the planet-surface shadow bands.

## Data shape

`Moon = Planet` (same interface, moon-scaled) `+ { channel, tidalHeatFlux, librationAmp }`
`RingSystem { innerR, outerR, ringlets: [{r₀, width, opticalDepth, albedo, hue}], gaps: [{r, source}], particleScale, shepherds: Moon[] }`

## Visual deliverables

- Moons transit and eclipse correctly (shadows on the parent from real geometry at `t`); Galilean-style resonance dances visible at high time-scale; ring shadows band the parent's face, parent shadow sweeps the rings.
- Io-class glowing vents on the night side, Enceladus-class backlit jets, Europa-class ridge networks (07 surface styles).
- Rings from any angle: edge-on vanishing thinness, backlit forward-scatter glow, translucent star/planet visibility through them.

## Testing targets

- Fixtures: Earth–Moon (single large locked moon, ~60 R⊕ current spacing at 4.5 Gyr); Jupiter fixture yields ~4 majors in resonance with Io-heat > Europa-heat > Ganymede-heat ordering; Saturn fixture yields bright icy rings with a major resonance gap.
- No moon generated inside its Roche limit (unless flagged doomed-decaying); all satellite orbits inside stability fractions of the Hill sphere.
- Ring gap radii match resonance arithmetic against the generated moon inventory.
