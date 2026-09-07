# Validation

## Routine integration checks

```bash
npm ci
npm run typecheck
npm test
npm run build -- --base=/universe/
npm run validate:build
```

The integration checkpoint has 825 tests across 152 files. Tests cover determinism, layer boundaries, reference fixtures, population statistics, conservation and resource ownership. Test counts change with the code; a green suite is necessary but does not establish scientific completeness or GPU correctness.

The massive-star tests read the published extract from `data/reference/`. Do not delete it as a report. [Reference data](../data/reference/README.md) lists generators. Regenerating the relocated massive-track and annual-insolation tables must preserve numeric values during documentation-only changes.

## Browser diagnostics

Run `npm run dev` and open `/tools/validation/`. Alternatively, after `npm run validate:build`, run `npm run preview -- --outDir=.artifacts/validation` and open `/tools/validation/`. The diagnostic build is separate from the normal app/Pages bundle.

Run one foreground page at a time with WebGL2 and floating-point render-target support. Press its run button and inspect the result. Hardware/driver limitations and shader errors must not be treated as a passing blank frame.

| Page | Expected outcome |
| --- | --- |
| [Cloud depth](../tools/validation/cloud-depth.html) | 24 cases, empty error list; foreground terrain blocks clouds in both depth conventions |
| [Cloud limb](../tools/validation/cloud-limb.html) | 12 cases, no non-finite/negative pixels, nonuniform cloud light, empty error list |
| [Surface light](../tools/validation/surface-light.html) | Eight checks, empty error list; linear emitted/reflected transport, seasonal height and ground preparation |
| [Volume upload](../tools/validation/volume-upload.html) | Three formats, 1,305,600 texels total, zero mismatches/unpack-state queries; texture count returns to baseline |
| [Galaxy density](../tools/validation/galaxy-density.html) | `passed: true`; max error <0.12, mean <0.01 across 512 CPU/GPU samples |
| [Shader readiness](../tools/validation/shader-readiness.html?benchmark&benchmarkGL) | Four cold/prepared runs; prepared draws add no programs; compare call spans and timings, not a fixed millisecond threshold |
| [Seasonal surface](../tools/validation/seasonal-surface.html) | Winter/summer cover follows the same terrain and scatter; orbit/ground transitions agree; turning cover off removes the overlay |

Shader-readiness instrumentation requires both `benchmark` and `benchmarkGL` query flags. The seasonal reference deliberately allows more terrain than the production budget; use the app for performance assessment. Save raw result JSON and captures in ignored `.artifacts/`, with the source commit and environment when retaining a comparison.

At the documentation-curation checkpoint, all six executable browser diagnostics passed in the in-app WebGL2 browser. The seasonal reference streamed successfully in orbit and on the ground; winter/summer and cover-off views were visually checked without console errors. All five generation benchmark cases ran successfully. Build, test and generation logs remain locally in ignored `.artifacts/curation/`.

## App regressions worth keeping

These are destination URLs, not complete camera/time recordings. Add `benchmark&benchmarkGL` for the app capture controls and record altitude, orientation, viewport, simulation rate and warm/cold state with results.

| Case | Query and action |
| --- | --- |
| Dark cloud off-black center | `?seed=b6b2214317b02b95&galaxy=53494d5f554e4956&view=galaxy&at=9554.7787_-7849.7429_60.2650&cloud=6c40c4fcc57d4de7`; orbit the cloud at close range and inspect extinction from several angles |
| Terrain LOD rings | `?galaxy=638fa1989d88dbbc&seed=984349d96b9eb8e0&view=planet&at=-2364.7885_-8972.3399_26.5174&planet=0`; descend/ascend through LOD changes |
| Accelerated surface climate | `?seed=b3da1674ed6bda5a&galaxy=53494d5f554e4956&view=planet&planet=4&moon=0`; reach the surface, compare paused with a day per minute |
| Cloud horizon | `?seed=d50464b00652fab0&galaxy=53494d5f554e4956&view=planet&planet=6`; the exact archived pose is retained in the cloud-limb diagnostic |
| Galactic-center freeze | Zoom out, then pan the nucleus into/through the camera near plane; inspect cloud demand and worst frame, not just average FPS |
| Cold readiness and disposal | First descent after fresh load, switch worlds while loading, revisit; check late results do not mutate disposed objects or grow retained programs/textures |

Model addresses may change with intentional generation revisions. Keep minimal fixtures with regression tests where exact behavior matters, rather than relying solely on URLs. See [performance](PERFORMANCE.md) for timing interpretation and the [archive](ARCHIVE.md) for historical full captures.
