# 08 — Rendering: Pipeline, Shaders, Scale, Light

The render layer turns pure models into photoreal frames. Governing rule: **light is computed, not painted** — one HDR physically-anchored pipeline from a star's spectral radiance all the way to the tone-mapped pixel, so a sunset, a blue giant, and a backlit ring are all the same math.

## Pipeline

- **HDR linear workspace** end to end; physical light units internally (star luminosity → irradiance at distance via inverse-square), exposure as a camera property (auto-exposure with manual override), **ACES-style tone mapping** at the end. This is what makes bright stars bloom white while faint ones stay colored — for free, correctly.
- Post stack: threshold bloom (the only place glow comes from), optional lens artifacts (starburst diffraction spikes as a *camera* trait, not a star trait), subtle dithering against banding.
- Three.js `WebGLRenderer` first; materials written as `ShaderMaterial`/node-material pairs kept thin so a `WebGPURenderer` swap stays cheap.

## Scale & precision (the hard constraint)

- **Floating origin**: all render positions rebased camera-relative in doubles on CPU, cast to float32 after — jitter-free surfaces at planetary distances from origin.
- **Dual-scene compositing**: near scene at true scale (camera → ~10⁶ km) and far scene of *proxies* — distant bodies re-projected to a fixed-radius shell at correct angular size and photometric brightness. Far renders first, near composites over; logarithmic depth within each. Bodies migrate between scenes seamlessly by angular-size threshold.
- Point-source regime: below resolvable angular size, bodies become photometric sprites (color + magnitude from the model) — the same code path that draws the 01 skybox, so a planet walked away from fades into a correctly-colored "star".

## Per-domain rendering

### Stars (with 02)
Photosphere shader: animated granulation (3D noise advected by differential rotation), limb darkening from the model coefficient, spot masks, chromaticity from the temperature table (uploaded LUT). Corona/prominences: layered fresnel rim + radial-noise billboards + curl-noise loop arcs. Compact exotics: white-dwarf point brilliance, pulsar beam cones sweeping with spin, black hole by per-pixel null-geodesic tracing (exact Schwarzschild orbits, so shadow, photon ring, Einstein rings and the accretion flow's wrapped-over far side all fall out of one integration), with the flow shaded from the model's temperature profile through the blackbody table at the Doppler- and gravity-shifted temperature.

### Planet surfaces (with 07)
Quadtree chunk meshes with geomorphing; splat-blended PBR materials (albedo from palette, roughness by material class); normal + optional parallax detail below geometry resolution; instanced scatter (boulders/vegetation cover) in near rings around the camera; emissive lava/city-free night sides (aurora ovals where the model says so); specular ocean with wind-driven normal animation, Fresnel horizon, wet-sand shoreline band.

### Atmospheres (with 04)
Single-scattering Rayleigh + Mie shader (O'Neil-style, per-pixel ray march with precomputed optical-depth LUT per planet): sky dome from the surface (correct day blue → sunset reds from the same scattering integral, alien tints from composition — CO₂ white-pink, methane-scatter cyans), thin glowing limb from orbit, light shafts at the terminator, stars visible through thin atmospheres. Aerial perspective (distance haze) uses the same LUT so terrain and sky always agree. Clouds: v1 as animated coverage textures from the climate field (two layers, correct shadows on the ground); v2 volumetric cumulus/storm cells near the surface. Upgrade path: precomputed multiple scattering (Bruneton) for heavy atmospheres.

### Rings (with 05)
Annulus geometry with radial structure texture from the ringlet spec; **phase-function shading** (forward-scatter brightening when backlit) from particle-size class; planet shadow across the ring plane and ring shadows on the planet via analytic projection; particle-field close-up mode (instanced boulders in the local ring patch) when the camera enters the plane.

### Small bodies & belts (with 06)
Distance ladder: photometric sprite → GPU-instanced impostor cloud (belt fields, thousands of tumbling rocks per draw call) → per-body mesh with crater normal detail → full 07 chunked surface at landing scale. Comets: coma as volumetric-look nested billboards, ion tail as curl-animated ribbon strictly anti-solar, dust tail as syndyne-curved particle sheet — all driven by the activity model at `t`.

### Sky & background (with 01)
Skybox cubemap generated (worker) from the galaxy model at the camera's system: individually-colored stars by magnitude, Milky Way band from the density integral with dust lanes, nebulae billboards; regenerated on interstellar travel. Zodiacal light wedge composited in-system.

## Cameras & context

Camera rigs per context — system overview (orbit-map framing), body orbit (inertial or surface-locked), surface walk/fly (planetary curvature-aware ground camera) — sharing one controller interface; context transitions are continuous zooms, never cuts: galaxy → system → orbit → ground is one unbroken travel.

## Performance targets & tactics

- 60 fps mid-range laptop baseline; generation never on the frame thread (00 worker protocol), chunk uploads budgeted per frame.
- Aggressive reuse: one star material, one terrain material, one atmosphere shader — all parameterized by model uniforms (no per-body shader compiles).
- Frustum + angular-size culling before instancing; impostor caches per belt cell; LUTs (temperature-color, optical depth, phase functions) baked once.

## Testing targets

- Golden-image tests (headless GL) for: G2V star disc hue, Rayleigh sky chromaticity at noon/sunset vs reference, ice-giant methane tint, backlit-ring brightening.
- Scale soak test: camera flight from surface to 100 AU and back with zero visible jitter and stable depth sorting.
- Photometric regression: rendered magnitude differences between two stars match their model ΔL at fixed exposure.
