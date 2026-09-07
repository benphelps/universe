# Architecture

Universe generates a seeded procedural model on demand and presents it through one viewer. Scientific calculations are plain data; the renderer owns display approximations, GPU resources and level of detail.

## Code ownership

| Layer | Responsibility |
| --- | --- |
| `src/core/` | RNG, hashing, units, math, noise, constants and color |
| `src/universe/` | Stars, systems, galaxies, nebulae, worlds, climate and terrain fields |
| `src/workers/` | Terrain, sky, nebula, landmark and locale generation |
| `src/render/` | Three.js objects, shaders, GPU bakes, resource uploads and terrain streaming |
| `src/app/` | Viewer, camera, scheduling, state, navigation and React UI |

[`layering.test.ts`](../src/layering.test.ts) prevents the model and core from importing Three.js or accessing the DOM. Model tests run in Node; the same calculations can run in workers. The app coordinates model and renderer lifetimes rather than making UI state part of physical generation.

## Determinism and units

Seeded random streams and hashed child identities isolate sibling generation. Repeating an address with the same model version reproduces its system and terrain. Changes to physical distributions or generators can intentionally change older seeds; an address is not a versioned save file.

Use the unit named by each model field: galaxy positions are parsecs, planetary dimensions commonly kilometers, orbital distances commonly AU, and simulation time is in days. Convert at render boundaries. Camera frames and scale transitions avoid putting an entire galaxy and centimeter terrain into a single absolute GPU coordinate system. URL state identifies a location and selected body; it does not encode the exact camera pose, simulation phase, exposure or all UI settings.

## Generation and scheduling

A galaxy seed selects structure and population parameters. Spatial sampling resolves stars and clouds around the observer; selecting a system generates its bodies. Surface workers resolve a deterministic field into terrain chunks. Nebula workers solve bounded gas/radiation fields, then produce representations for near volumes and distant portraits.

Workers have explicit queues, cancellation and completion ownership. Cancelling a request does not make its memory immediately available: leases remain charged until the worker acknowledges release. Cached results, active bakes, replacement uploads and fading representations each retain ownership until disposal. Camera motion ranks work without synchronously solving every visible object.

Expensive population integrals, optical response samples and annual-insolation quadrature are generated offline. Their checked-in tables are runtime inputs, with generators retained for review and reproduction. Dynamic seasonal appearance samples a cached response rather than rerunning a climate integration each frame.

## Rendering

[`RenderPipeline`](../src/render/fx/pipeline.ts) uses WebGL2 through Three.js, an HDR half-float target, reversed depth where supported, and ACES filmic display mapping. Physical reflected and emitted contributions are combined in linear light before the detector/display response. Tone mapping, exposure, limited dynamic range and display-oriented representations remain separate from a scientific instrument calibration.

Galaxy density, light and dust share model fields and cached lookup textures across scales. Near resolved stars and diffuse light use population accounting to avoid inventing a second luminosity reservoir. Statistical distant dust and resident cloud extinction cover different spatial contributions. Nebula portraits and local volumes derive from the same gas/source solution, with bounded sampling and refinement.

Planet rendering combines a distant globe, streamed cube-sphere terrain, surface scatter, water, atmosphere and clouds. Terrain uses distance/horizon rejection, bounded caches, parent-child morphing and a shared surface datum. Clouds read scene depth so foreground terrain occludes the volume. Ground and orbit materials share atmosphere, thermal-emission and seasonal-cover parameters.

Potentially expensive shader variants are prepared before their first visible draw. Small state changes such as the arrival of surface data use uniforms when a new program is unnecessary. Preparation must tolerate cancellation and disposal; it is not permission to retain stale objects indefinitely.

## Boundaries

The model uses empirical distributions, reduced physical models and procedural geometry. It is not an N-body galaxy, radiation-hydrodynamic nebula simulation, full stellar-evolution solver or coupled weather model. See the [model references](README.md) for assumptions and the [performance reference](PERFORMANCE.md) for resource ceilings. WebGPU is a future evaluation, not an interchangeable current backend.
