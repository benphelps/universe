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

- [ ] Satellite budgets, channels, Hill/Roche placement, tidal heating states
- [ ] Ring systems with resonance gaps; ring render (phase function, shadows)
- [ ] Belt cell instantiation, asteroid shapes/spins, comet activity + tails
- [ ] Fixtures (Earth–Moon, Galilean resonance, Saturn-class rings) + SFD tests
- [ ] Render: instanced belt fields, comet apparitions, moon transits
- [ ] Demo: full system tour — rings backlit, belt flythrough, comet at perihelion

## M5 — Surfaces ([plan](plan/07-surface.md))

- [ ] Cube-sphere quadtree LOD + worker chunk generation + geomorphing
- [ ] Layer stack: tectonics, craters, volcanism, erosion suites, hydrology
- [ ] Ice/snow + biome palettes from climate; airless small-body mode
- [ ] Determinism/border tests + world-type fixtures (Earth-like, Moon-like, Mars-like)
- [ ] Render: splat PBR terrain, ocean, scatter instancing, ground-level sky
- [ ] Demo: orbit → descend → stand on any solid world, unbroken

## M6 — The Galaxy ([plan](plan/01-galaxy.md))

- [ ] Density model + sector sampling + population gradients
- [ ] Procedural skybox from local sampling (Milky Way band, dust, nebulae)
- [ ] Clusters/associations; magnitude-count regression test
- [ ] Demo: leave the system — starfield is the real neighborhood; travel to a neighbor star and find its system waiting

## M7 — Depth & Polish

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
