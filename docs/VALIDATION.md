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
| [Giant atmospheres](../tools/validation/giant-atmosphere.html) | Seven generated fixtures through the production HDR pipeline; `passed: true`, empty errors; clock/renewal boundaries, fresh/reverse cache agreement, far epochs, deep-deck visibility, grazing cloud shadows, upper cloud layer and thermal hotspot. Inspect pole/terminator/close/thermal views. |
| [Black hole](../tools/validation/black-hole.html) | Curved grid and star arcs outside a smooth shadow; close/far/polar/equatorial views, no-flow/torus/disc options; native 960 × 640 trace. Pause/animate and measure 300 warm frames; GPU time is unavailable when timer queries are unsupported. |
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

## Black hole comparison

The default `regular` solver traces every native display pixel using inverse radius and a unit angular vector. `fine` uses the same equations and material with smaller geometry/volume steps; `reference` retains the previous coordinate integrator and procedural noise. Camera movement and animated gas are recomputed at native resolution; no lower-resolution warp image or reconstruction is used.

Use `black-hole.html?sky=stars&flow=torus&animate&orbit&width=2150&height=1958` for the large native moving-camera case. The diagnostic warms 60 frames and measures 300, reporting median/95th/99th-percentile GPU times and frame intervals. GPU timing requires timer-query support. Compare the same camera, dimensions and flow with `solver=reference`. Run one active rendering page at a time.

The **Compare with fine trace** button freezes time, renders the regular and fine solvers, and reads back both displayed images. Use a uniform sky to isolate volume lighting, and a grid with no flow to expose direction errors. It reports normalized channel error and the fraction of pixels differing by over 10%; blank frames/readback errors fail the check. It leaves the fine image visible. This is a display-space convergence check, not an independent proof of physical correctness. CPU tests additionally compare escape directions with independent Schwarzschild radial quadrature and bound capture lookups against the analytic Kerr critical curve.

The optional `exposure` query sets the final camera exposure (default `0.6`). Bright low-mass hot flows can saturate the common calibration; compare at a short exposure before judging missing shadows or numerical convergence. A generated example is galaxy `62765c1caafc1d12`: reproduce its plasma with `black-hole.html?flow=torus&sky=stars&view=close&width=960&height=640&mass=7183.528434922727&spin=0.9534083525836765&feeding=0.001462966840030447&magneticFlux=8.39310413127019&exposure=0.0001`. The app's default core exposure is `0.08`; at `0.0001` the shadow and approaching bright side become visible. The background also darkens. At this shorter exposure, regular/fine mean absolute channel error was 0.00624, with 0.0083% of pixels differing by more than 10% on 2026-09-08. This checks the integrator, not the accuracy of the prescribed electron heating or scattering closure.

The application uses its full drawing buffer, including device pixel ratio; diagnostic dimensions specify actual buffer pixels. The sky cube's 1024-pixel faces remain an angular sampling limit. The 128³ flow-noise texture is a reusable material field, independent of output resolution. Fine/reference solvers are diagnostics and do not meet the production frame budget. Save measurements and screenshots in ignored `.artifacts/`, recording hardware/browser, dimensions, warmup, movement and material settings.

Hot-flow transfer now carries RGB transmission through torus, wind and jet cells. Recheck both comparison buttons after changes to either emission/opacity bank: the material cache includes both. Unit tests cover analytic constant-cell transfer, color-dependent absorption at the emitted frequency, off-grid plasma/outflow extinction, photon number and prescribed mean energy under redistribution, the elastic scattering limit, and the explicit finite-order scattering remainder. The plasma diagnostic reports the maximum reference-shell remainder fraction; three local orders are not a converged optically thick transport solution. Galaxy light scattered into new directions remains outside this local model.

On 2026-09-08, `flow=torus&sky=stars&view=close&magneticFlux=35&animate&orbit` measured 12.08 ms median GPU time / 16.6 ms frame interval at 1920 × 1280, and 23.91 ms / 25 ms at 2704 × 2074. Cold preparation took roughly five seconds while the preview rendered; the latter run's maximum loading frame interval was 49.9 ms. These are session measurements, not a universal 60 FPS guarantee. At 1920 × 1280 and exposure 0.6, direct/cache MAE was 0.000706, with 0.0128% of pixels over 10% error; regular/fine MAE was 0.006511, with 0.6886% over 10%. The latter still contains material-independent ray-integration error and should not be presented as exact convergence.

For hot tori, **Compare material cache** compares direct plasma-state evaluation with the cached material using the same regular rays and frozen time. `directPlasma` selects the direct path for timing. The production cache evaluates 32 × 96 material cells at 46 frequency shifts once per update; this is independent of the native image resolution. Inspect both material-cache error and regular/fine ray error when changing either sampling scheme.

Thin-disk emission uses a 16 KiB visible-spectrum lookup: CIE-integrated Planck radiance at the received temperature, including its visible luminance, replaces a hue multiplied by bolometric power. Linear light goes to the existing HDR output transform with a peak-relative exposure; there is no additional radial brightness stretch.

