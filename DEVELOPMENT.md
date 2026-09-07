# Development

Building, testing and understanding the codebase. For what the app is, see the [README](README.md).

## Quick start

Node 22+ (CI pins 22).

```bash
npm install && npm run dev
```

The viewer opens at `http://localhost:5173`.

| Script | Does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Production bundle to `dist/` |
| `npm run preview` | Serve the built bundle |
| `npm test` | Full Vitest suite |
| `npm run test:watch` | Vitest in watch mode |
| `npm run typecheck` | Type-check application and retained diagnostic tools |
| `npm run validate:build` | Build browser diagnostics into ignored `.artifacts/validation/` |
| `npm run bench:generation -- .artifacts/generation stars` | Generation timing, checksum and CPU profile |

## Stack

TypeScript (strict) · Vite · React · Three.js on WebGL2 · Web Workers · Vitest.

## Architecture

```
src/
  app/       unified viewer, camera controls, store, survey console (React)
  render/    Three.js scenes, materials, shaders, LOD streaming
  universe/  pure procedural model: plain-data bodies from seeds
  core/      RNG, hashing, math, units, noise, constants, color
  workers/   terrain, sky, nebula, landmark and locale generation
```

Dependencies point downward only, and the model is fully decoupled from what draws it: `core/` and `universe/` carry no Three.js imports and touch no DOM, which is what keeps the whole simulation testable headless and runnable in workers. [`src/layering.test.ts`](src/layering.test.ts) enforces that boundary in the test suite.

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) covers the rest: determinism, data flow, and how one renderer spans twenty-two orders of magnitude.

## Model scope

Generation is deterministic within a model version; scientific improvements can intentionally change older seeds. Initial mass functions, stellar evolution, material budgets, orbital constraints, atmospheric columns and climate response constrain the generated worlds. Geometry, chemistry, weather and dynamics still use bounded approximations. The [model references](docs/README.md) document the sources and limits.

## Requirements

- **WebGL2** is required. Web Workers carry generation; `OffscreenCanvas` with float render targets bakes the sky and nebulae on the GPU, with a CPU path where it is unavailable.
- Everything is computed on the client. Expect sustained CPU and GPU load and more than a gigabyte of GPU memory.

## Controls

Scroll to ride between scales · drag to orbit · right-drag (or right-shift + drag) to pan through space · click any glint to travel there. On touch: pinch to ride, drag to orbit or pan, double-tap a glint to travel.

On a planet's surface: `W`/`A`/`S`/`D` flies where you look, `Space`/`C` for altitude, `Shift` to boost.

### Finders

For photographic locations, open **Finders → Scenic**, choose a scene type, and select **Find scenes**. Surveys rank nearby worlds, local nebulae, galaxy shapes, and catalog nuclei by physical traits. Candidates stand as rows under their scene types; the chips narrow a mixed shortlist to one type, and a row opens to show its reasons and a framing suggestion and to travel to the candidate. The shortlist stays after a trip, even the clean boot into another galaxy, and says where it was surveyed from; **Scan more** extends it while you are still there. World rankings include sampled visible starlight, atmospheric clarity, reflection, and lava emission; nebula rankings include estimated optical power per area. Galaxy-shape candidates still need a visual lighting check. These are scouting destinations, not precomposed camera poses or guaranteed sunsets.

The **Finders → Eclipse** tab searches active or next-day events from planetary and lunar surfaces, including airless worlds. Filter for a moon crossing the star, a parent planet eclipsing it from a moon, mutual moon eclipses, or another planet's transit. Starting a search pauses the clock, since every result is timed from that moment. Results rank by a sky that takes part in the eclipse yet still shows the sun (airless worlds rank low), depth, the eclipse's size in the sky, timing, and distance; each names the observing world, the blocking body and both discs' widths, then lands you shortly before first contact with time paused; the list stays for the next event, with its timing read against the clock. Small planetary transits down to 0.1% stellar coverage are included; predictions use spherical body silhouettes. The survey walks the whole stellar neighbourhood outward in a cancellable worker and fills the list in as it goes, so a rare event type can be waited for and a common one stopped early.

## Addresses

The URL records your location and selected body. Share it to revisit that destination with the same model version. The address bar carries the body; the link orb beside the shutter copies a link that also carries the picture — the camera's stance and gaze and the clock held at this moment — so the reader lands on exactly this view, with time paused there. Viewing settings are not encoded.

| Parameter | Meaning |
| --- | --- |
| `galaxy` | Which galaxy. Absent means your own. |
| `seed` | The star system. |
| `at` | `x_y_z` in parsecs — where that system actually sits in the galaxy. |
| `view` | `galaxy`, `star`, `system` or `planet` |
| `planet`, `moon`, `companion` | Which body is in focus |
| `cloud` | The molecular cloud being framed, rather than the star sharing its patch of space |
| `core` | Stand at the galactic nucleus |
| `cam` | The camera, from the link orb only: `g` on the ground or `o` in orbit, then its position in km from the body's centre, its orientation, its heading and pitch, and a panned anchor when there is one |
| `t` | The clock, in simulation days, held there on arrival |

A link decides only the trip, never your home galaxy — that is set once, by choosing it. Every trip within a galaxy is a history entry, so the browser's back and forward buttons retrace them body by body; a trip into another galaxy is a page of its own.

## Testing

```bash
npm test
```

Vitest, node environment, `src/**/*.test.ts`. Four kinds of test carry the project:

- **Determinism** — the same seed twice is deep-equal, and shuffling sibling generation order changes nothing.
- **Solar System fixtures** — the Sun's color and luminosity, Earth's equilibrium temperature, Jupiter's radius, the Moon's lock state, Io's tidal heating, Kirkwood gap positions. Generators are validated by feeding them real inputs and asserting real outputs.
- **Population statistics** — sampled IMF against Kroupa slopes, planet occurrence and period ratios, naked-eye star counts to the right order of magnitude.
- **The layering rule** — see [Architecture](#architecture).

## Deployment

[`.github/workflows/pages.yml`](.github/workflows/pages.yml): a push to `main` runs the suite, builds with `--base=/universe/`, and publishes to GitHub Pages.

## Status and documentation

The galaxy-to-surface audit has reached an integration checkpoint, including varied galaxy structure, conserved nebula budgets, bounded generation/streaming, atmosphere transport, shared optical light and seasonal cover. Remaining priorities are loading stability, viewing instruments and targeted scientific calibration.

| Document | Scope |
| --- | --- |
| [Documentation index](docs/README.md) | Current model references and documentation policy |
| [Architecture](docs/ARCHITECTURE.md) | Layering, generation, rendering and resource ownership |
| [Validation](docs/VALIDATION.md) | Tests, diagnostic pages and reproducible regressions |
| [Performance](docs/PERFORMANCE.md) | Budgets, measurement guidance and known limits |
| [Roadmap](docs/ROADMAP.md) | Next priorities and deferred fidelity |
| [Audit archive](docs/ARCHIVE.md) | Restore the original investigations and individual fix history |
