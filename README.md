# Universe

**[Open the survey →](https://benphelps.github.io/universe/)**

An explorable galaxy in a browser tab. Ride out until the spiral arms resolve, pick any star out of the sky and travel to it, fall into its system, and descend to the ground of one of its worlds — one continuous move, no loading screens, no seams between scales. Everything you can see is somewhere you can go.

It is fully deterministic, and it is built on real astrophysics rather than visuals that merely look astronomical. Nothing is stored or authored: every place is computed on arrival and computed the same way every time, so an address is all it takes to send someone to exactly what you are looking at.

## What you can do

- **Cross the galaxy.** Pull back far enough and the whole disk is there — arms, bulge, dust lanes, the bright core — and it is the same galaxy you were just standing in, seen from outside.
- **Read the sky.** Every glint is a real star: hover it for its spectral type and distance, click it to go there. The Milky Way's dark rifts are specific molecular clouds, and the nebulae are those same clouds lit from inside by the stars forming in them. Constellations are cut around the landmarks your particular sky shows, so every home system letters its own.
- **Stand at the galactic centre.** A supermassive black hole with its shadow, its photon ring, its glowing accretion flow, and the star field behind it bent into Einstein rings.
- **Explore a system.** Planets on live orbits under a real photosphere, moons casting eclipse shadows, ringed giants, comets that grow tails as they come in, and asteroid belts you can pick a single rock out of and land on.
- **Descend to a world.** Interiors, atmospheres and climate decide what is waiting: oceans, ice caps, deserts, dune fields, river valleys, crater plains. Terrain resolves continuously from orbit to eye height, and the sky overhead scatters its own star's light through its own air — hazy worlds look hazy, twilight grades the way twilight does, moons rise and set.
- **Fly the surface.** A first-person camera over the landscape, clamped just above the ground and the water, fast enough to cross a mountain range and slow enough to skim a valley floor.

## What's true about it

- **Deterministic.** The same address always leads to the same place — the same star, the same world, the same rock on its surface. There is no stored universe and nothing is generated ahead of time; it is all computed live, and all reproducible.
- **Real science, not pretty visuals.** Initial mass functions and evolution tracks decide which stars exist; blackbody spectra decide their color; disk chemistry and orbital stability decide which planets form and where; atmospheric retention and climate balance decide whether a world holds air, water or ice. Where the science is statistical the model samples real distributions; where it is mechanistic it uses the real formulas.
- **Emergent, not painted.** Every visible feature traces back to something in the model. A dark lane across the band is a particular cloud. A nebula's color is the ionization physics of its hottest member. Nothing is noise or a palette standing in for a thing that isn't there.

## Quick start

Node 22+ (CI pins 22).

```bash
npm install && npm run dev
```

The viewer opens at `http://localhost:5173`. First visit asks which galaxy to chart — the shared one everyone knows, or a personal one of your own.

| Script | Does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Production bundle to `dist/` |
| `npm run preview` | Serve the built bundle |
| `npm test` | Full Vitest suite |
| `npm run test:watch` | Vitest in watch mode |
| `npm run typecheck` | `tsc --noEmit` |

### Controls

Scroll to ride between scales · drag to orbit · right-drag (or right-shift + drag) to pan through space · click any glint to travel there. On touch: pinch to ride, drag to orbit or pan, double-tap a glint to travel.

On a planet's surface: `W`/`A`/`S`/`D` flies where you look, `Space`/`C` for altitude, `Shift` to boost.

### Addresses

Where you are is written into the URL continuously, so whatever is in the bar is a link that lands someone else exactly there.

| Parameter | Meaning |
| --- | --- |
| `galaxy` | Which galaxy. Absent means your own. |
| `seed` | The star system. |
| `at` | `x_y_z` in parsecs — where that system actually sits in the galaxy. |
| `view` | `galaxy`, `star`, `system` or `planet` |
| `planet`, `moon`, `companion` | Which body is in focus |
| `cloud` | The molecular cloud being framed, rather than the star sharing its patch of space |
| `core` | Stand at the galactic nucleus |

A link decides only the trip, never your home galaxy — that is set once, by choosing it.

## Architecture

```
src/
  app/       unified viewer, camera controls, store, survey console (React)
  render/    Three.js scenes, materials, shaders, LOD streaming
  universe/  pure procedural model: plain-data bodies from seeds
  core/      RNG, hashing, math, units, noise, constants, color
  workers/   terrain, sky, nebula, landmark and locale generation
```

Dependencies point downward only, and the model is fully decoupled from what draws it: `core/` and `universe/` carry no Three.js imports and touch no DOM, which is what keeps the whole simulation testable headless and runnable in workers. [`src/layering.test.ts`](src/layering.test.ts) fails the build if that ever stops being true.

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) covers the rest: determinism, data flow, and how one renderer spans twenty-two orders of magnitude.

