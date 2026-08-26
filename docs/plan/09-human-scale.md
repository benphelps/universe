# 09 — Human Scale: Walking the Worlds

The north star: step out of orbit, land anywhere, and walk at eye height through to-scale terrain — mountain ranges you approach over in-world days, valleys with the rivers that carved them, coastlines with surf, forests of individual trees — all deterministic functions of the planet's seed and physics. No authored content, no painted noise at any scale: every feature traceable to a first-class model object (a plate, a river reach, a glacier, a biome, a tree), per the emergent-over-painted rule. This plan completes the 07-surface stack downward: from the ~100 m detail floor to the footstep.

## The scale ladder (the core problem)

Planet radius (~6,400 km) to a footstep (~0.5 m) is ~24 octaves of detail. Three regimes, each derived from the one above:

- **Model regime** (10,000 km → ~10 km): discrete objects generated once per world — plates, provinces, climate cells, drainage basins, river networks, biome fields. Small data, global consistency lives here.
- **Field regime** (~10 km → ~1 m): terrain as pure seeded functions *conditioned by the model objects* — today's detail-band cascade and erosion suites, extended down and given structure (valleys follow the river graph, talus follows the cliffs).
- **Instance regime** (~100 m → 1 cm): discrete things again — trees, boulders, river stones, grass — deterministic scatter keyed to position seeds, densities read from the fields.

**Consistency rule**: orbital appearance and walked ground are the same data. The forest visible as canopy tint from orbit is the trees you stand under; the river traced from altitude is the bank you follow.

**Precision**: floating origin exists; add local-tangent-frame chunk coordinates (f64 on CPU, f32 relative-to-chunk on GPU) so vertex jitter stays sub-millimeter at eye height on a 6,400 km sphere.

## S1 — Boots (ground camera & locomotion)

- WASD + mouse-look walking: 1.7 m eye height, gravity from the body's own g (0.93 g on the Earth-twin, 0.17 g on a moon — jumps and falls emerge), terrain collision via `heightAt`, slope-limited climbing, walk/run.
- Landing: orbit → pick a spot → the existing descent streams terrain → final glide to standing. Leaving: zoom out hands back to the orbit regime (the altitude-regime switch already exists).
- Camera: near plane ~5 cm on the ground; LOD error target pinned to eye height; horizon distance and curvature honest per planet radius.
- **Done when**: walk from a beach into foothills on the Earth-twin with no seam in control or streaming.

## S2 — Ground truth (continuous detail to the footstep)

- Extend the detail-band cascade from ~100 m to ~5 cm: outcrop, soil granularity, gravel, talus texture — band parameters derived per substrate (bedrock / regolith / sediment / ice, from the geology and erosion models), not one global noise.
- Geomorphing between chunk LODs (kill the pops — existing roadmap item), normal-map detail one octave below geometry, tri-planar materials on steep faces.
- Chunk pipeline hardening: budgets, eviction, priority by camera velocity; precision hardening per the ladder above.
- **Done when**: no visible detail floor at eye height anywhere; smooth frame rate through a full descent.

## S3 — The lay of the land (structured landforms)

Mountains today are statistical (plate-belt ridged noise). Make landforms structural:

- Ridge/valley networks with consistent drainage divides; fault scarps along the plate model's boundaries; foothills grading into plains.
- Slope processes at human scale: talus cones below cliffs at the angle of repose (gravity + material), bedrock exposure on steep faces, soil pooling in hollows (curvature-driven).
- Rock strata: bedding planes in sedimentary provinces, columnar jointing in volcanics, visible in cliff faces — from each province's geologic history.
- Coastal morphology: beach profiles, back-beach dunes, wave-cut cliffs; tidal flats where the moons' tides say so.
- **Done when**: a mountain approach reads correctly on foot — plains, foothills, valley, ridgeline — with believable slopes everywhere.

## S4 — Water finds its way (hydrology as first-class objects)

The keystone milestone. Rivers cannot be noise — they need global consistency — so they become model objects:

- Drainage model: flow routing over the coarse global grid (uplift from tectonics, precipitation from S5's climate field) → basins and a **river-network graph**: reaches with discharge, width, depth, and slope from stream-power scaling.
- Terrain conditioning: the graph carves the field regime — valley cross-sections widen with discharge, floodplains and terraces, meanders refined per-reach in low gradients, knickpoints and waterfalls at lithology steps, deltas and alluvial fans at outlets.
- Water rendering to scale: flowing river surfaces oriented along reaches, lakes at basin fill levels, estuaries; the existing ocean gains a real surf line.
- The same graph feeds orbital appearance (visible river traces) and the walked bank.
- **Done when**: you can follow a river from its delta to a headwater cirque on foot without a contradiction.

## S5 — Weather on the map (spatial climate & biomes)

Climate is a global EBM today (means + day/night). Make it a field over the sphere:

- Spatial climate: latitude circulation bands from rotation, altitude lapse (exists), **orographic precipitation and rain shadows** (winds + moisture fetch from oceans), continentality.
- Output fields: temperature(x), precipitation(x), soil moisture(x), snowline(x) — feeding hydrology discharge (S4 coupling), appearance, and biomes.
- Biome classification (Whittaker: T × P, alien variants parameterized by star spectrum and biosphere chemistry) as a first-class field; ground color at every scale derives from it.
- **Done when**: rain-shadow deserts sit behind the Earth-twin's coastal ranges, and treeline visibly tracks the snowline as you climb.

## S6 — The living ground (vegetation & cover)

- Plant communities per biome from the biosphere model: procedural tree species (branching grammars seeded per species per world, pigment palette from the star's spectrum), shrubs, grasses.
- Deterministic placement: hierarchical Poisson-disk keyed to position seeds; density from biome × soil moisture × slope.
- LOD chain: near — instanced geometry with wind sway; mid — impostor billboards; far — canopy density folded into terrain color (the same field that tints orbit).
- Undergrowth instancing in a small radius around the camera.
- **Done when**: walk from open grassland into closed-canopy forest that was visible as texture from orbit — same seed, same trees, every visit.

## Cross-cutting

- Determinism property tests at every level (same seed + position ⇒ same ridge, same reach, same tree).
- The layering rule holds: model code (`universe/`) stays free of Three; fields pure; renderer consumes.
- Legibility lifts remain disclosed display calibration only; no content fakery.
- Ordering: **S1 → S2 → S4-graph → S3 (conditioned by it) → S4-rendering → S5 → S6.** The drainage graph comes early because valleys, slopes, moisture, and biomes all hang off it.
