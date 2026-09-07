# Performance

The target is smooth, stable interaction with bounded background work. A fixed 60 FPS promise across all hardware, views and resource contention is not a useful acceptance criterion. Compare frame-time distributions and visible stalls on the same machine, viewport and route.

## Current controls

- Expensive generation runs in bounded worker queues; visibility ranking and galactic-center candidate work do not synchronously bake every intersecting cloud.
- Nebula jobs have work ceilings, early portraits and incremental refinement. Cancellation retains its memory lease until acknowledged.
- Resident replacement reserves old/new overlap. Volume transfers advance in bounded 512 KiB stages instead of a large first-visible upload.
- Display raymarch quality adapts independently of the underlying physical field. This changes display sampling, not the gas inventory.
- Stellar response and population moments are offline tables. Seasonal climate response is cached and sampled per frame; a new simulated day does not require a fresh integration.
- Terrain uses horizon/distance rejection, LOD morphing and bounded caches. Program preparation moves compilation before visibility; texture readiness uses uniforms where possible.

The [nebula memory partition](../src/app/nebulaMemory.ts) reserves 1,280 MiB of payload: 256 MiB residents, 128 MiB loose results, 336 MiB retained worker storage, 32 MiB portraits and 528 MiB active work. This excludes the rest of the renderer, JavaScript/driver overhead and garbage awaiting collection. It is not a browser RSS cap. Keep admission, cancellation, replacement and disposal tests alongside changes to these limits.

## Representative audit results

These are historical measurements on the audit machine, not portable performance guarantees. Full setups and captures are in the [archive](ARCHIVE.md).

| Scenario | Recorded result | Interpretation |
| --- | --- | --- |
| Galactic center crossing the camera near plane | 6,909.7 ms worst stall reduced to 70.5 ms cold / 66.5 ms repeat | Worker ranking and bounded cloud demand removed the multi-second freeze; display sampling also changed |
| Outside-planet terrain | A reviewed view settled around 401k triangles after culling/LOD work | Replaces the reported multi-million-triangle case; not a universal ground-view cap |
| Nine cold nebula carriers | First draw 34.1 → 2.4 ms; repeated context 7.0 → 1.8 ms | Preparing programs before drawing avoids first-visible compilation |
| First descent plus accelerated time, 20 s | 66.85 FPS average, max frame 18.2 ms, programs 35 → 35 | No >20/50 ms frames in that capture |
| Cold body switch | Maximum observed 101.1 ms | Remaining loading hitch; warm traversal results do not close this case |

Seasonal response tables used about 26–101 KiB in reviewed cases and differed from denser reference sampling by about 0.14–0.23 K. The focused GPU overlay has a bounded field and a four-entry, 1 MiB cache. These measurements justify the current approximation for appearance, not arbitrary climate accuracy.

## Measuring a change

Use a production build for app performance, keep one foreground simulation tab, and record hardware/browser, viewport, pixel ratio, seed, camera pose/altitude, simulation speed and cold/warm state. Note other active workloads. Avoid running the full test suite while taking GPU timings.

Add `benchmark&benchmarkGL` to an app URL to expose the performance capture and GL-call instrumentation. Record the same route before and after; report median/tail frame times, worst frame, loading work, programs, triangles and retained payload. Instrumentation itself adds overhead, and a location URL alone does not reproduce an exact camera pose.

For headless generation and CPU profiles:

```bash
npm run bench:generation -- .artifacts/generation stars systems
npm run bench:generation -- .artifacts/nebula nebula48
```

The benchmark reports a first invocation and five warm samples, a deterministic result checksum, and an approximately one-second CPU profile per case. “Cold” means first invocation within that process, not a freshly booted machine. Other cases are `survey` and `surveyPopulated`; omitting case names runs all five. Profiles and JSON stay in ignored `.artifacts/`.

Use the [browser diagnostics](VALIDATION.md) to validate rendering correctness after an optimization. Their readbacks, fresh contexts and deliberately heavy reference scenes are not representative frame-rate benchmarks.
