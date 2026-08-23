# Architecture

## Stack

| Concern | Choice | Rationale |
| --- | --- | --- |
| Language | TypeScript (strict) | Type safety across a large procedural data model |
| Build | Vite | Fast dev server, worker bundling, zero-config TS |
| Rendering | Three.js on WebGL2 | Mature scene graph, custom shader support; `WebGPURenderer` is a drop-in upgrade path for compute-heavy terrain/atmosphere work |
| Parallelism | Web Workers (+ OffscreenCanvas where useful) | Generation must never block the frame loop |
| Testing | Vitest | Unit + property tests for physics invariants |

## Layering

Three strict layers. Dependencies point downward only.

```
app/        UI shell, camera, time controls, navigation
render/     Three.js scenes, materials, shaders, LOD streaming
universe/   Pure procedural model: plain-data bodies from seeds
core/       RNG, hashing, math, units, noise, constants
```

- `universe/` has **zero rendering dependencies** — no Three.js imports, no DOM. Every generator is a pure function `(seed, context) → model`. This makes the whole simulation testable headless and runnable in workers.
- `render/` consumes models and owns all GPU concerns. It never generates properties itself; anything visible must exist in the model first.
- `core/` is shared leaf code: deterministic RNG, unit types, Kepler solvers, noise primitives, physical constants, blackbody/color math.

## Module layout (wide, not tall)

```
src/
  core/
    rng/          seeded PRNG, hash-based seed derivation, distributions
    math/         vectors, kepler solver, rotations, interpolation
    noise/        simplex/ridged/fbm/domain-warp primitives
    units/        SI + astronomical unit types and conversions
    physics/      constants, blackbody, gravity, tides, scattering
    color/        Planck spectrum → CIE XYZ → sRGB pipeline
  universe/
    galaxy/       sector grid, density model, star sampling
    star/         mass sampling, evolution, classification, remnants
    system/       disk model, orbit architecture, stability, zones
    planet/       bulk properties, interior, atmosphere, climate
    moon/         satellite systems, tidal state
    rings/        ring system generation
    smallbody/    asteroids, comets, belts
    surface/      terrain fields, craters, hydrology, biomes
  render/
    scale/        floating origin, camera-relative transforms, depth strategy
    starfield/    background stars, milky way band
    star/         photosphere, corona, flare materials
    planet/       terrain meshing (quadtree cube-sphere), surface materials
    atmosphere/   scattering shaders (sky + limb)
    rings/        ring geometry + shadowing
    smallbody/    instanced asteroid fields, comet tails
    fx/           HDR pipeline, bloom, tone mapping, lens effects
  app/
    ui/           overlays, body inspector, system map
    camera/       controllers per context (system, orbit, surface)
    time/         simulation clock, time-scaling controls
  workers/        generation worker entry points + message protocol
```

File-size discipline: one concept per file. A generator that grows past ~200 lines gets split by sub-concern (e.g. `planet/atmosphere/composition.ts`, `planet/atmosphere/climate.ts`), not extended.

## Data flow

```
seed ──► universe model (lazy, pure, plain data) ──► render adapters ──► GPU
                     ▲                                     │
                     └──────── workers generate ◄──────────┘  (LOD demand)
```

1. **Models are plain serializable objects.** `Star`, `Planet`, `TerrainChunk` etc. are interfaces with numbers/arrays only — safe to move across worker boundaries via structured clone (heavy fields as transferable typed arrays).
2. **Lazy expansion.** A `StarSystem` is generated only when approached; a planet's `SurfaceField` only when its terrain is needed; a `TerrainChunk` heightmap only when the quadtree subdivides to it. Each expansion is pure and repeatable, so nothing needs caching to disk — caches are memory-only and evictable.
3. **Workers own heavy generation.** Heightmap synthesis, crater fields, and asteroid belt instancing run off-thread; the main thread only assembles geometry/materials from returned buffers.

## Determinism

Single 64-bit universe seed at the root. Every entity derives its seed by hashing the parent seed with a stable path key (`hash(parentSeed, "planet", index)`). Rules:

- Generators may consume randomness **only** from their own derived stream — never from a shared or global RNG, so generation order can never affect results.
- Any-time access: positions at time `t` come from closed-form Kepler propagation, never accumulated integration, so `t` can jump arbitrarily and stay exact.
- Property tests pin this down: same seed twice → deep-equal models; sibling generation order shuffled → identical results.

## Scale handling

The universe spans ~10⁻¹ m (surface detail) to ~10²¹ m (galactic distances). Strategy:

- **Doubles on CPU**: all model positions in SI doubles (JS numbers), hierarchical frames (galaxy → system barycenter → body → surface) so magnitudes stay small within each frame.
- **Camera-relative rendering**: the render layer rebases all positions relative to the camera each frame before casting to float32 (floating origin).
- **Split scene scales**: near scene (real scale) + far scene (distant bodies rendered as scaled-down proxies / sprites at correct angular size and brightness), composited back-to-front; logarithmic depth buffer within each.

## Validation strategy

The Solar System is the fixture. Generators are validated by feeding them Sun/Jupiter/Earth-like inputs and asserting outputs land within observed ranges (Sun's color and luminosity, Earth's equilibrium temperature, Jupiter's radius, Moon's lock state, Kirkwood gap positions). Statistical generators get distribution tests (e.g. sampled IMF matches Kroupa slopes within tolerance).
