# 06 — Small Bodies: Asteroids, Comets, Belts

The population layer between planets and dust: belts hold millions of bodies that must feel individually real up close and statistically real in aggregate. The trick is representing populations as *density + distribution functions* (03 reservoirs) and instantiating individual bodies lazily and deterministically only where the camera looks.

## Population model

### Size–frequency distribution

- Cumulative power law `N(>D) ∝ D^−q` with collisional-equilibrium slope q ≈ 2–2.5, calibrated so a main-belt-class belt holds a few Ceres-class dwarfs, ~10⁶ km-class bodies, and unbounded rubble downward (instantiated only to the LOD-relevant floor).
- **Deterministic instantiation**: belts are divided into orbital-space cells (a, e, i bins × mean-anomaly sectors); each cell seeds its own bodies from `hash(beltSeed, cell)` — any cell can materialize independently, at any detail floor, and always identically.
- Largest members (dwarf-planet class: Ceres/Vesta/Pluto analogs) are promoted to full 04-pipeline bodies (differentiated, possible brine layers, full surfaces).

### Dynamical families

- Collisional families: clusters in (a, e, i) sharing composition and fresh (brighter) surfaces — a parent-breakup story per family, ages staggering the space-weathering tint.
- Resonant groups (Hilda-analog 3:2 triangles, Trojans at L4/L5 with tadpole libration), scattered-disc high-e objects, detached sednoids for flavor.

## Asteroids (individual bodies)

- **Taxonomy by zone**: S-type silicaceous (inner belt, reddish-gray, higher albedo), C-type carbonaceous (outer belt, dark neutral ~0.05), M-type metallic (rare, exposed-core radar-bright); ice-rich D/P beyond.
- **Shape**: sub-~300 km bodies are non-spherical — base triaxial ellipsoid (sampled elongation) + low-order spherical-harmonic lumps + crater stamping + regolith noise; contact binaries (~15%: bilobed Arrokoth/67P silhouettes); rubble-pile vs monolith flag by size.
- **Spin**: period distribution by size with the **rubble-pile spin barrier** (~2.2 h floor for >200 m rubble piles; small monoliths may tumble at minutes); non-principal-axis tumbling flag for slow rotators; YORP-flavored pole clustering.
- **Satellites**: ~15% of >1 km bodies get a small companion or moonlet (binary asteroids), tidally evolved separations.
- **Surface**: crater SFD by age, regolith ponds in lows, boulder fields near young craters, space-weathering darkening/reddening with surface age — all via the 07 machinery in "airless small body" mode with tri-axial gravity (slopes matter: material flows toward local potential lows).

## Comets

- Sourced from 03 reservoirs: Jupiter-family analogs (low-i, short period, from the scattered disc) and long-period/near-isotropic ones (from the Oort-like cloud, e → 1, any inclination).
- **Nucleus**: km-scale, extremely dark (albedo ~0.04), bilobed-prone, volatile-rich layers.
- **Activity is a function of heliocentric distance at time `t`** (any-time exact): water sublimation ramps inside ~3 AU (CO/CO₂ species allow distant activity for some) → coma radius, dust production, jet vents from rotating nucleus.
- **Two tails, physically distinct**:
  - **Ion tail**: straight, anti-solar, filamentary, CO⁺ blue tint, disconnection events during activity spikes.
  - **Dust tail**: broad, curved (syndyne arcs — particles on their own Kepler orbits after radiation-pressure kick), sunlight-colored/yellowish.
- Orbit-history flavor: dynamically new (bright, outburst-prone) vs aged (crusted, feeble); sungrazer death-plunges as rare spectacle.

## Interplanetary medium (aggregate visuals)

- **Zodiacal light**: line-of-sight integral through the belt-plane dust density — a real glow wedge along the ecliptic from any viewpoint.
- Meteor streams: comet orbits shed debris tubes; a planet crossing one gets shower radiants (visual hook for surface-view skies).

## Data shape

`Belt { seed, aRange, eDist, iDist, sfd, taxonomy mix, families[], resonances[] }`
`SmallBody { seed, elements, D, shape: ShapeSpec, spin: {P, poleDir, tumbling}, taxonomy, albedo, companion?, activity? (comets) }`

## Visual deliverables

- Belt fields as GPU-instanced impostors → mesh LOD on approach → full 07 surface at landing scale; correct *sparse reality* (belt flythrough is mostly empty space — density is honest, with a UI overlay option to visualize orbits instead).
- Comet apparition end-to-end: bare nucleus far out → coma ignition → twin tails growing/rotating anti-solar through perihelion, ion tail always sun-opposed, dust tail lagging curved.
- Zodiacal glow and belt bands in wide shots; occultations/conjunctions as observable events.

## Testing targets

- SFD regression: instantiated counts per size bin match the power law across LOD floors and cell orders.
- Kirkwood gaps emerge in the (a, N) histogram of instantiated main-belt-analog cells (inherited from 03 element sampling).
- Comet tail geometry: ion tail anti-solar within tolerance at all sampled anomalies; dust-tail curvature sign matches orbital motion.
- Determinism: revisiting a belt cell after eviction reproduces identical bodies.