Hot tori use local emission/absorption tables from a bounded plasma model, with thermal and nonthermal synchrotron, free-free emission and approximate local Compton scattering. A transported 32 × 96 field carries density, thermal energy, magnetic energy and energetic electrons. Its heating/cooling history produces local emission changes and bounded enhancements. All hot flows share a fixed radiance reference; their optical peaks are not normalized to the same brightness. See [the model and its limitations](model/hot-flow-emission.md). The diagnostic reports construction and field-update times, material memory, field ranges, electron temperature and escaping power versus its budget. Compare weak feeding (`mass=4000000&feeding=1e-9`) with the default torus; weak plasma should remain hot but become faint. Check both regular/fine convergence and native frame times after loading settles. Unit tests separately check transport mass balance, periodic seams, local heating/acceleration/cooling conservation, ten-orbit reproducibility and direct-spectrum agreement of representative local states.

Thin disks extend to the model's outer radius. Beyond the existing 88–160 gravitational-radius lensing handoff, one direct surface intersection draws the outer disk against the original sky. This is a weak-field geometry approximation with the same material and local frequency shift, blended into the Kerr image. It avoids enlarging the region that needs full ray integration or sampling the sky cube outside that region. Inspect the handoff, cooler outskirts, and foreground sky extinction when moving the camera.

The diagnostic accepts `mass` (solar masses), `spin`, and `feeding` (Eddington luminosity ratio). For visible warm outskirts use `?flow=disc&sky=stars&view=far&mass=10000000000&spin=.1&feeding=.01`; a hotter small hole uses the defaults. Neither case should receive a painted temperature palette. `flowSpectrum.test.ts` compares table interpolation with direct spectral integration, checks the relativistic wavelength transformation, and verifies the high-temperature visible-band beaming limit.


Hot-flow outflows use separate mass and energy ledgers. `windIndex=0&magneticFlux=0` disables them in the diagnostic; `magneticFlux=35` makes the polar-base geometry easier to inspect without changing the exposure. Test both close and pole views: a strong approaching polar jet can obscure the shadow. Spin zero or flux zero must remove the BZ jet, while the weak-feeding fixture must remain faint. The model diagnostics report component emitted power, electron budgets, setup time and texture memory. Unit checks cover angular normalization, continuity, mass lost during perturbation transport, energy ceilings, held-out spectra and interpolated kinematics. The wind and jet terminate at the existing 60 gravitational radii; this is an inner-outflow approximation.


Inspect the torus immediately beside the jet bases at `magneticFlux=35&view=close`, including a paused frame. Hard triangular wedges are sampling artifacts, not physical jet structure. The production integrator uses smoothly varying polar precision and a consistent two-step volume cadence across that boundary. Check the image visually as well as aggregate error: the former hard-switch artifact occupied relatively few pixels and was easy to miss in the overall RMS.


Black-hole setup uses the same streaming/worker path in the application and diagnostic. During a cold torus build the shadow and sky should remain visible, controls should respond, and the status should advance through plasma, wind and jet spectra. `loading` in the measurement records wall time, rendered frames, maximum frame interval and observed main-thread long-task duration (when supported). Re-run the same model to check the in-memory cache; switch flow/view during generation to check cancellation. Worker failure must report failure and keep the preview instead of falling back to a synchronous build. Readback comparisons await complete generation and shader readiness before freezing the image.

## Giant atmosphere checks

The giant diagnostic uses generated mass/orbit fixtures for Jupiter, Saturn, Uranus, Neptune and a hot Jupiter, plus the mini-Neptunes at `?seed=0000000000000001&view=planet&planet=1` and `?seed=5c99c4a91183929c&view=planet&planet=1` (Veliakrar R1M5 c); their remaining seeded properties are not exact Solar System reconstructions. Rendering uses the application’s HDR, bloom and ACES pipeline. **Run GPU checks** freezes body rotation to isolate weather, compares both sides of day 512, a control epoch and an adaptive parcel-renewal boundary, compares fresh loads with forward/reverse playback, checks a 100-million-day epoch, toggles the upper condensate layer, and verifies that changing the hotspot direction changes emitted light. A pair of known deep-deck albedos also measures how much of the underlying signal survives the upper layer, at exposures 0.35, 1 and 3. All seven cases passed on 2026-09-10 with at least 83.8% of that signal retained: fresh/played and fresh/reversed images matched exactly; no pixels crossed the 2% RGB-difference threshold at the former clock boundary. A grazing-light comparison at days 0, 100 and 100 million rejects artificial dark cutouts against the same deck with upper clouds disabled. Restoring the previous absorbing-cloud shader failed this check on six of seven cases; the corrected transport passed all seven with no eligible pixel losing more than 17% of its displayed brightness. This does not establish a complete atmospheric chemistry or fluid model.

**Measure rendering** compares the same Jupiter view with upper clouds off/on at a native 1280 × 960 buffer, 30 warmup frames, 120 samples, and one simulation day per real second. The production pipeline owns the timer queries; the diagnostic samples its latest completed frame time rather than nesting a second query. Before the grazing-angle transport correction, on 2026-09-10 median GPU times were 1.39 ms off and 2.35 ms on; 95th-percentile times were 8.03 and 11.95 ms, including deck refreshes and the HDR output passes. These are single-planet measurements in the in-app browser, not whole-application frame-rate guarantees. The measurement reports unavailable GPU timing if timer queries are unsupported. Close-up, pole, terminator and thermal controls support visual inspection; the thermal view rescales visible emission and is not an infrared image.
