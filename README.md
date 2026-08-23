# Procedural Universe Simulation

A deep, science-grounded procedural universe: stars, planetary systems, planets, moons, rings, asteroids, and comets — generated deterministically from seeds at every level of detail, from galactic structure down to terrain on a planet's surface. Built on web technology. The universe is the foundation; gameplay comes later.

## Principles

- **Deterministic**: every property of every body derives purely from a hierarchical seed. The same universe seed always produces the same universe, lazily, at any level of detail, with no stored world data.
- **Science-based**: generation follows real astrophysics — initial mass functions, stellar evolution tracks, blackbody colors, protoplanetary disk chemistry, orbital mechanics, mass–radius relations, atmospheric physics, crater statistics. Where the science is statistical, we sample real distributions; where it is mechanistic, we use the real formulas (simplified only as far as fidelity allows).
- **High fidelity at every level**: each level of detail is treated as a first-class simulation target — correct star colors from Planck spectra, stable orbital architectures, physically plausible atmospheres and climates, terrain shaped by the body's actual geology.
- **Wide, not tall**: many small, focused modules with strong separation of concerns. Simulation (pure data) is fully decoupled from rendering.

## Documentation

| Document | Scope |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Technical architecture: stack, module layout, determinism, data flow, scale handling |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Milestones and progress tracking |
| [docs/plan/00-foundations.md](docs/plan/00-foundations.md) | Seeding, RNG, units, math, time model |
| [docs/plan/01-galaxy.md](docs/plan/01-galaxy.md) | Galactic structure, star distribution, sectors |
| [docs/plan/02-star.md](docs/plan/02-star.md) | Stellar generation: mass, evolution, color, multiplicity, visuals |
| [docs/plan/03-system.md](docs/plan/03-system.md) | Planetary system architecture: disks, orbits, stability, zones |
| [docs/plan/04-planet.md](docs/plan/04-planet.md) | Planet types, interiors, atmospheres, climate, appearance |
| [docs/plan/05-moons-rings.md](docs/plan/05-moons-rings.md) | Moon systems, tidal physics, ring systems |
| [docs/plan/06-small-bodies.md](docs/plan/06-small-bodies.md) | Asteroids, comets, belts, size distributions |
| [docs/plan/07-surface.md](docs/plan/07-surface.md) | Terrain synthesis: tectonics, craters, erosion, hydrology, biomes |
| [docs/plan/08-rendering.md](docs/plan/08-rendering.md) | Rendering pipeline: shaders, atmospheres, scale, starfields |

## Stack

TypeScript · Vite · Three.js (WebGL2, with a WebGPU path) · Web Workers for generation · Vitest for testing.

## Running

```sh
npm install
npm run dev        # star viewer at http://localhost:5173 (?seed=<hex> selects a star)
npm test           # physics + determinism test suite
npm run typecheck
```
