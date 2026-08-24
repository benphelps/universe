# Roadmap & Progress

Milestones build outward-in: foundations → one star → its system → its worlds → their surfaces → the galaxy around them. Each milestone ends with something visible and a test suite locking its physics. This file is the living progress record — check items off as they land.

## M0 — Foundations ([plan](plan/00-foundations.md))

- [x] Vite + TypeScript + Vitest scaffold, layering rule enforced by test (`core/`+`universe/` free of DOM/Three)
- [x] Seed tree + PCG32 + distribution toolkit, determinism property tests
- [x] Units/constants
- [ ] Branded unit types at API boundaries
- [x] Kepler solver (elements ⇄ state, any-time propagation) + tests
- [x] Noise primitives (3D simplex, fBm, ridged, warp) seeded + worker-safe
- [x] Blackbody → CIE → sRGB pipeline + temperature-color LUT + tests
- [ ] Worker protocol + scheduler skeleton (deferred to M5, where terrain generation first needs it)

## M1 — The Star ([plan](plan/02-star.md))

- [x] IMF sampling, MS relations, evolution stages, compact objects, classification
- [x] Rotation/activity/variability (spots, flares, pulsators) as functions of `t`
- [x] Multiplicity (flat companion list; the full hierarchy tree lands with 03's system builder)
- [x] Star model test fixtures (Sun, M dwarf, red supergiant, white dwarf, brown dwarf) + population distribution tests
- [x] Render: HDR pipeline + tone mapping + bloom
- [x] Render: photosphere shader (granulation, limb darkening, spots), corona
- [ ] Render: photometric star sprites (distance fade to correct magnitude/color)
- [x] Demo: seed → star viewer (orbit camera around any generated star)

## M2 — The System ([plan](plan/03-system.md))

- [x] Disk recipe, planet slots, element sampling, stability filter
- [x] Zones (HZ, frost line, lock radius); binary S/P-type placement
- [x] Belts + resonance structure (Kirkwood arithmetic), reservoirs
- [x] Fixtures + statistics tests (occurrence, period ratios, stability)
- [x] Render: system map view, live orbital motion, time controls
- [x] Demo: seed → explorable system map with placeholder planet spheres

## M3 — Worlds ([plan](plan/04-planet.md))

- [x] Bulk/interior/mass–radius, rotation & tidal state, magnetic field
- [x] Atmosphere retention/composition/greenhouse; climate EBM + albedo fixpoint
- [x] Appearance parameters (terrestrial palettes, giant banding, methane tint)
- [x] Fixtures (Earth/Venus/Mars/Jupiter/Uranus analogs) + population statistics tests
- [x] Render: planet spheres with banded giants, atmosphere limb, clouds v1 (ground-level sky scattering lands with M5 surfaces)
- [x] Demo: planet view with correct phases and star angular size (eclipses arrive with M4 moons)

## M4 — Moons, Rings, Small Bodies ([plans](plan/05-moons-rings.md), [plan](plan/06-small-bodies.md))

- [x] Satellite budgets, channels, Hill/Roche placement, tidal heating states
- [x] Ring systems with resonance gaps; ring render (phase function, shadows)
- [x] Belt cell instantiation, asteroid shapes/spins, comet activity + tails
- [x] Fixtures (Io calibration, impact moons, resonant chains, Saturn-class rings) + SFD tests
- [x] Render: comet apparitions, moon orbits with eclipse shadows, ring shadows (belt fields landed in M2)
- [ ] Asteroid close-up rendering (shape meshes from the shape spec — lands with M5's small-body surface mode)

## M5 — Surfaces ([plan](plan/07-surface.md))

- [x] Cube-sphere quadtree LOD + worker chunk generation (skirts hide LOD cracks; geomorphing still open)
- [x] Layer stack: tectonics (Worley plate belts), craters, volcanic provinces, erosion smoothing
- [ ] Deeper erosion suites: fluvial valley networks, glacial carving, dune fields
- [x] Ice/snow + biome palettes from climate
- [ ] Airless small-body surface mode (asteroid close-ups)
- [x] Determinism/border tests + world-type fixtures (Earth-like, Moon-like, Mars-like)
- [x] Render: vertex-colored lit terrain, ocean sphere, ground-level sky + aerial fog
- [ ] Scatter instancing (boulders, ground cover)
- [x] Demo: orbit → descend to the ground of any solid world, unbroken

## M6 — The Galaxy ([plan](plan/01-galaxy.md))

- [x] Density model (disks, halo, arms, dust) + deterministic sector sampling
- [ ] Population gradients feeding star properties (age/metallicity by galactic position)
- [x] Procedural sky from local sampling (resolved shells + Milky Way glow with dust reddening) in every view
- [ ] Clusters, OB associations, nebulae
- [x] Magnitude-count regression test (naked-eye counts the right order of magnitude)
- [x] Demo: galaxy view of the real 20 pc neighborhood; click a neighbor to travel — its system is waiting

## M7 — Depth & Polish

- [x] **Unified body viewer** (step 1 of the single universe renderer): planet + surface merged — solid worlds are streamed terrain at every altitude, envelopes are shader spheres, everything else (sun, moons, eclipses, rings, atmosphere, backdrop) shared in one scene.
- [x] **Single universe renderer, step 2**: star view and system map folded into the body scene — the unified viewer holds the whole system (real photospheres, planets on their orbits, belts, comets, companions) around whichever body has focus; star/system/planet are camera presets, the map is an orbit-line overlay that appears at map altitudes, and one wheel ride runs from the system's rim to a planet's ground.
- [x] **Single universe renderer, step 3**: galaxy view folded in — the 30 pc neighborhood rides in the scene as true 3D points that double as the night sky's near field (the backdrop keeps only far shells and the Milky Way glow), so every view is a preset of the one renderer and a single wheel ride runs from interstellar space to any planet's ground. Travel to a neighbor rebuilds the system in place. Open: whole-disk galaxy rendering beyond the neighborhood (clusters/nebulae land with the M6 leftovers).
- [ ] Clouds over terrain (the planet view's cloud layer has no surface-view counterpart yet)
- [ ] Volumetric clouds; multiple-scattering atmospheres; black-hole lensing pass
- [ ] Exotic showcases: circumbinary worlds, eyeball planets, Io-class volcanism, pulsar systems
- [ ] Performance hardening (belt LOD, chunk budgets, memory eviction)
- [ ] WebGPU renderer evaluation

---

## Log

- **2026-08-23** — Repository created; architecture and all level plans (00–08) written.
- **2026-08-23** — M0 core landed (seed tree, RNG/distributions, Kepler solver, noise, spectral color pipeline) and M1 star level landed (full generator with evolution/classification/activity/multiplicity, HDR photosphere+corona rendering, interactive viewer). 33 tests green; verified in-browser across K/M/A dwarfs and a red giant.
- **2026-08-23** — Corona reworked into a star-anchored 3D field: true parallax when orbiting, co-rotation with the surface, activity-driven structure over spot bands.
- **2026-08-23** — M2 system level landed: disk→slots→elements→stability generation with S/P-type binaries, zones, Kirkwood belts, reservoirs, and end-state effects (engulfment, supernova sterilization); system map view with live Keplerian motion and shearing belts. 45 tests green; verified in-browser on a circumbinary resonant chain and an M-dwarf eyeball-world system with a gapped asteroid belt.
- **2026-08-23** — M3 planet level landed: full characterization (bulk, interior, rotation, atmosphere retention/greenhouse, climate fixpoint with snowballs and biospheres, appearance) plus planet rendering (solid worlds, banded giants, scattering limbs) and a true-scale planet view with exact phases. 54 tests green; verified in-browser on a biosphere crescent, a banded gas giant, a brown-dwarf-lit mini-Neptune, and a locked ocean world.
- **2026-08-23** — M4 moons/rings/small bodies landed: satellite systems with Io-calibrated tidal heating (volcanic/cryovolcanic/subsurface-ocean states), Roche-limit rings with moon-resonance gaps, deterministic belt asteroid instantiation, and comets. Rendering: analytic eclipse shadows (moon transits, ring shadow bands), forward-scattering rings, live moons in the planet view, comet apparitions in the map. 67 tests green; verified on a ringed super-Jupiter around an L8 brown dwarf.
- **2026-08-23** — Comet legibility and moon discoverability fixes: activity-capped comas, physical dust-tail lag, motion trails; moon orbit guides and adaptive marker dots in the planet view.
- **2026-08-23** — M5 core landed: pure surface fields (plate-belt mountains, lattice-cell craters, erosion, solved sea levels, climate-driven color), worker-streamed cube-sphere quadtree terrain with floating-origin rendering, and the surface view descending from orbit to the ground. 75 tests green; verified on a crater-field Mercury analog and a locked habitable world. Open: fluvial/glacial erosion detail, scatter instancing, geomorphing, asteroid surface mode.
- **2026-08-23** — Surface shakedown from live testing: OrbitControls-based camera (no more flipped axes), seam-free border-ring normals, priority-ordered chunk requests, detail-band cascade to ~100 m features with LOD fading, chunk-aligned water tiles (ocean z-fighting gone), GPU mottling and micro-relief shading, relief-scaled color windows, minimum LOD floor for orbital views.
- **2026-08-24** — Single-renderer step 2: star, system, and planet views unified into one focus-centric scene (km units, focused body at the origin, everything else translated in doubles). The real photosphere is now every planet's sun — the additive sun proxy is gone — with companions on barycentric orbits, other planets at true positions with adaptive markers, belts/comets/zone rings folded in, and the orbit-line map as an altitude-triggered overlay; the sky dome went additive (scattering adds light, never occludes) and scales with surface pressure. One wheel ride runs from the system's rim to any planet's ground. Verified on a 12-planet G system (all presets, click-through, planet→system zoom-out) and a circumbinary brown-dwarf pair.
- **2026-08-24** — Single-renderer step 3: the galaxy view retired as a separate renderer. The neighborhood (every sector star within 30 pc) is now 3D content of the unified scene under a pc-scaled group, photometrically identical to the backdrop stars it replaces but parallax-correct at every altitude; the backdrop carries only far shells and dust glow. Galaxy is a camera preset (focus star, 15 pc altitude, time frozen); the travel panel swaps systems inside the same viewer. Belt point clouds fade below sub-pixel size so distant systems don't bloom into false blobs; near/far planes scale into the interstellar regime. Verified: galaxy preset, neighbor travel (G dwarf → L6 brown dwarf), system→interstellar wheel-out, and the ground night sky retaining its near field.
- **2026-08-23** — M6 core landed: galactic density model with deterministic sectors, per-seed sky fields (resolved star shells + dust-reddened Milky Way glow) rendered as backdrops in every view with daylight washout on surfaces, and the galaxy view — the real 20 pc neighborhood, flyable, with click-to-travel to any neighbor system. 83 tests green. Open: population gradients into star properties, clusters/nebulae.
