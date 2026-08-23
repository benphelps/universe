# Roadmap & Progress

Milestones build outward-in: foundations → one star → its system → its worlds → their surfaces → the galaxy around them. Each milestone ends with something visible and a test suite locking its physics. This file is the living progress record — check items off as they land.

## M0 — Foundations ([plan](plan/00-foundations.md))

- [ ] Vite + TypeScript + Vitest scaffold, layering lint rule (`universe/` free of DOM/Three)
- [ ] Seed tree + PCG32 + distribution toolkit, determinism property tests
- [ ] Units/constants, branded types
- [ ] Kepler solver (elements ⇄ state, any-time propagation) + tests
- [ ] Noise primitives (3D simplex, fBm, ridged, warp) seeded + worker-safe
- [ ] Blackbody → CIE → sRGB pipeline + temperature-color LUT + tests
- [ ] Worker protocol + scheduler skeleton

## M1 — The Star ([plan](plan/02-star.md))

- [ ] IMF sampling, MS relations, evolution stages, compact objects, classification
- [ ] Rotation/activity/variability (spots, flares, pulsators) as functions of `t`
- [ ] Multiplicity → system hierarchy tree
- [ ] Star model test fixtures (Sun, M-flare dwarf, red supergiant, white dwarf) + HR-diagram distribution test
- [ ] Render: HDR pipeline + tone mapping + bloom
- [ ] Render: photosphere shader (granulation, limb darkening, spots), corona
- [ ] Render: photometric star sprites (distance fade to correct magnitude/color)
- [ ] Demo: seed → star viewer (orbit camera around any generated star)

## M2 — The System ([plan](plan/03-system.md))

- [ ] Disk recipe, planet slots, element sampling, stability filter
- [ ] Zones (HZ, frost line, lock radius); binary S/P-type placement
- [ ] Belts + resonance structure (Kirkwood arithmetic), reservoirs
- [ ] Fixtures + statistics tests (occurrence, period ratios, stability)
- [ ] Render: system map view, live orbital motion, time controls
- [ ] Demo: seed → explorable system map with placeholder planet spheres

## M3 — Worlds ([plan](plan/04-planet.md))

- [ ] Bulk/interior/mass–radius, rotation & tidal state, magnetic field
- [ ] Atmosphere retention/composition/greenhouse; climate EBM + albedo fixpoint
- [ ] Appearance parameters (terrestrial palettes, giant banding, methane tint)
- [ ] Fixtures (Earth/Venus/Mars/Jupiter/Uranus analogs) + population statistics tests
- [ ] Render: planet spheres with banded giants, atmosphere limb + sky scattering, clouds v1
- [ ] Demo: fly from star to each planet, correct phases/eclipses

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