## Requirements

- **WebGL2** is required. Web Workers carry generation; `OffscreenCanvas` with float render targets bakes the sky and nebulae on the GPU, with a CPU path where it is unavailable.
- Everything is computed on the client. Expect sustained CPU and GPU load and more than a gigabyte of GPU memory.

## Testing

```bash
npm test
```

Vitest, node environment, `src/**/*.test.ts`. Four kinds of test carry the project:

- **Determinism** — the same seed twice is deep-equal, and shuffling sibling generation order changes nothing.
- **Solar System fixtures** — the Sun's color and luminosity, Earth's equilibrium temperature, Jupiter's radius, the Moon's lock state, Io's tidal heating, Kirkwood gap positions. Generators are validated by feeding them real inputs and asserting real outputs.
- **Population statistics** — sampled IMF against Kroupa slopes, planet occurrence and period ratios, naked-eye star counts to the right order of magnitude.
- **The layering rule** — see above.

## Deployment

[`.github/workflows/pages.yml`](.github/workflows/pages.yml): a push to `main` runs the suite, builds with `--base=/universe/`, and publishes to GitHub Pages.

## Status

Milestones M0–M6 are complete: foundations, stars, systems, worlds, moons and small bodies, surfaces, and the galaxy. M7 (depth and polish) is largely landed — the single unified renderer, black-hole lensing, the real far starfield, the whole-galaxy view, belt materialization, constellations and the galactic gazetteer — with named open items: volumetric clouds and multiple-scattering atmospheres, a galaxy population beyond this one spiral, exotic showcases, zodiacal light, performance hardening, and a WebGPU evaluation.

M8 (human scale) is the current direction: detail down to ~5 cm, structural ridge and valley networks, rivers that come from a real drainage graph, spatial climate fields, and vegetation per biome.

[docs/ROADMAP.md](docs/ROADMAP.md) is the living record — every milestone, every open item, and a log of what landed and why.

## Documentation

| Document | Scope |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, layering, determinism, data flow, scale handling, validation |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Milestones, open items, and the change log |
| [00-foundations](docs/plan/00-foundations.md) | Seeding, RNG, units, math, time model |
| [01-galaxy](docs/plan/01-galaxy.md) | Galactic structure, star distribution, sectors |
| [02-star](docs/plan/02-star.md) | Stellar generation: mass, evolution, color, multiplicity, visuals |
| [03-system](docs/plan/03-system.md) | Planetary architecture: disks, orbits, stability, zones |
| [04-planet](docs/plan/04-planet.md) | Planet types, interiors, atmospheres, climate, appearance |
| [05-moons-rings](docs/plan/05-moons-rings.md) | Moon systems, tidal physics, ring systems |
| [06-small-bodies](docs/plan/06-small-bodies.md) | Asteroids, comets, belts, size distributions |
| [07-surface](docs/plan/07-surface.md) | Terrain synthesis: tectonics, craters, erosion, hydrology, biomes |
| [08-rendering](docs/plan/08-rendering.md) | Rendering pipeline: shaders, atmospheres, scale, starfields |
| [09-human-scale](docs/plan/09-human-scale.md) | Orbit to footstep: detail cascade, drainage, weather, vegetation |
| [10-gas-giants](docs/plan/10-gas-giants.md) | Living atmospheres: jets, storms, aurorae, night-side heat |
| [11-nebulae](docs/plan/11-nebulae.md) | One density field, three tiers: clouds you can fly into |

## Stack

TypeScript (strict) · Vite · React · Three.js on WebGL2 · Web Workers · Vitest.
